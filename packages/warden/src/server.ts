import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response } from "express";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { formatUnits, type Hex } from "viem";
import { ENTRY_STAKE_EACH, getGame } from "@nanostakes/bracket";
import type { PromptWarState } from "@nanostakes/bracket";
import { judgePromptWar } from "./promptWarJudge.js";
import { gateway, wardenAccount } from "./gateway.js";
import { createMatch, getMatch, allMatches, sanitizeForPlayer, sanitizeForSpectator, persistMatch, pruneStaleAwaitingStakes, type MatchRecord } from "./state.js";
import { settleMatch } from "./settle.js";
import { getLeaderboard, getTemperamentStats, getAgentRecord } from "./ledger.js";
import { getOpponentMemory } from "./memory.js";
import { joinQueue, pollAssignment, queueStatus, leaveQueue } from "./matchmaking.js";
import { createChallenge, listChallenges, respondToChallenge } from "./challenges.js";
import { emitConcourseEvent, subscribeConcourse } from "./events.js";
import {
  createAgent,
  getAgent,
  getAgentBySessionAddress,
  listAgentsByOwner,
  listActiveAgents,
  setAgentStatus,
  setAgentName,
  toPublicAgent,
} from "./agents.js";
import { provisionSessionWallet } from "./wallets.js";
import { getEurcBalance, withdrawEurc } from "./eurc.js";
import { startAgentRuntime } from "./runtime.js";
import { sweepAbandonedMatches } from "./abandon.js";
import { recordMcpPayment, getMcpRevenueStats } from "./mcpRevenue.js";
import { recordBrokerMediation } from "./ledger.js";
import { createTournament, joinTournament, getTournament, listTournaments } from "./tournament.js";
import type { Address, Temperament } from "@nanostakes/shared";
import { renderMetrics } from "./metrics.js";
import { analyzeMatch } from "./coach.js";
import { sendMessage, getMessages, markRead, createClan, joinClan, leaveClan, listClans, getClan } from "./social.js";
import { openMarket, placePrediction, getMarket, listOpenMarkets } from "./predictions.js";
import { startAutoTournaments, stopAutoTournaments } from "./autoTournament.js";

interface PaidRequest extends Request {
  payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string };
}

/** Logs a settled nanopayment against a metered MCP-backed route, once the Gateway middleware confirms it. */
function logMcpPayment(route: string, req: PaidRequest): void {
  if (!req.payment?.verified || !req.payment.transaction) return;
  recordMcpPayment({
    route,
    payer: req.payment.payer,
    amountAtomic: BigInt(req.payment.amount),
    transaction: req.payment.transaction,
  });
}

const app = express();
app.use(express.json());

// The frontend (packages/web) is deployed separately from this server, so allow
// cross-origin requests from it.
app.use((req: Request, res: Response, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, warden: wardenAccount.address });
});

/**
 * Agent onboarding: an owner wallet provisions a session wallet for their
 * agent (Circle Developer-Controlled Wallet when configured, otherwise a
 * local Arc Testnet EOA — see wallets.ts). The agent starts "FUNDING" and
 * never plays until the owner funds the session wallet and calls /fund.
 */
app.post("/agents", async (req: Request, res: Response) => {
  const { ownerWallet, name, temperament } = req.body as {
    ownerWallet?: string;
    name?: string;
    temperament?: Temperament;
  };
  if (!ownerWallet || !name || !temperament) {
    res.status(400).json({ error: "ownerWallet, name, and temperament are required" });
    return;
  }
  try {
    const wallet = await provisionSessionWallet();
    const agent = createAgent({
      ownerWallet,
      name,
      temperament,
      sessionAddress: wallet.address,
      sessionPrivateKey: wallet.privateKey,
      walletProvider: wallet.provider,
    });
    res.json({ agent: toPublicAgent(agent) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** List the agents a given owner wallet has created. */
app.get("/agents", (req: Request, res: Response) => {
  const owner = req.query.owner as string | undefined;
  if (!owner) {
    res.status(400).json({ error: "?owner=<address> is required" });
    return;
  }
  res.json({ agents: listAgentsByOwner(owner).map(toPublicAgent) });
});

/**
 * Public roster of every ACTIVE agent across all owners — the "who's online"
 * list the queue UI shows so an owner can target a specific opponent with a
 * challenge instead of only taking whoever the blind queue draws.
 *
 * Registered before `/agents/:id` so "online" isn't swallowed as an id param.
 */
app.get("/agents/online", (_req: Request, res: Response) => {
  const onlineAgents = listActiveAgents().map((a) => {
    const rec = getAgentRecord(a.sessionAddress);
    return { ...toPublicAgent(a), standing: rec.standing, matchesPlayed: rec.matchesPlayed, netPnl: rec.netPnl };
  });
  res.json({ agents: onlineAgents });
});

/**
 * What `self` has learned about `opponent` from prior settled Brinkmanship
 * matches — null if they've never played before. Read by a driver's
 * playMatch() once it discovers its opponent, folded into the LLM prompt.
 *
 * Registered before `/agents/:id` for the same reason as `/agents/online`
 * above — otherwise Express matches the param route first and "memory" gets
 * treated as an agent id, 404ing as "unknown agent".
 */
app.get("/agents/memory", (req: Request, res: Response) => {
  const self = req.query.self as string | undefined;
  const opponent = req.query.opponent as string | undefined;
  if (!self || !opponent) {
    res.status(400).json({ error: "?self=<address>&opponent=<address> are required" });
    return;
  }
  res.json({ memory: getOpponentMemory(self, opponent) });
});

app.get("/agents/:id", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  res.json({ agent: toPublicAgent(agent) });
});

/**
 * Call once the owner has sent USDC to the agent's session wallet address
 * (a normal wallet-to-wallet transfer the owner makes themselves). Moves
 * whatever lands there into the agent's Gateway balance — the same one-time
 * deposit step `scripts/onboard.ts` does for hardcoded Contenders — then
 * flips the agent ACTIVE so the runtime starts playing it.
 */
app.post("/agents/:id/fund", async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  try {
    const client = new GatewayClient({ chain: "arcTestnet", privateKey: agent.sessionPrivateKey as Hex });
    const usdc = await client.getUsdcBalance();
    // Arc Testnet pays gas in USDC itself, so depositing the full balance
    // leaves nothing to cover the approve + deposit transactions' own gas
    // and reverts on-chain ("transfer amount exceeds balance"). Reserve a
    // small buffer for that.
    const GAS_BUFFER = 50_000n; // 0.05 USDC (6 decimals)
    if (usdc.balance <= GAS_BUFFER) {
      res.status(409).json({ error: "no USDC detected yet at the session wallet", sessionAddress: agent.sessionAddress });
      return;
    }
    const depositAmount = formatUnits(usdc.balance - GAS_BUFFER, 6);
    const deposit = await client.deposit(depositAmount);
    const updated = setAgentStatus(agent.id, "ACTIVE");
    res.json({
      agent: toPublicAgent(updated),
      deposit: { ...deposit, amount: deposit.amount.toString() },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Chains the owner can cash an agent's Gateway balance out to. Gateway moves USDC
 *  between these via CCTP under the hood, so picking a non-Arc chain here is a real
 *  cross-chain transfer, not a same-chain default with a different label. */
const WITHDRAW_CHAINS: SupportedChainName[] = ["arcTestnet", "baseSepolia", "sepolia", "avalancheFuji"];

/** Sweeps the agent's Gateway balance back to the owner's wallet (optionally to a
 *  different chain via Circle's CCTP-backed cross-chain transfer) and pauses it. */
app.post("/agents/:id/withdraw", async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  const { chain } = req.body as { chain?: SupportedChainName };
  if (chain && !WITHDRAW_CHAINS.includes(chain)) {
    res.status(400).json({ error: `chain must be one of: ${WITHDRAW_CHAINS.join(", ")}` });
    return;
  }
  try {
    const client = new GatewayClient({ chain: "arcTestnet", privateKey: agent.sessionPrivateKey as Hex });
    const balances = await client.getBalances();
    if (balances.gateway.available === 0n) {
      res.status(409).json({ error: "nothing to withdraw" });
      return;
    }
    const withdrawal = await client.withdraw(balances.gateway.formattedAvailable, {
      chain: chain ?? "arcTestnet",
      recipient: agent.ownerWallet as Hex,
    });
    const updated = setAgentStatus(agent.id, "PAUSED");
    res.json({
      agent: toPublicAgent(updated),
      withdrawal: { ...withdrawal, amount: withdrawal.amount.toString() },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * EURC balance for an agent's session wallet. Separate from the USDC/Gateway
 * balance above — EURC isn't routed through Gateway batching (the installed
 * x402-batching SDK only knows USDC at the protocol level), so this is a
 * plain on-chain ERC20 balance, not a Gateway unified balance.
 */
app.get("/agents/:id/eurc-balance", async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  try {
    const balance = await getEurcBalance(agent.sessionAddress as Hex);
    res.json({ balance: balance.formatted });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Sweeps the agent's EURC balance to the owner's wallet as a plain ERC20 transfer (same chain only). */
app.post("/agents/:id/withdraw-eurc", async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  try {
    const result = await withdrawEurc(agent.sessionPrivateKey as Hex, agent.ownerWallet as Hex);
    if (!result) {
      res.status(409).json({ error: "nothing to withdraw" });
      return;
    }
    res.json({ withdrawal: result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/agents/:id/pause", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  res.json({ agent: toPublicAgent(setAgentStatus(agent.id, "PAUSED")) });
});

app.post("/agents/:id/resume", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  res.json({ agent: toPublicAgent(setAgentStatus(agent.id, "ACTIVE")) });
});

app.post("/agents/:id/rename", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
    return;
  }
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  res.json({ agent: toPublicAgent(setAgentName(agent.id, name.trim())) });
});

/**
 * Targeted challenges: an owner picks a specific opponent from the online
 * roster instead of the blind queue drawing one. The opponent's own driver
 * (see @nanostakes/contender's challenge-polling loop) decides accept/decline
 * by a temperament-based policy — no human in the loop on either side.
 */
app.post("/challenges", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/challenges", req);
  const { gameId, from, to, name } = req.body as { gameId?: string; from?: Address; to?: Address; name?: string };
  if (!gameId || !from || !to) {
    res.status(400).json({ error: "gameId, from, and to are required" });
    return;
  }
  try {
    const challenge = createChallenge(gameId, from, to, name);
    res.json({ challenge });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Incoming (to decide on) and outgoing (to track) challenges for a player.
 * Incoming challenges carry the challenger's ledger record so the responder's
 * accept/decline policy can decide without a second round-trip.
 */
app.get("/challenges", (req: Request, res: Response) => {
  const player = req.query.player as Address | undefined;
  if (!player) {
    res.status(400).json({ error: "?player=<address> is required" });
    return;
  }
  const { incoming, outgoing } = listChallenges(player);
  res.json({
    incoming: incoming.map((c) => ({ ...c, fromRecord: getAgentRecord(c.from) })),
    outgoing,
  });
});

app.post("/challenges/:id/respond", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/challenges/:id/respond", req);
  const { responder, accept } = req.body as { responder?: Address; accept?: boolean };
  if (!responder || typeof accept !== "boolean") {
    res.status(400).json({ error: "responder and accept (boolean) are required" });
    return;
  }
  try {
    const challenge = respondToChallenge(req.params.id, responder, accept);
    res.json({ challenge });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Create a new match. No payment required — payment happens at /stake. */
app.post("/match", (req: Request, res: Response) => {
  const { gameId, players, temperaments, name, stakeAsset } = req.body as {
    gameId: string;
    players: string[];
    temperaments?: Record<string, Temperament>;
    name?: string;
    stakeAsset?: "USDC" | "EURC";
  };
  try {
    const record = createMatch(gameId, players, temperaments ? { temperaments } : undefined, name, stakeAsset);
    emitConcourseEvent({
      type: "match.created",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { players: record.state.players, temperaments: record.meta?.temperaments },
    });
    res.json({ matchId: record.state.matchId, entryStakeEach: ENTRY_STAKE_EACH });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Matchmaking queue: a player joins for a given game (optionally tagging
 * their temperament for the ledger) and is paired automatically as soon as
 * enough players are waiting — no caller needs to know who their opponent
 * will be ahead of time.
 */
app.post("/queue/join", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/queue/join", req);
  const { gameId, player, temperament } = req.body as { gameId: string; player: string; temperament?: Temperament };
  try {
    const result = joinQueue(gameId, player, temperament);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Poll for a match assignment after joining the queue with no immediate match. */
app.get("/queue/poll", (req: Request, res: Response) => {
  const player = req.query.player as string | undefined;
  if (!player) {
    res.status(400).json({ error: "?player=<address> is required" });
    return;
  }
  res.json(pollAssignment(player));
});

app.get("/queue/:gameId/status", (req: Request, res: Response) => {
  res.json(queueStatus(req.params.gameId));
});

/** Bail out of a game's queue without waiting indefinitely — used when an agent's live game choice picks something nobody else is queuing for right now. */
app.post("/queue/:gameId/leave", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/queue/:gameId/leave", req);
  const { player } = req.body as { player: string };
  leaveQueue(req.params.gameId, player);
  res.json({ ok: true });
});

/** Reputation ledger: cumulative wins/losses/PnL per agent across all settled matches. */
app.get("/ledger", (_req: Request, res: Response) => {
  res.json({ leaderboard: getLeaderboard(), byTemperament: getTemperamentStats() });
});

/**
 * Pay the entry stake. Gated by Circle's x402 Gateway middleware — the
 * caller's request is challenged with a 402 until a valid Gateway payment
 * for ENTRY_STAKE_EACH lands in the Warden's own Gateway balance.
 */
app.post(
  "/match/:id/stake",
  gateway.require(`$${ENTRY_STAKE_EACH.toFixed(2)}`),
  (req: PaidRequest, res: Response) => {
    const record = getMatch(req.params.id);
    const rawPayer = req.payment?.payer;
    const payer = rawPayer
      ? record.state.players.find((p) => p.toLowerCase() === rawPayer.toLowerCase())
      : undefined;
    if (!payer) {
      res.status(400).json({ error: "payer is not a registered player in this match" });
      return;
    }
    record.staked[payer] = true;
    if (req.payment?.transaction) {
      record.stakeTxs = { ...(record.stakeTxs ?? {}), [payer]: req.payment.transaction };
    }
    if (record.state.players.every((p) => record.staked[p])) {
      record.status = "ACTIVE";
    }
    persistMatch(record);
    emitConcourseEvent({
      type: "match.staked",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { payer, transaction: req.payment?.transaction, status: record.status },
    });
    res.json({ staked: record.staked, status: record.status, transaction: req.payment?.transaction });
  },
);

/**
 * EURC-denominated stake: the Warden pulls the entry fee directly from the
 * player's session wallet using the stored (encrypted) private key, so no
 * x402 Gateway challenge is needed. Only valid on matches with stakeAsset=EURC.
 */
app.post("/match/:id/stake/eurc", async (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (!record) { res.status(404).json({ error: "unknown match" }); return; }
  if ((record.state as any).stakeAsset !== "EURC") {
    res.status(400).json({ error: "this match uses USDC staking — call /match/:id/stake instead" });
    return;
  }
  const { player } = req.body as { player?: string };
  if (!player) { res.status(400).json({ error: "player address required" }); return; }
  const matchPlayer = record.state.players.find((p) => p.toLowerCase() === player.toLowerCase());
  if (!matchPlayer) { res.status(400).json({ error: "player is not a participant in this match" }); return; }
  if (record.staked[matchPlayer]) { res.status(409).json({ error: "player has already staked" }); return; }

  // Look up the agent to get their session private key
  const agent = getAgentBySessionAddress(matchPlayer);
  if (!agent || !agent.sessionPrivateKey) {
    res.status(400).json({ error: "no owned agent found for this session address — only Warden-managed agents can stake EURC" });
    return;
  }

  try {
    const { getEurcBalance, transferEurc, EURC_ADDRESS } = await import("./eurc.js");
    const stakeAmount = record.state.entryStakeEach;
    const { balance, formatted } = await getEurcBalance(matchPlayer as `0x${string}`);
    const stakeWei = BigInt(Math.round(stakeAmount * 1_000_000)); // 6-decimal EURC
    if (balance < stakeWei) {
      res.status(402).json({ error: `insufficient EURC balance — have ${formatted}, need ${stakeAmount.toFixed(6)}` });
      return;
    }

    // Pull stake from player's session wallet into the Warden's wallet
    const txHash = await transferEurc(
      agent.sessionPrivateKey as `0x${string}`,
      wardenAccount.address as `0x${string}`,
      stakeAmount,
    );

    record.staked[matchPlayer] = true;
    record.stakeTxs = { ...(record.stakeTxs ?? {}), [matchPlayer]: txHash };
    if (record.state.players.every((p) => record.staked[p])) {
      record.status = "ACTIVE";
    }
    persistMatch(record);
    emitConcourseEvent({
      type: "match.staked",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { payer: matchPlayer, transaction: txHash, currency: "EURC", status: record.status },
    });
    res.json({ staked: record.staked, status: record.status, transaction: txHash, currency: "EURC" });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/match/:id/state", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  const viewer = req.query.as as string | undefined;
  if (!viewer) {
    res.status(400).json({ error: "?as=<playerAddress> is required" });
    return;
  }
  res.json(sanitizeForPlayer(record, viewer));
});

/** Public spectator view — no hidden valuations or sealed offers for either player. */
app.get("/match/:id/public", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  const badges = Object.fromEntries(
    record.state.players.map((p) => {
      const ledgerRec = getAgentRecord(p);
      return [p, { temperament: record.meta?.temperaments?.[p] ?? ledgerRec.temperament, standing: ledgerRec.standing }];
    }),
  );
  res.json({ ...(sanitizeForSpectator(record) as object), badges });
});

/** List known matches (most recent first) with enough info to render match cards. */
app.get("/matches", (_req: Request, res: Response) => {
  res.json(
    allMatches()
      .map((r) => ({
        matchId: r.state.matchId,
        name: r.name,
        gameId: r.gameId,
        status: r.status,
        players: r.state.players,
        playerCount: r.state.players.length,
        temperaments: r.meta?.temperaments,
        createdAt: r.createdAt,
        lastMoveAt: r.lastMoveAt,
      }))
      .reverse(),
  );
});

/** Drops AWAITING_STAKES matches older than 5 minutes — abandoned by a driver that rejoined the queue instead of retrying. Nothing is escrowed against an unstaked match, so there's no money to account for. */
app.post("/matches/prune-stale", (_req: Request, res: Response) => {
  const removed = pruneStaleAwaitingStakes();
  res.json({ removed });
});

/** Manual trigger for the same sweep the background interval runs every 60s — mainly for testing/on-demand cleanup. */
app.post("/matches/sweep-abandoned", async (_req: Request, res: Response) => {
  const result = await sweepAbandonedMatches();
  res.json(result);
});

/**
 * Metered MCP surface: the same read-only data as the free routes above
 * (/matches, /match/:id/state, /match/:id/public, /ledger), but priced as
 * sub-cent x402 nanopayments via the Gateway. This is the resource sold to
 * agent frameworks over @nanostakes/mcp-server — the free routes above stay
 * free for the website's own use so this doesn't break the live site.
 *
 * Two price tiers, not one flat rate:
 *  - $0.000001 for global, low-value aggregate reads (/mcp/matches, /mcp/ledger)
 *    — a list of matches or the leaderboard, useful for discovery but not
 *    decision-critical to any single agent.
 *  - $0.00001 (10x) for match-specific reads (/mcp/match/:id/state,
 *    /mcp/match/:id/public) — the exact data an agent needs to decide its
 *    next move in a match it's already committed to, so it's worth more.
 */
app.get("/mcp/matches", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/mcp/matches", req);
  res.json(
    allMatches()
      .map((r) => ({ matchId: r.state.matchId, status: r.status, players: r.state.players }))
      .reverse(),
  );
});

app.get("/mcp/match/:id/state", gateway.require("$0.00001"), (req: PaidRequest, res: Response) => {
  const viewer = req.query.as as string | undefined;
  if (!viewer) {
    res.status(400).json({ error: "?as=<playerAddress> is required" });
    return;
  }
  logMcpPayment("/mcp/match/:id/state", req);
  res.json(sanitizeForPlayer(getMatch(req.params.id), viewer));
});

app.get("/mcp/match/:id/public", gateway.require("$0.00001"), (req: PaidRequest, res: Response) => {
  const record = getMatch(req.params.id);
  const badges = Object.fromEntries(
    record.state.players.map((p) => {
      const ledgerRec = getAgentRecord(p);
      return [p, { temperament: record.meta?.temperaments?.[p] ?? ledgerRec.temperament, standing: ledgerRec.standing }];
    }),
  );
  logMcpPayment("/mcp/match/:id/public", req);
  res.json({ ...(sanitizeForSpectator(record) as object), badges });
});

app.get("/mcp/ledger", gateway.require("$0.000001"), (req: PaidRequest, res: Response) => {
  logMcpPayment("/mcp/ledger", req);
  res.json({ leaderboard: getLeaderboard(), byTemperament: getTemperamentStats() });
});

/** Traction numbers for the metered MCP surface: total nanopayments, revenue, avg price, unique payers. */
app.get("/mcp/revenue", (_req: Request, res: Response) => {
  res.json(getMcpRevenueStats());
});

app.post("/match/:id/move", gateway.require("$0.00001"), async (req: PaidRequest, res: Response) => {
  logMcpPayment("/match/:id/move", req);
  try {
    const record = getMatch(req.params.id);
    if (record.status !== "ACTIVE") {
      res.status(409).json({ error: `match is not active (status: ${record.status})` });
      return;
    }
    const { player, move } = req.body as { player: string; move: unknown };
    const game = getGame(record.gameId);
    const { state, events } = game.applyMove(record.state, player, move as never);
    record.state = state as MatchRecord["state"];
    record.events.push(...events);

    // Prompt War's winner isn't computed by the pure GameEngine formula every
    // other game uses — it needs a neutral LLM judge call, which the engine
    // interface has no room for (applyMove is synchronous, no I/O). Special-
    // cased here rather than generalizing GameEngine for the one consumer
    // that needs it.
    if (record.gameId === "promptwar" && (record.state as { phase?: string }).phase === "JUDGING") {
      const promptWarState = record.state as PromptWarState;
      const { winner, rationale } = await judgePromptWar(promptWarState);
      promptWarState.winner = winner;
      promptWarState.judgeRationale = rationale;
      promptWarState.phase = "DONE";
    }

    persistMatch(record);

    emitConcourseEvent({
      type: "match.move",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { player, move, events },
    });

    let payoutTxs: Record<string, string> | undefined;
    if (game.isTerminal(record.state)) {
      payoutTxs = await settleMatch(record);
      emitConcourseEvent({
        type: "match.settled",
        matchId: record.state.matchId,
        gameId: record.gameId,
        at: Date.now(),
        data: { payoutTxs },
      });
    }

    res.json({
      state: sanitizeForPlayer(record, player),
      events,
      ...(payoutTxs ? { settled: true, payoutTxs } : {}),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Retry settlement for a match whose engine state is terminal but whose payout never landed (e.g. Gateway batch settlement was still in flight). Safe to call repeatedly. */
app.post("/match/:id/settle", async (req: Request, res: Response) => {
  try {
    const record = getMatch(req.params.id);
    const game = getGame(record.gameId);
    if (!game.isTerminal(record.state)) {
      res.status(409).json({ error: "match is not terminal yet" });
      return;
    }
    const payoutTxs = await settleMatch(record);
    emitConcourseEvent({
      type: "match.settled",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { payoutTxs },
    });
    res.json({ settled: true, payoutTxs });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

/**
 * Concourse live event feed (SSE). Pushes match.created / match.staked /
 * match.move / match.settled as they happen — the spectator dashboard uses
 * this instead of polling for the event log (it still polls /match/:id/public
 * and /ledger for full state snapshots, since SSE only carries deltas).
 */
app.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(":ok\n\n");

  const unsubscribe = subscribeConcourse((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  req.on("close", unsubscribe);
});

// ---------------------------------------------------------------------------
// Broker dispute routes (Brinkmanship only)
// ---------------------------------------------------------------------------

/**
 * Returns open dispute opportunities for a Broker to mediate.
 * A dispute opportunity is a Brinkmanship round where both players'
 * asks conflict (sum > 1.0) and the round has NOT yet resolved.
 */
app.get("/matches/:id/dispute-opportunities", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (!record) { res.status(404).json({ error: "unknown match" }); return; }
  if (record.gameId !== "brinkmanship") {
    res.json({ disputes: [] }); return;
  }
  const state = record.state as any;
  const disputes: unknown[] = [];
  for (const round of (state.rounds ?? [])) {
    if (!round.resolved) {
      const players = state.players as string[];
      const [a, b] = players;
      const askA = round.offers?.[a];
      const askB = round.offers?.[b];
      if (askA != null && askB != null && askA + askB > 1.0) {
        disputes.push({
          roundIndex: round.index,
          askA, askB,
          conflictAmount: (askA + askB - 1.0) * (round.escalated?.[a] || round.escalated?.[b] ? round.cap : round.basePot),
        });
      }
    }
  }
  res.json({ disputes });
});

/**
 * A Broker agent submits a mediation offer for a conflicted round.
 * If both players accept (POST /matches/:id/broker-offer/:offerId/respond),
 * the broker's fee is deducted from the pot and the suggested resolution applied.
 */
app.post("/matches/:id/broker-offer", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (!record) { res.status(404).json({ error: "unknown match" }); return; }
  const { roundIndex, suggestedResolutionA, suggestedResolutionB, brokerAddress, feeUsdc } = req.body as {
    roundIndex: number;
    suggestedResolutionA: number;
    suggestedResolutionB: number;
    brokerAddress: string;
    feeUsdc: number;
  };
  if (!brokerAddress || feeUsdc == null) {
    res.status(400).json({ error: "brokerAddress and feeUsdc required" });
    return;
  }
  const offerId = randomUUID();
  // Store broker offer on the match record
  (record as any).brokerOffers ??= {};
  (record as any).brokerOffers[offerId] = {
    roundIndex, suggestedResolutionA, suggestedResolutionB, brokerAddress, feeUsdc,
    responses: {},
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  persistMatch(record);
  res.json({ offerId, status: "pending" });
});

app.post("/matches/:id/broker-offer/:offerId/respond", async (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (!record) { res.status(404).json({ error: "unknown match" }); return; }
  const offer = (record as any).brokerOffers?.[req.params.offerId];
  if (!offer) { res.status(404).json({ error: "unknown broker offer" }); return; }
  const { player, accept } = req.body as { player: string; accept: boolean };
  offer.responses[player] = accept;
  const players = record.state.players;
  const allResponded = players.every((p: string) => offer.responses[p] !== undefined);
  const allAccepted = players.every((p: string) => offer.responses[p] === true);
  if (allResponded && allAccepted) {
    offer.status = "accepted";
    // Apply resolution to the round — force overwrite offers to the suggested values
    const state = record.state as any;
    const round = state.rounds?.[offer.roundIndex - 1];
    if (round && !round.resolved) {
      round.offers[players[0]] = offer.suggestedResolutionA;
      round.offers[players[1]] = offer.suggestedResolutionB;
      // Deduct broker fee from pot by reducing effective offers proportionally
      // (simple model: if broker fee > 0, reduce both suggested resolutions proportionally)
      if (offer.feeUsdc > 0) {
        const pot = round.escalated?.[players[0]] || round.escalated?.[players[1]] ? round.cap : round.basePot;
        const feeFraction = Math.min(offer.feeUsdc / pot, 0.1); // cap broker fee at 10% of pot
        round.offers[players[0]] = Math.max(0, offer.suggestedResolutionA * (1 - feeFraction));
        round.offers[players[1]] = Math.max(0, offer.suggestedResolutionB * (1 - feeFraction));
        // Record broker earnings in ledger
        recordBrokerMediation(offer.brokerAddress, offer.feeUsdc * pot);
      }
    }
    record.state = state;
  } else if (allResponded && !allAccepted) {
    offer.status = "rejected";
  }
  persistMatch(record);
  res.json({ status: offer.status, offer });
});

// ---------------------------------------------------------------------------
// Tournament routes
// ---------------------------------------------------------------------------

app.post("/tournaments", (req: Request, res: Response) => {
  try {
    const { name, gameId, format, entryFeeUsdc, prizePoolUsdc, maxPlayers } = req.body as {
      name?: string;
      gameId?: string;
      format?: string;
      entryFeeUsdc?: number;
      prizePoolUsdc?: number;
      maxPlayers?: number;
    };
    const tournament = createTournament({
      name: name ?? "Tournament",
      gameId: gameId ?? "brinkmanship",
      format: (format as "round-robin" | "single-elimination") ?? "round-robin",
      entryFeeUsdc: entryFeeUsdc ?? 1,
      prizePoolUsdc: prizePoolUsdc ?? 10,
      maxPlayers: maxPlayers ?? 4,
    });
    res.json({ tournament });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.post("/tournaments/:id/join", (req: Request, res: Response) => {
  try {
    const { player } = req.body as { player?: Address };
    if (!player) { res.status(400).json({ error: "player is required" }); return; }
    const tournament = joinTournament(req.params.id, player);
    res.json({ tournament });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

app.get("/tournaments/:id", (req: Request, res: Response) => {
  const t = getTournament(req.params.id);
  if (!t) { res.status(404).json({ error: "unknown tournament" }); return; }
  res.json({ tournament: t });
});

app.get("/tournaments/:id/standings", (req: Request, res: Response) => {
  const t = getTournament(req.params.id);
  if (!t) { res.status(404).json({ error: "unknown tournament" }); return; }
  const ranked = Object.entries(t.standings)
    .sort(([, a], [, b]) => b.points - a.points)
    .map(([address, stats], i) => ({ rank: i + 1, address, ...stats }));
  res.json({ tournamentId: t.id, status: t.status, standings: ranked });
});

app.get("/tournaments", (_req: Request, res: Response) => {
  res.json({ tournaments: listTournaments() });
});

// ─── Metrics ──────────────────────────────────────────────────────────────

app.get("/metrics", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(renderMetrics());
});

// ─── Coach ────────────────────────────────────────────────────────────────

app.post("/agents/:id/analyze-match", (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) { res.status(404).json({ error: "unknown agent" }); return; }
  const { matchId } = req.body as { matchId?: string };
  if (!matchId) { res.status(400).json({ error: "matchId required" }); return; }
  const record = getMatch(matchId);
  if (!record) { res.status(404).json({ error: "unknown match" }); return; }
  if (record.gameId !== "brinkmanship") { res.status(400).json({ error: "coach only supports brinkmanship matches" }); return; }
  const analysis = analyzeMatch(record.state as any, agent.sessionAddress);
  res.json({ analysis });
});

// ─── Social ───────────────────────────────────────────────────────────────

app.post("/messages", (req: Request, res: Response) => {
  try {
    const { from, to, text } = req.body as { from?: string; to?: string; text?: string };
    if (!from || !to || !text) { res.status(400).json({ error: "from, to, text required" }); return; }
    res.json({ message: sendMessage(from, to, text) });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.get("/messages", (req: Request, res: Response) => {
  const { address, since } = req.query as { address?: string; since?: string };
  if (!address) { res.status(400).json({ error: "?address= required" }); return; }
  res.json({ messages: getMessages(address, since) });
});
app.post("/messages/:id/read", (req: Request, res: Response) => {
  const { reader } = req.body as { reader?: string };
  if (!reader) { res.status(400).json({ error: "reader required" }); return; }
  markRead(req.params.id, reader);
  res.json({ ok: true });
});
app.post("/clans", (req: Request, res: Response) => {
  try {
    const { founder, name, tag, description } = req.body as { founder?: string; name?: string; tag?: string; description?: string };
    if (!founder || !name || !tag) { res.status(400).json({ error: "founder, name, tag required" }); return; }
    res.json({ clan: createClan(founder, name, tag, description ?? "") });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.get("/clans", (_req: Request, res: Response) => res.json({ clans: listClans() }));
app.get("/clans/:id", (req: Request, res: Response) => {
  const clan = getClan(req.params.id);
  if (!clan) { res.status(404).json({ error: "unknown clan" }); return; }
  res.json({ clan });
});
app.post("/clans/:id/join", (req: Request, res: Response) => {
  try {
    const { member } = req.body as { member?: string };
    if (!member) { res.status(400).json({ error: "member required" }); return; }
    res.json({ clan: joinClan(req.params.id, member) });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.post("/clans/:id/leave", (req: Request, res: Response) => {
  try {
    const { member } = req.body as { member?: string };
    if (!member) { res.status(400).json({ error: "member required" }); return; }
    leaveClan(req.params.id, member);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── Prediction Markets ───────────────────────────────────────────────────

app.post("/predictions/markets", (req: Request, res: Response) => {
  try {
    const { matchId } = req.body as { matchId?: string };
    if (!matchId) { res.status(400).json({ error: "matchId required" }); return; }
    res.json({ market: openMarket(matchId) });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
app.get("/predictions/markets", (_req: Request, res: Response) => res.json({ markets: listOpenMarkets() }));
app.get("/predictions/markets/:matchId", (req: Request, res: Response) => {
  const market = getMarket(req.params.matchId);
  if (!market) { res.status(404).json({ error: "no market for this match" }); return; }
  res.json({ market });
});
app.post("/predictions/markets/:matchId/predict", (req: Request, res: Response) => {
  try {
    const { predictor, predictedWinner, stakeUsdc } = req.body as { predictor?: string; predictedWinner?: string; stakeUsdc?: number };
    if (!predictor || !predictedWinner || !stakeUsdc) { res.status(400).json({ error: "predictor, predictedWinner, stakeUsdc required" }); return; }
    res.json({ prediction: placePrediction(req.params.matchId, predictor, predictedWinner, stakeUsdc) });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

// ─── Auto-tournaments ─────────────────────────────────────────────────────

app.post("/admin/auto-tournaments/start", (_req: Request, res: Response) => {
  startAutoTournaments();
  res.json({ ok: true, message: "Hourly exhibition scheduler started" });
});
app.post("/admin/auto-tournaments/stop", (_req: Request, res: Response) => {
  stopAutoTournaments();
  res.json({ ok: true, message: "Exhibition scheduler stopped" });
});

/**
 * Catches synchronous throws from route handlers (e.g. `getMatch`/`getAgent`
 * on an unknown id) that Express already funnels here, and returns clean
 * JSON instead of its default HTML 500 page. Registered after every route.
 * Does NOT catch rejected promises from `async` handlers — those are each
 * wrapped in their own try/catch instead, since an uncaught rejection there
 * would otherwise crash the whole process on Node's default settings.
 */
app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  const status = /^unknown (match|agent|challenge)/.test(err.message) ? 404 : 500;
  res.status(status).json({ error: err.message });
});

const ABANDON_SWEEP_INTERVAL_MS = 60_000;

const port = Number(process.env.PORT ?? process.env.WARDEN_PORT ?? 4000);
app.listen(port, () => {
  console.log(`Warden listening on :${port} (address ${wardenAccount.address})`);
  startAgentRuntime(`http://localhost:${port}`);
  setInterval(() => {
    sweepAbandonedMatches()
      .then(({ forfeited, voided }) => {
        if (forfeited || voided) console.log(`[abandon] swept ${forfeited} forfeited, ${voided} voided`);
      })
      .catch((err) => console.error(`[abandon] sweep failed: ${(err as Error).message}`));
  }, ABANDON_SWEEP_INTERVAL_MS);
});
