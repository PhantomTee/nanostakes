/**
 * Game-agnostic temperament policy interface.
 * Each policy receives generic game state and a list of available moves,
 * and returns a ranked preference over those moves.
 */

export type Temperament = "COOPERATIVE" | "NEUTRAL" | "STRATEGIC" | "COMPETITIVE";

export interface PolicyContext {
  gameId: string;
  phase: string;
  availableMoves: string[];
  myScore: number;
  opponentScore: number;
  matchProgress: number; // 0..1 — how far through the match we are
  isWinning: boolean;
}

export interface TemperamentPolicy {
  temperament: Temperament;
  /**
   * Rank available moves from most preferred (index 0) to least preferred.
   * Used as a fallback when the LLM call fails or times out.
   * Deterministic, no LLM — must return in <1ms.
   */
  rankMoves(ctx: PolicyContext): string[];

  /**
   * Decide whether to accept an incoming challenge from an opponent.
   * Deterministic, no LLM.
   */
  shouldAcceptChallenge(opponentWinRate: number, opponentMatchesPlayed: number): boolean;
}

export class CooperativePolicy implements TemperamentPolicy {
  temperament: Temperament = "COOPERATIVE";
  rankMoves(ctx: PolicyContext): string[] {
    // Prefer cooperative/lower-aggression moves first
    return [...ctx.availableMoves].sort((a, b) => {
      if (a.includes("cooperat") || a === "bank" || a === "check") return -1;
      if (b.includes("cooperat") || b === "bank" || b === "check") return 1;
      return 0;
    });
  }
  shouldAcceptChallenge(): boolean { return true; }
}

export class NeutralPolicy implements TemperamentPolicy {
  temperament: Temperament = "NEUTRAL";
  rankMoves(ctx: PolicyContext): string[] { return [...ctx.availableMoves]; }
  shouldAcceptChallenge(): boolean { return true; }
}

export class StrategicPolicy implements TemperamentPolicy {
  temperament: Temperament = "STRATEGIC";
  rankMoves(ctx: PolicyContext): string[] {
    return [...ctx.availableMoves].sort((a) => {
      if (ctx.isWinning && (a === "fold" || a.includes("cooperat"))) return 1;
      return 0;
    });
  }
  shouldAcceptChallenge(opponentWinRate: number, opponentMatchesPlayed: number): boolean {
    if (opponentMatchesPlayed >= 3 && opponentWinRate >= 0.75) return false;
    return true;
  }
}

export class CompetitivePolicy implements TemperamentPolicy {
  temperament: Temperament = "COMPETITIVE";
  rankMoves(ctx: PolicyContext): string[] {
    return [...ctx.availableMoves].sort((a) => {
      if (a === "defect" || a === "raise" || a.includes("bet")) return -1;
      if (a === "fold" || a.includes("cooperat")) return 1;
      return 0;
    });
  }
  shouldAcceptChallenge(opponentWinRate: number, opponentMatchesPlayed: number): boolean {
    if (opponentMatchesPlayed >= 2 && opponentWinRate >= 0.7) return false;
    return true;
  }
}

export function getPolicyForTemperament(t: Temperament): TemperamentPolicy {
  switch (t) {
    case "COOPERATIVE": return new CooperativePolicy();
    case "NEUTRAL": return new NeutralPolicy();
    case "STRATEGIC": return new StrategicPolicy();
    case "COMPETITIVE": return new CompetitivePolicy();
  }
}
