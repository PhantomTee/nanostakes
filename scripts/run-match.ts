/**
 * Phase-1 end-to-end orchestrator: creates a Brinkmanship match on the
 * Warden, has both Contenders pay their real x402 entry stake on Arc
 * Testnet, then drives the full 5-round negotiate/offer loop via Groq-hosted
 * LLM decisions until the match settles and USDC actually moves.
 */
import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import { TemperamentAgent } from "@nanostakes/contender";
import type { Temperament } from "@nanostakes/shared";

const WARDEN_URL = process.env.WARDEN_URL ?? "http://localhost:4000";
const GROQ_API_KEY = required("GROQ_API_KEY");
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const aKey = required("CONTENDER_A_PRIVATE_KEY") as Hex;
const bKey = required("CONTENDER_B_PRIVATE_KEY") as Hex;
const temperamentA = (process.env.TEMPERAMENT_A ?? "NEUTRAL") as Temperament;
const temperamentB = (process.env.TEMPERAMENT_B ?? "NEUTRAL") as Temperament;

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env var ${name} is required — see .env.example`);
  return v;
}

const clientA = new GatewayClient({ chain: "arcTestnet", privateKey: aKey });
const clientB = new GatewayClient({ chain: "arcTestnet", privateKey: bKey });
const agentA = new TemperamentAgent("Contender-A", temperamentA, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });
const agentB = new TemperamentAgent("Contender-B", temperamentB, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });

const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";
/** Only real on-chain hashes (0x...) resolve on ArcScan — Gateway transfer IDs from `pay()` are off-chain batch references, not tx hashes, and settle on-chain later. */
const txLink = (hashOrId: string) =>
  hashOrId.startsWith("0x") ? `${EXPLORER_TX_BASE}${hashOrId}` : `${hashOrId} (Gateway transfer ID — settles on-chain in batch)`;

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

function opponentOf(state: any, me: string): string {
  return state.players.find((p: string) => p !== me);
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
  console.log(`Contender A: ${clientA.address} (${temperamentA})`);
  console.log(`Contender B: ${clientB.address} (${temperamentB})`);

  console.log("Creating match...");
  const createRes = await fetch(`${WARDEN_URL}/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: "brinkmanship",
      players: [clientA.address, clientB.address],
      temperaments: { [clientA.address]: temperamentA, [clientB.address]: temperamentB },
    }),
  });
  const { matchId, entryStakeEach } = await createRes.json();
  console.log(`Match ${matchId} created. Entry stake each: $${entryStakeEach}`);

  console.log("Paying entry stakes via Circle x402 Gateway (Arc Testnet)...");
  const [payA, payB] = await Promise.all([
    clientA.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
    clientB.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
  ]);
  console.log(`A staked: ${txLink(payA.transaction)}`);
  console.log(`B staked: ${txLink(payB.transaction)}`);

  let settled = false;
  while (!settled) {
    const stateA = await getState(matchId, clientA.address);
    if (stateA.status === "SETTLED") break;

    const round = stateA.currentRoundIndex;
    const phase = stateA.phase;
    const pending = stateA.players.filter((p: string) => !stateA.acted[p]);

    for (const player of pending) {
      const isA = player === clientA.address;
      const agent = isA ? agentA : agentB;
      const viewerState = isA ? stateA : await getState(matchId, clientB.address);
      const r = viewerState.rounds[round];

      if (phase === "NEGOTIATE") {
        const incoming = r.messages.filter((m: any) => m.to === player);
        const decision = await agent.decideNegotiate({
          round: r.index,
          myValuation: r.myValuation,
          incomingMessages: incoming.map((m: any) => ({ from: m.from, text: m.text })),
          history: buildHistory(viewerState, player),
        });
        if (decision.message) {
          const result = await postMove(matchId, player, {
            type: "message",
            to: opponentOf(viewerState, player),
            text: decision.message,
          });
          console.log(`[round ${r.index}] ${agent.name} -> "${decision.message}"`);
        }
        await postMove(matchId, player, { type: "claim", value: decision.claim });
        console.log(`[round ${r.index}] ${agent.name} claims ${decision.claim.toFixed(2)}`);
      } else if (phase === "OFFER") {
        const opp = opponentOf(viewerState, player);
        const decision = await agent.decideOffer({
          round: r.index,
          myValuation: r.myValuation,
          myClaim: r.claims[player],
          opponentClaim: r.claims[opp] ?? null,
          cap: r.cap,
          basePot: r.basePot,
        });
        const moveResult = await postMove(matchId, player, {
          type: "offer",
          ask: decision.ask,
          escalate: decision.escalate,
        });
        console.log(
          `[round ${r.index}] ${agent.name} offers ${decision.ask.toFixed(2)}${decision.escalate ? " (escalate)" : ""}`,
        );
        if (moveResult.settled) {
          console.log("Match settled. Payout transactions:");
          for (const [addr, tx] of Object.entries(moveResult.payoutTxs as Record<string, string>)) {
            console.log(`  ${addr} -> ${txLink(tx)}`);
          }
          settled = true;
        }
      }
    }
  }

  const finalA = await clientA.getBalances();
  const finalB = await clientB.getBalances();
  console.log(`Final Gateway balance A: ${finalA.gateway.formattedAvailable} USDC`);
  console.log(`Final Gateway balance B: ${finalB.gateway.formattedAvailable} USDC`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
