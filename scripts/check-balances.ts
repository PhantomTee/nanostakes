import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const keys: Record<string, Hex | undefined> = {
  WARDEN: process.env.WARDEN_PRIVATE_KEY as Hex,
  CONTENDER_A: process.env.CONTENDER_A_PRIVATE_KEY as Hex,
  CONTENDER_B: process.env.CONTENDER_B_PRIVATE_KEY as Hex,
};

for (const [name, pk] of Object.entries(keys)) {
  if (!pk) {
    console.log(name, "— no private key set");
    continue;
  }
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: pk });
  const balances = await client.getBalances();
  console.log(
    `${name} ${client.address} | wallet: ${balances.wallet.formatted} USDC | gateway available: ${balances.gateway.formattedAvailable} USDC`,
  );
}
