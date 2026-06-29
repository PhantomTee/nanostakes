"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { encodeFunctionData, erc20Abi, parseUnits } from "viem";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const STORAGE_KEY = "nanostakes:wallet";

/** Mirrors @nanostakes/shared's ARC_TESTNET — duplicated rather than imported,
 *  since the web package otherwise has no dependency on that package (see
 *  ConcourseApp.tsx's computeOfferCommitment for the same convention). */
const ARC_TESTNET_CHAIN_ID_HEX = "0x4cef52"; // 5042002
const ARC_TESTNET_RPC = "https://rpc.testnet.arc.network";
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";

interface WalletContextValue {
  address: string | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Sends `amountUsdc` (a decimal string, e.g. "5") of testnet USDC from the
   *  connected wallet to `to`, switching/adding Arc Testnet first if needed.
   *  Resolves with the tx hash once the wallet has submitted it — this does
   *  NOT wait for on-chain confirmation. */
  sendUsdc: (to: string, amountUsdc: string) => Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setAddress(saved);
  }, []);

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAddress(accounts[0] ?? null);
      if (accounts[0]) window.localStorage.setItem(STORAGE_KEY, accounts[0]);
      else window.localStorage.removeItem(STORAGE_KEY);
    };
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    return () => window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet extension found. Install MetaMask (or any injected wallet) and reload.");
      return;
    }
    setConnecting(true);
    try {
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      if (accounts[0]) {
        setAddress(accounts[0]);
        window.localStorage.setItem(STORAGE_KEY, accounts[0]);
      }
    } catch {
      setError("Connection request was rejected.");
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const sendUsdc = useCallback(
    async (to: string, amountUsdc: string) => {
      if (!window.ethereum) throw new Error("No wallet extension found. Install MetaMask (or any injected wallet) and reload.");
      if (!address) throw new Error("Connect your wallet first.");
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARC_TESTNET_CHAIN_ID_HEX }],
        });
      } catch (err) {
        // 4902 = chain not added to the wallet yet — add it, then retry the switch.
        if ((err as { code?: number }).code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: ARC_TESTNET_CHAIN_ID_HEX,
                chainName: "Arc Testnet",
                nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
                rpcUrls: [ARC_TESTNET_RPC],
                blockExplorerUrls: [ARC_TESTNET_EXPLORER],
              },
            ],
          });
        } else {
          throw err;
        }
      }
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "transfer",
        args: [to as `0x${string}`, parseUnits(amountUsdc, 6)],
      });
      const txHash = (await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{ from: address, to: USDC_ADDRESS, data }],
      })) as string;
      return txHash;
    },
    [address],
  );

  return (
    <WalletContext.Provider value={{ address, connecting, error, connect, disconnect, sendUsdc }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
