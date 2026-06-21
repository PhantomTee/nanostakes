import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface SessionWallet {
  address: string;
  privateKey: Hex;
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
  throw new Error("Circle Developer-Controlled Wallets integration is not wired up yet");
}
