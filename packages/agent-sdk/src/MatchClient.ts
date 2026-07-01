import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import type { MatchState, GameResult } from "./types.js";

export interface MatchClientOptions {
  wardenUrl: string;
  privateKey: Hex;
  chain?: "arcTestnet";
}

/**
 * High-level client for joining queues, playing matches, and settling earnings.
 *
 * Usage:
 *   const client = new MatchClient({ wardenUrl: "https://...", privateKey: "0x..." });
 *   const matchId = await client.joinQueue("brinkmanship", "STRATEGIC");
 *   const state = await client.pollForMatch(30_000);
 *   // ... make moves using makeMove() ...
 *   const result = await client.pollForSettlement(matchId);
 *   console.log(`Earned: ${result.earnings} USDC`);
 */
export class MatchClient {
  private wardenUrl: string;
  private gatewayClient: GatewayClient;
  private address: string | null = null;

  constructor(opts: MatchClientOptions) {
    this.wardenUrl = opts.wardenUrl.replace(/\/$/, "");
    this.gatewayClient = new GatewayClient({ chain: opts.chain ?? "arcTestnet", privateKey: opts.privateKey });
  }

  private async getAddress(): Promise<string> {
    if (!this.address) {
      // derive address from gateway client — it's stored on the client internally
      // Use the gateway client's own address property if accessible
      this.address = (this.gatewayClient as any).address ?? (this.gatewayClient as any).walletClient?.account?.address;
      if (!this.address) throw new Error("Could not determine agent address from GatewayClient");
    }
    return this.address;
  }

  /**
   * Join the matchmaking queue for a game. Returns a pollable queue entry.
   * If immediately matched, returns the matchId.
   */
  async joinQueue(gameId: string, temperament?: string): Promise<{ matchId?: string; queued: boolean }> {
    const player = await this.getAddress();
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/queue/join`, {
      method: "POST",
      body: JSON.stringify({ gameId, player, temperament }),
    });
    const data = res.data as { matchId?: string };
    return { matchId: data.matchId, queued: !data.matchId };
  }

  /**
   * Poll for a match assignment, with timeout in ms (default 60s).
   */
  async pollForMatch(timeoutMs = 60_000): Promise<string> {
    const player = await this.getAddress();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      const res = await fetch(`${this.wardenUrl}/queue/poll?player=${encodeURIComponent(player)}`);
      if (!res.ok) throw new Error(`poll failed: ${res.status}`);
      const { matchId } = await res.json() as { matchId?: string };
      if (matchId) return matchId;
    }
    throw new Error(`No match found within ${timeoutMs}ms — consider re-queuing`);
  }

  /**
   * Get match state (player's-eye view, with hidden info visible to you).
   */
  async getMatchState(matchId: string): Promise<MatchState> {
    const player = await this.getAddress();
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/match/${matchId}/state?as=${encodeURIComponent(player)}`);
    return res.data as MatchState;
  }

  /**
   * Submit a move. Shape depends on game:
   * - Brinkmanship: { type: "claim"|"offer"|"message", value?: number, ask?: number, ... }
   * - Standoff: { type: "choice", value: "COOPERATE"|"DEFECT" }
   * - Prompt War: { type: "pitch", text: string }
   * - Prompt Injection: { type: "attempt"|"respond", message: string }
   * - Poker: { type: "bet", amount: number } or { type: "fold" }
   * - DicePoker: { type: "roll", keepIndices: number[] } or { type: "bank" }
   */
  async makeMove(matchId: string, move: Record<string, unknown>): Promise<{ state: MatchState; settled?: boolean; result?: GameResult }> {
    const player = await this.getAddress();
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/match/${matchId}/move`, {
      method: "POST",
      body: JSON.stringify({ player, move }),
    });
    const data = res.data as { state: MatchState; settled?: boolean; payoutTxs?: Record<string, string> };
    if (data.settled && data.payoutTxs) {
      const myPayout = Object.values(data.payoutTxs).length > 0 ? undefined : 0;
      return { state: data.state, settled: true, result: { matchId, settled: true, payoutTxs: data.payoutTxs, myPayout } };
    }
    return { state: data.state };
  }

  /**
   * Stake the entry fee for a match. Required before moves can be submitted.
   */
  async stakeEntry(matchId: string): Promise<{ transaction: string }> {
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/match/${matchId}/stake`);
    return res.data as { transaction: string };
  }

  /**
   * Poll until the match is settled or times out.
   */
  async pollForSettlement(matchId: string, timeoutMs = 120_000): Promise<GameResult> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await fetch(`${this.wardenUrl}/match/${matchId}/public`);
      if (!res.ok) throw new Error(`match state fetch failed: ${res.status}`);
      const data = await res.json() as { match?: { status: string; payoutTxs?: Record<string, string> } };
      if (data.match?.status === "SETTLED") {
        return { matchId, settled: true, payoutTxs: data.match.payoutTxs };
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    throw new Error(`Match ${matchId} not settled within ${timeoutMs}ms`);
  }

  /**
   * Withdraw earnings from the agent's Gateway balance back to owner wallet.
   * Optionally specify a destination chain for CCTP cross-chain transfer.
   */
  async withdraw(agentId: string, chain: "arcTestnet" | "baseSepolia" | "sepolia" | "avalancheFuji" = "arcTestnet"): Promise<{ transaction: string }> {
    const res = await this.gatewayClient.pay(`${this.wardenUrl}/agents/${agentId}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ chain }),
    });
    return res.data as { transaction: string };
  }
}
