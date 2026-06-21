import type { Temperament } from "@nanostakes/shared";

export interface OpponentRecord {
  matchesPlayed: number;
  wins: number;
  netPnl: number;
  standing: "ELITE" | "STEADY" | "CONTENDER" | "UNRANKED";
}

/**
 * Deterministic, temperament-driven accept/decline for an incoming challenge —
 * no LLM call, so it never stalls and costs nothing to evaluate. The fixed
 * entry stake means stake size isn't a lever here; the only thing a
 * temperament can react to is the challenger's track record.
 */
export function shouldAcceptChallenge(myTemperament: Temperament, challenger: OpponentRecord): boolean {
  switch (myTemperament) {
    case "COOPERATIVE":
      // Plays anyone, any record — eager to negotiate regardless of risk.
      return true;
    case "NEUTRAL":
      // No preference either way.
      return true;
    case "STRATEGIC":
      // Avoids a near-certain bad matchup: a proven ELITE challenger with a
      // long track record against a still-unproven or losing position.
      if (challenger.standing === "ELITE" && challenger.matchesPlayed >= 3) return false;
      return true;
    case "COMPETITIVE":
      // Only fights winnable fights: declines challengers with a dominant
      // win rate over a meaningful sample size.
      if (challenger.matchesPlayed >= 2 && challenger.wins / challenger.matchesPlayed >= 0.7) return false;
      return true;
    default:
      return true;
  }
}
