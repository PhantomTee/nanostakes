/**
 * Circle Developer-Controlled Wallets (DCW) integration.
 *
 * Handles wallet provisioning and transaction signing via Circle's
 * Programmable Wallets API. Circle custodies the private key; the Warden
 * only ever holds a walletId and a public address — raw key material never
 * leaves Circle's infrastructure.
 *
 * SETUP (one-time, must be done by the project owner):
 *   1. Sign up / log in at https://console.circle.com
 *   2. Go to Programmable Wallets → Developer-Controlled → create a Wallet Set
 *      targeting Arc Testnet (or "ARK" blockchain in Circle's nomenclature).
 *   3. Generate an Entity Secret (Settings → Entity Secret) and download the
 *      recovery file — store it somewhere safe, you cannot regenerate it.
 *   4. Copy the Entity Secret ciphertext and add it to your .env:
 *        CIRCLE_API_KEY=<your api key>
 *        CIRCLE_ENTITY_SECRET=<entity secret ciphertext>
 *        CIRCLE_WALLET_SET_ID=<wallet set id>
 *   Without these three vars the Warden falls back to locally generated EOAs
 *   (see provisionSessionWallet() in wallets.ts).
 *
 * ARCHITECTURE NOTE — x402 / GatewayClient incompatibility:
 *   GatewayClient from @circle-fin/x402-batching requires a raw `privateKey:
 *   Hex` and has no remote-signer constructor path. Circle DCW wallets sign
 *   via an API call (signTypedData / contractExecution), not local key
 *   material. This means DCW wallets cannot be used directly with
 *   GatewayClient for stakes/payouts — that wiring would require hand-rolling
 *   deposit/pay/withdraw against the lower-level BatchEvmScheme with a custom
 *   signer (Wave 2, tracked in ARCHITECTURE.md). For now this module covers
 *   wallet PROVISIONING so agent wallets get a Circle-custodied address; x402
 *   payment operations for DCW wallets will use circleSignAndSend() directly
 *   once the Wave 2 gateway integration is in place.
 *
 * Docs: https://developers.circle.com/w3s/developer-controlled-wallets
 */

import { randomUUID } from "node:crypto";

const CIRCLE_API_BASE = "https://api.circle.com/v1/w3s";

function circleHeaders(): Record<string, string> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) throw new Error("CIRCLE_API_KEY not configured");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export interface CircleWallet {
  walletId: string;
  address: string;
  blockchain: string;
}

/**
 * Provision a new wallet in Circle's custody under the configured wallet set.
 * The wallet's private key is held by Circle — the Warden only ever receives
 * the wallet's public address and a walletId for future signing requests.
 *
 * Requires env vars: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, CIRCLE_WALLET_SET_ID
 */
export async function provisionCircleWallet(): Promise<CircleWallet> {
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) throw new Error("CIRCLE_WALLET_SET_ID not configured");

  const idempotencyKey = randomUUID();
  const res = await fetch(`${CIRCLE_API_BASE}/developer/wallets`, {
    method: "POST",
    headers: circleHeaders(),
    body: JSON.stringify({
      idempotencyKey,
      accountType: "EOA",
      blockchains: ["ARKTESTNET"], // Arc Testnet blockchain identifier in Circle's API
      count: 1,
      walletSetId,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Circle wallet provisioning failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    data?: { wallets?: { id: string; address: string; blockchain: string }[] };
  };
  const wallet = data.data?.wallets?.[0];
  if (!wallet) throw new Error("Circle returned no wallet in provisioning response");

  return { walletId: wallet.id, address: wallet.address, blockchain: wallet.blockchain };
}

/**
 * Request Circle to sign and broadcast a contract execution transaction on
 * behalf of a custodied wallet. Returns the on-chain transaction hash after
 * Circle confirms broadcast (or polls until confirmed).
 *
 * NOTE: This is the Wave 2 signing path. It is not yet wired into GatewayClient
 * for x402 stakes/payouts — see module-level ARCHITECTURE NOTE above.
 */
export async function circleSignAndSend(
  walletId: string,
  params: {
    to: string;
    data?: string; // ABI-encoded calldata (hex)
    value?: string; // hex wei, e.g. "0x0"
    gasLimit?: string; // optional hex gas limit
  }
): Promise<string> {
  const idempotencyKey = randomUUID();
  const body: Record<string, unknown> = {
    idempotencyKey,
    walletId,
    contractAddress: params.to,
    callData: params.data,
    value: params.value ?? "0",
    blockchain: "ARKTESTNET",
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  };
  if (params.gasLimit) {
    body.gasLimit = params.gasLimit;
  }

  const res = await fetch(`${CIRCLE_API_BASE}/developer/transactions/contractExecution`, {
    method: "POST",
    headers: circleHeaders(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Circle sign+send failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    data?: { id?: string; txHash?: string };
  };

  // Circle may return a txHash directly (sync path) or a transaction ID to poll (async path).
  if (data.data?.txHash) return data.data.txHash;

  const txId = data.data?.id;
  if (!txId) throw new Error("Circle returned neither txHash nor transaction ID");
  return pollCircleTransaction(txId);
}

async function pollCircleTransaction(txId: string, maxAttempts = 30): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise<void>((r) => setTimeout(r, 2000));

    const res = await fetch(`${CIRCLE_API_BASE}/transactions/${txId}`, {
      headers: circleHeaders(),
    });
    if (!res.ok) continue; // transient error — keep polling

    const data = (await res.json()) as {
      data?: { transaction?: { txHash?: string; state?: string } };
    };
    const tx = data.data?.transaction;
    if (tx?.state === "COMPLETE" && tx.txHash) return tx.txHash;
    if (tx?.state === "FAILED") throw new Error(`Circle transaction ${txId} failed`);
    // Any other state (INITIATED, PENDING_RISK_SCREENING, SENT, etc.) — keep polling
  }
  throw new Error(`Circle transaction ${txId} did not complete after ${maxAttempts} attempts`);
}
