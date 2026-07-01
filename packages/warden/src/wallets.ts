import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface SessionWallet {
  address: string;
  /**
   * For provider="local": raw hex private key (0x...) suitable for use with
   * viem's privateKeyToAccount / GatewayClient directly.
   *
   * For provider="circle": a sentinel string of the form "circle:<walletId>"
   * — this is NOT a valid private key. Downstream payment code (gateway.ts
   * Wave 2 integration) must inspect provider before consuming this field:
   *   - provider === "local"  → use privateKey directly with GatewayClient
   *   - provider === "circle" → extract walletId and route via circleSignAndSend()
   */
  privateKey: Hex | `circle:${string}`;
  provider: "circle" | "local";
}

/**
 * Provisions the wallet an agent actually plays matches with (the "session
 * wallet" described in the onboarding flow — funded by the owner's own
 * wallet, but able to sign autonomously without a PIN prompt per move).
 *
 * Real integration point: Circle's Developer-Controlled Wallets API
 * (https://developers.circle.com/w3s/developer-controlled-wallets) would
 * create this on Arc Testnet under a wallet set scoped to this app, and the
 * Warden would call Circle's sign/transfer endpoints instead of holding a
 * raw private key. That needs a Circle entity secret + wallet set id, which
 * aren't configured yet (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET /
 * CIRCLE_WALLET_SET_ID), so this falls back to a locally generated EOA —
 * functionally identical to how Contenders work today, just provisioned
 * per-agent instead of from a hardcoded .env entry.
 */
export async function provisionSessionWallet(): Promise<SessionWallet> {
  if (process.env.CIRCLE_API_KEY && process.env.CIRCLE_ENTITY_SECRET && process.env.CIRCLE_WALLET_SET_ID) {
    try {
      return await provisionCircleDeveloperWallet();
    } catch (err) {
      console.warn(`Circle wallet provisioning failed, falling back to a local wallet: ${(err as Error).message}`);
    }
  }
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey, provider: "local" };
}

async function provisionCircleDeveloperWallet(): Promise<SessionWallet> {
  const { provisionCircleWallet } = await import("./circleSign.js");
  const wallet = await provisionCircleWallet();
  return {
    address: wallet.address,
    /**
     * Not a real private key — a sentinel so downstream code can detect that
     * this wallet is Circle-custodied and route signing through circleSignAndSend()
     * rather than through a local viem account / GatewayClient (Wave 2 wiring).
     * Format: "circle:<walletId>"
     */
    privateKey: `circle:${wallet.walletId}` as `circle:${string}`,
    provider: "circle",
  };
}
