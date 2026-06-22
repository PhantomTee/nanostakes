import type { Hex } from "viem";
import type { Address } from "@nanostakes/shared";
import { getGame } from "@nanostakes/bracket";
import type { BrinkmanshipState } from "@nanostakes/bracket";
import type { MatchRecord } from "./state.js";
import { persistMatch } from "./state.js";
import { wardenGatewayClient } from "./gateway.js";
import { recordMatch } from "./ledger.js";
import { computeBrinkmanshipRoundStats } from "./behaviorStats.js";
import { recordOpponentMemory } from "./memory.js";

/**
 * Circle Gateway settles x402 payments in batches, so funds from `/stake`
 * don't land in the Warden's available Gateway balance the instant the
 * payment is verified. Poll until enough is available (or give up) before
 * attempting payout, instead of failing the whole match on a race.
 */
async function waitForAvailableBalance(needed: number, timeoutMs = 120_000, intervalMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const balances = await wardenGatewayClient.getBalances();
    const available = Number(balances.gateway.formattedAvailable);
    if (available >= needed) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Gateway balance still settling after ${timeoutMs}ms: have ${available}, need ${needed}. Retry settlement later.`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Pays each player their share of the settled pot out of the Warden's own
 * Gateway balance (which holds everyone's entry stakes after `/stake`
 * settlement). Implements the escrow-release-on-attestation pattern: this
 * only runs once the engine has independently declared the match terminal.
 *
 * Idempotent-ish: if called again on an already-settled match, returns the
 * previously recorded payout transactions instead of re-paying.
 */
export async function settleMatch(record: MatchRecord): Promise<Record<Address, string>> {
  if (record.status === "SETTLED" && record.payoutTxs) {
    return record.payoutTxs;
  }
  const game = getGame(record.gameId);
  if (!game.isTerminal(record.state)) {
    throw new Error("cannot settle a non-terminal match");
  }
  const result = game.getResult(record.state) as { payouts: Record<Address, number> };
  const totalEscrow = record.state.entryStakeEach * record.state.players.length;

  const amounts = record.state.players.map((player) => ({
    player,
    amount: (result.payouts[player] ?? 0) * totalEscrow,
  }));
  const totalNeeded = amounts.reduce((sum, a) => sum + a.amount, 0);
  await waitForAvailableBalance(totalNeeded);

  const txs: Record<Address, string> = { ...(record.payoutTxs ?? {}) };
  for (const { player, amount } of amounts) {
    if (amount <= 0 || txs[player]) continue;
    const withdrawal = await wardenGatewayClient.withdraw(amount.toFixed(6), {
      chain: "arcTestnet",
      recipient: player as Hex,
    });
    txs[player] = withdrawal.mintTxHash;
  }

  record.status = "SETTLED";
  record.payoutTxs = txs;
  persistMatch(record);

  // Brinkmanship-only: Standoff's single sealed commit has no claim/offer
  // structure for behaviorStats.ts to derive concession/escalation/fair-share
  // from, so neither the leaderboard's behavior columns nor cross-match
  // memory get populated for it.
  const behaviorStats =
    record.gameId === "brinkmanship" ? computeBrinkmanshipRoundStats(record.state as BrinkmanshipState) : undefined;

  recordMatch({
    players: record.state.players,
    staked: Object.fromEntries(record.state.players.map((p) => [p, record.state.entryStakeEach])),
    returned: Object.fromEntries(amounts.map(({ player, amount }) => [player, amount])),
    temperaments: record.meta?.temperaments,
    behaviorStats,
  });

  if (behaviorStats && record.state.players.length === 2) {
    recordOpponentMemory(record.state.players as [Address, Address], behaviorStats);
  }

  return txs;
}
