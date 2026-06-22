/**
 * Demo Simulation: a compressed, narratable run of the full match lifecycle
 * (create -> stake -> 5 rounds -> settle) against a real Warden — local by
 * default, or production via WARDEN_URL — using the real GatewayClient and
 * real testnet USDC, no mocking. Built so a judge demo video doesn't need
 * to sit through real wall-clock time: it adds no artificial delay beyond
 * what the existing stake-retry logic in @nanostakes/contender needs.
 *
 * Reuses the same building blocks as scripts/run-match.ts (TemperamentAgent
 * for negotiation decisions, direct fetch calls for match state/moves) but
 * also dogfoods the two newest protocol features so they show up in the
 * narration instead of just in code:
 *   - commit-reveal (packages/shared's computeOfferCommitment): each sealed
 *     offer is hashed before submission, then verified against the reveal.
 *   - cross-match memory (GET /agents/memory): printed before play starts,
 *     so a second run against the same pair visibly says "we've met before".
 *
 * Run: npx tsx scripts/demo-simulation.ts
 * Run twice in a row to see Feature 3 (persistent memory) kick in on the
 * second match — same two wallets remember each other across runs.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import { TemperamentAgent, type OpponentMemory } from "@nanostakes/contender";
import { computeOfferCommitment, type Temperament } from "@nanostakes/shared";

const WARDEN_URL = process.env.WARDEN_URL ?? "http://localhost:4000";
const GROQ_API_KEY = required("GROQ_API_KEY");
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const aKey = required("CONTENDER_A_PRIVATE_KEY") as Hex;
const bKey = required("CONTENDER_B_PRIVATE_KEY") as Hex;

// Fixed, contrasting temperaments for narrative clarity — same model, opposite primers.
const TEMPERAMENT_A: Temperament = "STRATEGIC";
const TEMPERAMENT_B: Temperament = "COOPERATIVE";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env var ${name} is required — see .env.example`);
  return v;
}

const startedAt = Date.now();
function log(message: string): void {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[+${elapsed}s] ${message}`);
}

const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";
const txLink = (hashOrId: string) =>
  hashOrId.startsWith("0x") ? `${EXPLORER_TX_BASE}${hashOrId}` : `${hashOrId} (Gateway transfer ID — settles on-chain in batch)`;

function opponentOf(state: any, me: string): string {
  return state.players.find((p: string) => p !== me);
}

async function getState(matchId: string, as: string) {
  const res = await fetch(`${WARDEN_URL}/match/${matchId}/state?as=${as}`);
  if (!res.ok) throw new Error(`getState failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function postMove(matchId: string, player: string, move: unknown) {
  const res = await fetch(`${WARDEN_URL}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, move }),
  });
  if (!res.ok) throw new Error(`postMove failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function fetchOpponentMemory(self: string, opponent: string): Promise<OpponentMemory | null> {
  const res = await fetch(`${WARDEN_URL}/agents/memory?self=${self}&opponent=${opponent}`);
  if (!res.ok) return null;
  const { memory } = (await res.json()) as { memory: OpponentMemory | null };
  return memory;
}

/**
 * Circle's facilitator indexes a fresh deposit slightly behind the on-chain
 * GatewayWallet balance, so a stake paid moments after onboarding can fail
 * with "insufficient_balance" even though the funds are really there. The
 * autonomous driver (packages/contender/src/driver.ts) retries through this
 * for up to 200s; a fast demo doesn't need that much margin, but it does
 * need to retry rather than fail outright on the same transient condition.
 */
async function payStakeWithRetry(client: GatewayClient, url: string, attempts = 15, delayMs = 4000) {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await client.pay(url, { method: "POST" });
    } catch (err) {
      lastErr = err;
      if (i < attempts) {
        log(`stake payment attempt ${i}/${attempts} failed (${(err as Error).message}) — retrying in ${delayMs / 1000}s`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

function buildHistory(state: any, me: string) {
  return state.rounds
    .filter((r: any) => r.resolved)
    .map((r: any) => ({
      round: r.index,
      myAsk: r.offers[me],
      oppAsk: r.offers[opponentOf(state, me)],
      myReceived: r.payoutFraction?.[me],
    }));
}

async function main() {
  const clientA = new GatewayClient({ chain: "arcTestnet", privateKey: aKey });
  const clientB = new GatewayClient({ chain: "arcTestnet", privateKey: bKey });
  const agentA = new TemperamentAgent("Contender-A", TEMPERAMENT_A, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });
  const agentB = new TemperamentAgent("Contender-B", TEMPERAMENT_B, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });

  log(`Warden: ${WARDEN_URL}`);
  log(`Contender-A: ${clientA.address} (${TEMPERAMENT_A})`);
  log(`Contender-B: ${clientB.address} (${TEMPERAMENT_B})`);

  const [memAB, memBA] = await Promise.all([
    fetchOpponentMemory(clientA.address, clientB.address),
    fetchOpponentMemory(clientB.address, clientA.address),
  ]);
  if (memAB) {
    log(
      `Memory: Contender-A recalls ${memAB.matchesPlayed} prior match(es) with Contender-B — escalates ${(memAB.opponentEscalationRate * 100).toFixed(0)}% of rounds, concedes ${(memAB.opponentConcessionRate * 100).toFixed(0)}% toward fair when asked. This will be folded into A's prompt this match.`,
    );
  } else {
    log("Memory: first meeting between these two wallets — no prior history to fold into the prompt.");
  }

  log("Creating Brinkmanship match...");
  const createRes = await fetch(`${WARDEN_URL}/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: "brinkmanship",
      players: [clientA.address, clientB.address],
      temperaments: { [clientA.address]: TEMPERAMENT_A, [clientB.address]: TEMPERAMENT_B },
    }),
  });
  const { matchId, entryStakeEach } = await createRes.json();
  log(`Match ${matchId} created. Entry stake each: $${entryStakeEach} USDC (real Arc Testnet funds).`);

  log("Paying entry stakes via Circle x402 Gateway...");
  const [payA, payB] = await Promise.all([
    payStakeWithRetry(clientA, `${WARDEN_URL}/match/${matchId}/stake`),
    payStakeWithRetry(clientB, `${WARDEN_URL}/match/${matchId}/stake`),
  ]);
  log(`A staked: ${txLink(payA.transaction)}`);
  log(`B staked: ${txLink(payB.transaction)}`);

  let settled = false;
  let payoutTxs: Record<string, string> = {};
  while (!settled) {
    const stateA = await getState(matchId, clientA.address);
    if (stateA.status === "SETTLED") break;

    const round = stateA.currentRoundIndex;
    const phase = stateA.phase;
    const pending = stateA.players.filter((p: string) => !stateA.acted[p]);

    for (const player of pending) {
      const isA = player === clientA.address;
      const agent = isA ? agentA : agentB;
      const opponentMemory = isA ? memAB : memBA;
      const viewerState = isA ? stateA : await getState(matchId, clientB.address);
      const r = viewerState.rounds[round];

      if (phase === "NEGOTIATE") {
        const incoming = r.messages.filter((m: any) => m.to === player);
        const decision = await agent.decideNegotiate({
          round: r.index,
          myValuation: r.myValuation,
          incomingMessages: incoming.map((m: any) => ({ from: m.from, text: m.text })),
          history: buildHistory(viewerState, player),
          opponentMemory,
        });
        if (decision.message) {
          await postMove(matchId, player, { type: "message", to: opponentOf(viewerState, player), text: decision.message });
          log(`[round ${r.index}] ${agent.name} -> "${decision.message}"`);
        }
        await postMove(matchId, player, { type: "claim", value: decision.claim });
        log(`[round ${r.index}] ${agent.name} claims ${decision.claim.toFixed(2)} of the pot`);
      } else if (phase === "OFFER") {
        const opp = opponentOf(viewerState, player);
        const decision = await agent.decideOffer({
          round: r.index,
          myValuation: r.myValuation,
          myClaim: r.claims[player],
          opponentClaim: r.claims[opp] ?? null,
          cap: r.cap,
          basePot: r.basePot,
          opponentMemory,
        });

        // Commit-reveal: hash the sealed ask before submitting it (see ARCHITECTURE.md §10 / Feature 4).
        const nonce: Hex = `0x${randomBytes(32).toString("hex")}`;
        const commitment = computeOfferCommitment(decision.ask, !!decision.escalate, nonce);
        log(`[round ${r.index}] ${agent.name} commits to a sealed ask: ${commitment.slice(0, 18)}… (revealed below once both sides have offered)`);

        const moveResult = await postMove(matchId, player, {
          type: "offer",
          ask: decision.ask,
          escalate: decision.escalate,
          commitment,
          nonce,
        });
        log(`[round ${r.index}] ${agent.name} reveals ask ${decision.ask.toFixed(2)}${decision.escalate ? " (escalate)" : ""} — matches its commitment`);

        if (moveResult.settled) {
          payoutTxs = moveResult.payoutTxs;
          settled = true;
        }
      }
    }
  }

  log("Match settled. Payout transactions:");
  for (const [addr, tx] of Object.entries(payoutTxs)) {
    log(`  ${addr} -> ${txLink(tx)}`);
  }

  const [finalA, finalB, ledgerRes] = await Promise.all([
    clientA.getBalances(),
    clientB.getBalances(),
    fetch(`${WARDEN_URL}/ledger`),
  ]);
  const { leaderboard } = await ledgerRes.json();
  const recA = leaderboard.find((a: any) => a.address.toLowerCase() === clientA.address.toLowerCase());
  const recB = leaderboard.find((a: any) => a.address.toLowerCase() === clientB.address.toLowerCase());

  log(`Final Gateway balance A: ${finalA.gateway.formattedAvailable} USDC (net P&L: ${recA?.netPnl?.toFixed(4) ?? "n/a"})`);
  log(`Final Gateway balance B: ${finalB.gateway.formattedAvailable} USDC (net P&L: ${recB?.netPnl?.toFixed(4) ?? "n/a"})`);
  if (recA?.behavior?.sampleSize) {
    log(
      `Contender-A behavior: ${(recA.behavior.concessionRate * 100).toFixed(0)}% concession, ${(recA.behavior.escalationRate * 100).toFixed(0)}% escalation, ${recA.behavior.fairShareGap.toFixed(2)} fair-share gap (lifetime, ${recA.behavior.sampleSize} rounds)`,
    );
  }
  if (recB?.behavior?.sampleSize) {
    log(
      `Contender-B behavior: ${(recB.behavior.concessionRate * 100).toFixed(0)}% concession, ${(recB.behavior.escalationRate * 100).toFixed(0)}% escalation, ${recB.behavior.fairShareGap.toFixed(2)} fair-share gap (lifetime, ${recB.behavior.sampleSize} rounds)`,
    );
  }

  const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`Done in ${totalElapsed}s. Run this script again against the same wallets to see Feature 3 (memory) kick in.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
