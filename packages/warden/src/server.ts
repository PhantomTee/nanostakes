import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { formatUnits, type Hex } from "viem";
import { ENTRY_STAKE_EACH, getGame } from "@nanostakes/bracket";
import { gateway, wardenAccount } from "./gateway.js";
import { createMatch, getMatch, allMatches, sanitizeForPlayer, sanitizeForSpectator, type MatchRecord } from "./state.js";
import { settleMatch } from "./settle.js";
import { getLeaderboard, getTemperamentStats, getAgentRecord } from "./ledger.js";
import { joinQueue, pollAssignment, queueStatus } from "./matchmaking.js";
import { emitConcourseEvent, subscribeConcourse } from "./events.js";
import {
  createAgent,
  getAgent,
  listAgentsByOwner,
  setAgentStatus,
  toPublicAgent,
} from "./agents.js";
import { provisionSessionWallet } from "./wallets.js";
import { startAgentRuntime } from "./runtime.js";
import { recordMcpPayment, getMcpRevenueStats } from "./mcpRevenue.js";
import type { Temperament } from "@nanostakes/shared";

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

/** Sweeps the agent's Gateway balance back to the owner's wallet and pauses it. */
app.post("/agents/:id/withdraw", async (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "unknown agent" });
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

/** Create a new match. No payment required — payment happens at /stake. */
app.post("/match", (req: Request, res: Response) => {
  const { gameId, players, temperaments } = req.body as {
    gameId: string;
    players: string[];
    temperaments?: Record<string, Temperament>;
  };
  try {
    const record = createMatch(gameId, players, temperaments ? { temperaments } : undefined);
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
app.post("/queue/join", (req: Request, res: Response) => {
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

/** List known matches (most recent first) so the spectator page can find one without a matchId. */
app.get("/matches", (_req: Request, res: Response) => {
  res.json(
    allMatches()
      .map((r) => ({ matchId: r.state.matchId, status: r.status, players: r.state.players }))
      .reverse(),
  );
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

app.post("/match/:id/move", async (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (record.status !== "ACTIVE") {
    res.status(409).json({ error: `match is not active (status: ${record.status})` });
    return;
  }
  const { player, move } = req.body as { player: string; move: unknown };
  const game = getGame(record.gameId);
  try {
    const { state, events } = game.applyMove(record.state, player, move as never);
    record.state = state as MatchRecord["state"];
    record.events.push(...events);

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
  const record = getMatch(req.params.id);
  const game = getGame(record.gameId);
  if (!game.isTerminal(record.state)) {
    res.status(409).json({ error: "match is not terminal yet" });
    return;
  }
  try {
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

const port = Number(process.env.PORT ?? process.env.WARDEN_PORT ?? 4000);
app.listen(port, () => {
  console.log(`Warden listening on :${port} (address ${wardenAccount.address})`);
  startAgentRuntime(`http://localhost:${port}`);
});
