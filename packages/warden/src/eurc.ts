import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, type Hex, type Address as ViemAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_CONFIGS } from "@circle-fin/x402-batching/client";

/**
 * EURC on Arc Testnet. Circle's x402 Gateway batching scheme (BatchEvmScheme /
 * GatewayWalletBatched) only knows about USDC at the protocol level — there's
 * no Gateway-batched, gasless path for EURC in the installed SDK. So unlike
 * USDC, EURC moves as a plain ERC20 transfer: the sender pays ordinary gas
 * (in USDC, since that's how Arc Testnet prices gas) and there's no
 * deposit/unified-balance step. This is a real, second asset an owner can
 * hold and move — just not (yet) a second currency match stakes can settle in.
 */
const EURC_ADDRESS: ViemAddress = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const EURC_DECIMALS = 6;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const arcChain = CHAIN_CONFIGS.arcTestnet.chain;
const publicClient = createPublicClient({ chain: arcChain, transport: http() });

export async function getEurcBalance(address: ViemAddress): Promise<{ balance: bigint; formatted: string }> {
  const balance = await publicClient.readContract({
    address: EURC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  return { balance, formatted: formatUnits(balance, EURC_DECIMALS) };
}

/** Transfers a specific EURC amount to `to` — used for match settlement payouts. */
export async function transferEurc(privateKey: Hex, to: ViemAddress, amountUsdc: number): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain: arcChain, transport: http() });
  const txHash = await wallet.writeContract({
    address: EURC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, parseUnits(amountUsdc.toFixed(EURC_DECIMALS), EURC_DECIMALS)],
  });
  return txHash;
}

/** Sends the full EURC balance to `to`, paid for by the holder's own wallet (Arc gas is USDC-denominated). */
export async function withdrawEurc(privateKey: Hex, to: ViemAddress): Promise<{ amount: string; txHash: Hex } | null> {
  const account = privateKeyToAccount(privateKey);
  const { balance, formatted } = await getEurcBalance(account.address);
  if (balance === 0n) return null;

  const wallet = createWalletClient({ account, chain: arcChain, transport: http() });
  const txHash = await wallet.writeContract({
    address: EURC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [to, balance],
  });
  return { amount: formatted, txHash };
}

export { EURC_ADDRESS };
