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

const ABANDON_RAKE_FRACTION = 0.03; // matches the games' own rake

/**
 * Forces a stuck ACTIVE match closed when one player has gone dark (paused,
 * crashed, or otherwise stopped acting) while the other is still waiting on
 * them. The engine has no concept of a clock — getResult() only ever runs
 * once isTerminal() is true, and a silent opponent means it never will be.
 * Without this, the match freezes forever and the responsive player's stake
 * is trapped right alongside the absent one's. The forfeiting player gets
 * nothing back; the rest of the pot (minus the same rake every normal
 * settlement takes) goes to whoever was actually still there.
 */
export async function forfeitMatch(record: MatchRecord, forfeitingPlayer: Address): Promise<Record<Address, string>> {
  if (record.status === "SETTLED" && record.payoutTxs) {
    return record.payoutTxs;
  }
  const winner = record.state.players.find((p) => p !== forfeitingPlayer);
  if (!winner) throw new Error("forfeitMatch: no other player to award the pot to");

  const totalEscrow = record.state.entryStakeEach * record.state.players.length;
  const winnerAmount = totalEscrow * (1 - ABANDON_RAKE_FRACTION);
  await waitForAvailableBalance(winnerAmount);

  const txs: Record<Address, string> = { ...(record.payoutTxs ?? {}) };
  if (!txs[winner]) {
    const withdrawal = await wardenGatewayClient.withdraw(winnerAmount.toFixed(6), {
      chain: "arcTestnet",
      recipient: winner as Hex,
    });
    txs[winner] = withdrawal.mintTxHash;
  }

  record.status = "SETTLED";
  record.payoutTxs = txs;
  persistMatch(record);

  recordMatch({
    players: record.state.players,
    staked: Object.fromEntries(record.state.players.map((p) => [p, record.state.entryStakeEach])),
    returned: { [winner]: winnerAmount, [forfeitingPlayer]: 0 },
    temperaments: record.meta?.temperaments,
  });

  return txs;
}

/**
 * Both players went dark before the match could really get going (e.g. both
 * staked, then both crashed before round 1 ever resolved). There's no one
 * to blame here, so refund everyone in full instead of picking an arbitrary
 * "winner" — and no rake, since no game was actually played out.
 */
export async function voidMatch(record: MatchRecord): Promise<Record<Address, string>> {
  if (record.status === "SETTLED" && record.payoutTxs) {
    return record.payoutTxs;
  }
  const refundEach = record.state.entryStakeEach;
  await waitForAvailableBalance(refundEach * record.state.players.length);

  const txs: Record<Address, string> = { ...(record.payoutTxs ?? {}) };
  for (const player of record.state.players) {
    if (txs[player]) continue;
    const withdrawal = await wardenGatewayClient.withdraw(refundEach.toFixed(6), {
      chain: "arcTestnet",
      recipient: player as Hex,
    });
    txs[player] = withdrawal.mintTxHash;
  }

  record.status = "SETTLED";
  record.payoutTxs = txs;
  persistMatch(record);

  recordMatch({
    players: record.state.players,
    staked: Object.fromEntries(record.state.players.map((p) => [p, refundEach])),
    returned: Object.fromEntries(record.state.players.map((p) => [p, refundEach])),
    temperaments: record.meta?.temperaments,
  });

  return txs;
}
