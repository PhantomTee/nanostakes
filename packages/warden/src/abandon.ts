import { allMatches } from "./state.js";
import { forfeitMatch, voidMatch } from "./settle.js";

const ABANDON_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Sweeps ACTIVE matches for one that's gone stale — nobody has staked,
 * moved, or settled it in ABANDON_TIMEOUT_MS — and force-closes it instead
 * of leaving it frozen forever. This is the fix for a real bug: when an
 * agent pauses (out of funds, repeated crashes) while it's mid-match, its
 * driver loop stops polling that match entirely. The opponent is left
 * waiting on a player who will never act again, and both stakes sit
 * escrowed in the Warden's Gateway balance with no path back out.
 *
 * `state.acted` (reset every round/turn) tells us who's actually responsible:
 * exactly one player still owing an action means that player forfeits the
 * pot to the one who was still there; both owing an action means neither
 * is at fault (e.g. both crashed before round 1 ever resolved) and the
 * fair outcome is a full void/refund instead of picking a "winner".
 */
export async function sweepAbandonedMatches(): Promise<{ forfeited: number; voided: number }> {
  let forfeited = 0;
  let voided = 0;
  const cutoff = Date.now() - ABANDON_TIMEOUT_MS;

  for (const record of allMatches()) {
    if (record.status !== "ACTIVE") continue;
    const lastMoveAt = record.lastMoveAt ? new Date(record.lastMoveAt).getTime() : 0;
    if (lastMoveAt && lastMoveAt > cutoff) continue;

    const pending = record.state.players.filter((p) => !record.state.acted[p]);
    try {
      if (pending.length === 1) {
        await forfeitMatch(record, pending[0]);
        forfeited++;
      } else if (pending.length === record.state.players.length) {
        await voidMatch(record);
        voided++;
      }
      // pending.length === 0 shouldn't happen for ACTIVE (both-acted resolves
      // the round/match already) — leave it alone if it somehow does.
    } catch (err) {
      console.error(`[abandon] failed to close stale match ${record.state.matchId}: ${(err as Error).message}`);
    }
  }

  return { forfeited, voided };
}
