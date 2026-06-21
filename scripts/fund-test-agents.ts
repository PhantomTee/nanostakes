import "dotenv/config";
import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";
import { ARC_TESTNET } from "@nanostakes/shared";

const fromKey = (process.env.FUND_FROM_KEY ?? process.env.CONTENDER_A_PRIVATE_KEY) as Hex;
const amount = process.env.FUND_AMOUNT ?? "0.5";
const recipients = process.argv.slice(2);
if (!fromKey || recipients.length === 0) {
  console.error("usage: tsx scripts/fund-test-agents.ts <recipient> [recipient...]");
  process.exit(1);
}

const account = privateKeyToAccount(fromKey);
const client = createWalletClient({ account, chain: CHAIN_CONFIGS.arcTestnet.chain, transport: http() });
const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;

for (const to of recipients) {
  const hash = await client.writeContract({
    address: ARC_TESTNET.usdcAddress as Hex,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to as Hex, parseUnits(amount, 6)],
  });
  console.log(`sent ${amount} USDC to ${to}: ${hash}`);
}
