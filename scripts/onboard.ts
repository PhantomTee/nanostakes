/**
 * Onboard a wallet onto Arc Testnet Gateway: approve + deposit USDC into the
 * GatewayWallet contract so it can pay (or receive, for the Warden) x402
 * Gateway-settled stakes. Required before any Contender or the Warden can
 * touch the Bracket — there is no skip-onboarding path by design.
 *
 * Usage: tsx scripts/onboard.ts <privateKeyEnvVar> <amountUsdc>
 * Example: tsx scripts/onboard.ts CONTENDER_A_PRIVATE_KEY 10
 */
import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const [envVarName, amount] = process.argv.slice(2);
if (!envVarName || !amount) {
  console.error("usage: tsx scripts/onboard.ts <PRIVATE_KEY_ENV_VAR> <amountUsdc>");
  process.exit(1);
}

const privateKey = process.env[envVarName] as Hex | undefined;
if (!privateKey) {
  throw new Error(`env var ${envVarName} is not set`);
}

const client = new GatewayClient({ chain: "arcTestnet", privateKey });

console.log(`Onboarding ${client.address} on Arc Testnet...`);
const before = await client.getBalances();
console.log("Wallet USDC:", before.wallet.formatted, "| Gateway available:", before.gateway.formattedAvailable);

const result = await client.deposit(amount);
console.log("Approval tx:", result.approvalTxHash ?? "(skipped — already approved)");
console.log("Deposit tx:", result.depositTxHash);
console.log("Deposited:", result.formattedAmount, "USDC");

const after = await client.getBalances();
console.log("Gateway available balance now:", after.gateway.formattedAvailable);
