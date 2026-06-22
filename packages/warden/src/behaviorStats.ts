import type { Address } from "@nanostakes/shared";
import type { BrinkmanshipState } from "@nanostakes/bracket";

export interface RoundBehaviorStats {
  rounds: number;
  claimSum: number;
  concessionSum: number;
  escalationCount: number;
  fairShareGapSum: number;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function emptyStats(): RoundBehaviorStats {
  return { rounds: 0, claimSum: 0, concessionSum: 0, escalationCount: 0, fairShareGapSum: 0 };
}

/**
 * Derives per-player negotiation-behavior stats from one settled
 * Brinkmanship match's resolved rounds — Brinkmanship-specific, since
 * Standoff's single sealed commit has no claim/offer structure to derive
 * "concession" or "fair share" from.
 *
 * Concession, per round: how far this player's sealed ask moved toward the
 * midpoint of both public claims, relative to how far their own claim sat
 * from that midpoint — 0 means they asked exactly what they claimed (dug
 * in), 1 means they asked for an even split regardless of their claim.
 */
export function computeBrinkmanshipRoundStats(state: BrinkmanshipState): Record<Address, RoundBehaviorStats> {
  const [a, b] = state.players;
  const out: Record<Address, RoundBehaviorStats> = { [a]: emptyStats(), [b]: emptyStats() };

  for (const round of state.rounds) {
    if (!round.resolved) continue;
    for (const [self, opp] of [[a, b], [b, a]] as const) {
      const claimSelf = round.claims[self];
      const askSelf = round.offers[self];
      if (claimSelf === undefined || askSelf === undefined) continue;

      const stats = out[self];
      stats.rounds += 1;
      stats.claimSum += claimSelf;
      stats.fairShareGapSum += Math.abs(claimSelf - 0.5);
      if (round.escalated[self]) stats.escalationCount += 1;

      const claimOpp = round.claims[opp];
      if (claimOpp === undefined) continue;
      const midpoint = (claimSelf + claimOpp) / 2;
      const claimToMidpoint = Math.abs(claimSelf - midpoint);
      const concession =
        claimToMidpoint === 0 ? 1 : clamp01(1 - Math.abs(askSelf - midpoint) / claimToMidpoint);
      stats.concessionSum += concession;
    }
  }

  return out;
}
