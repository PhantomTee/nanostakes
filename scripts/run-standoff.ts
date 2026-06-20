/**
 * End-to-end run of the Standoff game (second Bracket game, proves the
 * plugin pattern generalizes) — real x402 stakes, one simultaneous
 * COOPERATE/DEFECT commit each, real on-chain payout.
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

const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";
const txLink = (hashOrId: string) =>
  hashOrId.startsWith("0x") ? `${EXPLORER_TX_BASE}${hashOrId}` : `${hashOrId} (Gateway transfer ID — settles on-chain in batch)`;

const clientA = new GatewayClient({ chain: "arcTestnet", privateKey: aKey });
const clientB = new GatewayClient({ chain: "arcTestnet", privateKey: bKey });
const agentA = new TemperamentAgent("Contender-A", temperamentA, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });
const agentB = new TemperamentAgent("Contender-B", temperamentB, { groqApiKey: GROQ_API_KEY, openrouterApiKey: OPENROUTER_API_KEY });

async function decideChoice(agent: TemperamentAgent): Promise<"COOPERATE" | "DEFECT"> {
  // Standoff is a single simultaneous commit — reuse decideOffer's escalate
  // signal as a proxy for "defect" since the engine doesn't need a bespoke
  // negotiate/offer split for a one-shot game.
  const decision = await agent.decideOffer({
    round: 1,
    myValuation: 0.5,
    myClaim: 0.5,
    opponentClaim: null,
    cap: 1,
    basePot: 1,
  });
  return decision.escalate ? "DEFECT" : "COOPERATE";
}

async function main() {
  console.log(`Contender A: ${clientA.address} (${temperamentA})`);
  console.log(`Contender B: ${clientB.address} (${temperamentB})`);

  const createRes = await fetch(`${WARDEN_URL}/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId: "standoff",
      players: [clientA.address, clientB.address],
      temperaments: { [clientA.address]: temperamentA, [clientB.address]: temperamentB },
    }),
  });
  const { matchId, entryStakeEach } = await createRes.json();
  console.log(`Match ${matchId} created. Entry stake each: $${entryStakeEach}`);

  const [payA, payB] = await Promise.all([
    clientA.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
    clientB.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
  ]);
  console.log(`A staked: ${txLink(payA.transaction)}`);
  console.log(`B staked: ${txLink(payB.transaction)}`);

  const [choiceA, choiceB] = await Promise.all([decideChoice(agentA), decideChoice(agentB)]);
  console.log(`Contender-A chooses ${choiceA}`);
  console.log(`Contender-B chooses ${choiceB}`);

  await fetch(`${WARDEN_URL}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: clientA.address, move: { type: "choice", value: choiceA } }),
  });
  const finalMove = await fetch(`${WARDEN_URL}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: clientB.address, move: { type: "choice", value: choiceB } }),
  });
  const result = await finalMove.json();
  console.log("Match settled. Payout transactions:");
  for (const [addr, tx] of Object.entries(result.payoutTxs as Record<string, string>)) {
    console.log(`  ${addr} -> ${txLink(tx)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
