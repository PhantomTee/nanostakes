import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const WARDEN_URL = "http://localhost:4099";
const aKey = process.env.CONTENDER_A_PRIVATE_KEY as Hex;
const bKey = process.env.CONTENDER_B_PRIVATE_KEY as Hex;

async function main() {
  const clientA = new GatewayClient({ chain: "arcTestnet", privateKey: aKey });
  const clientB = new GatewayClient({ chain: "arcTestnet", privateKey: bKey });

  const createRes = await fetch(`${WARDEN_URL}/match`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gameId: "promptwar", players: [clientA.address, clientB.address] }),
  });
  const { matchId } = await createRes.json();
  console.log(`Match: ${matchId}`);

  await Promise.all([
    clientA.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
    clientB.pay(`${WARDEN_URL}/match/${matchId}/stake`, { method: "POST" }),
  ]);
  console.log("Both staked.");

  const moveA = await fetch(`${WARDEN_URL}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: clientA.address, move: { type: "pitch", text: "Buy my widget, it's the best on the market." } }),
  });
  console.log("A pitched:", (await moveA.json()).state?.phase);

  const moveB = await fetch(`${WARDEN_URL}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player: clientB.address, move: { type: "pitch", text: "I'll fix your exact pain point with a 30-day money-back guarantee." } }),
  });
  const resultB = await moveB.json();
  console.log("B pitched, settled:", resultB.settled, "payoutTxs:", resultB.payoutTxs);
  console.log("Final state:", JSON.stringify(resultB.state, null, 2));
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
