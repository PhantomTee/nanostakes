import "dotenv/config";
import { createGatewayMiddleware } from "@circle-fin/x402-batching/server";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { ARC_TESTNET } from "@nanostakes/shared";

const wardenPrivateKey = process.env.WARDEN_PRIVATE_KEY as Hex | undefined;
if (!wardenPrivateKey) {
  throw new Error("WARDEN_PRIVATE_KEY is required — see .env.example");
}

export const wardenAccount = privateKeyToAccount(wardenPrivateKey);

/** Payment-gated route middleware. Settles incoming stakes/side-payments into the Warden's own Gateway balance. */
export const gateway = createGatewayMiddleware({
  sellerAddress: wardenAccount.address,
  networks: [`eip155:${ARC_TESTNET.chainId}`],
  facilitatorUrl: ARC_TESTNET.gatewayFacilitatorUrl,
});

/** The Warden's own client, used to pay winners out of its Gateway balance after a match settles. */
export const wardenGatewayClient = new GatewayClient({
  chain: "arcTestnet",
  privateKey: wardenPrivateKey,
});
