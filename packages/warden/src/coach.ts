/**
 * AI Coach: reviews a player's last Brinkmanship match and provides
 * actionable improvement suggestions based on their move history.
 * Called via POST /agents/:id/analyze-match
 */
import type { BrinkmanshipState } from "@nanostakes/bracket";

export interface CoachAnalysis {
  matchId: string;
  playerAddress: string;
  summary: string;
  suggestions: string[];
  temperamentFit: string;
  suboptimalMoves: Array<{ round: number; issue: string; suggestion: string }>;
}

/**
 * Analyze a player's performance in a completed Brinkmanship match.
 * Uses simple heuristic rules — no LLM call, so it's fast and free.
 */
export function analyzeMatch(state: BrinkmanshipState, playerAddress: string): CoachAnalysis {
  const suggestions: string[] = [];
  const suboptimalMoves: CoachAnalysis["suboptimalMoves"] = [];
  let overclaimedRounds = 0;
  let underofferedRounds = 0;
  let unnecessaryEscalations = 0;

  for (const round of state.rounds) {
    if (!round.resolved) continue;
    const myValuation = round.privateValuation?.[playerAddress] ?? 0;
    const myClaim = round.claims?.[playerAddress] ?? 0;
    const myOffer = round.offers?.[playerAddress] ?? 0;
    const escalated = round.escalated?.[playerAddress] ?? false;

    // Check if overclaimed (claim much higher than valuation — signals bluffing that may have backfired)
    const claimDeviation = Math.abs(myClaim - myValuation);
    if (claimDeviation > 0.25) {
      overclaimedRounds++;
      suboptimalMoves.push({
        round: round.index,
        issue: `Claim ${(myClaim * 100).toFixed(0)}% deviated significantly from your private valuation ${(myValuation * 100).toFixed(0)}%`,
        suggestion: "Consider claiming closer to your true valuation to reduce conflict risk in the offer phase",
      });
    }

    // Check if under-offered (asked too little relative to valuation — left money on the table)
    if (myOffer < myValuation * 0.7 && round.payoutFraction?.[playerAddress] !== undefined) {
      underofferedRounds++;
      suboptimalMoves.push({
        round: round.index,
        issue: `Your ask (${(myOffer * 100).toFixed(0)}%) was well below your valuation (${(myValuation * 100).toFixed(0)}%) — you may have left money on the table`,
        suggestion: "Ask closer to your true valuation; conservative asks give you less leverage in negotiation",
      });
    }

    // Check unnecessary escalation
    if (escalated && (round.payoutFraction?.[playerAddress] ?? 0) < 0.2) {
      unnecessaryEscalations++;
      suboptimalMoves.push({
        round: round.index,
        issue: "You escalated the pot but received less than 20% of it — the escalation backfired",
        suggestion: "Only escalate when confident your offer will win the round; escalating on weak rounds compounds losses",
      });
    }
  }

  if (overclaimedRounds > 2) suggestions.push("Your claims often deviated significantly from your private valuations. Try a more honest signaling strategy — it builds predictability that pays off in later rounds.");
  if (underofferedRounds > 1) suggestions.push("You repeatedly asked for less than your valuation justified. Don't be too conservative — you won't earn more by leaving value on the table.");
  if (unnecessaryEscalations > 1) suggestions.push("You escalated in rounds you ultimately lost. Reserve escalation for rounds where you're confident your offer will win.");

  const totalRounds = state.rounds.filter(r => r.resolved).length;
  const myWinningRounds = state.rounds.filter(r => r.resolved && (r.payoutFraction?.[playerAddress] ?? 0) > 0.4).length;
  const winRate = totalRounds > 0 ? myWinningRounds / totalRounds : 0;

  const temperamentFit = winRate > 0.6
    ? "Your play style looks well-calibrated. Consider trying STRATEGIC temperament for more complex adaptive strategies."
    : winRate < 0.3
    ? "Your current approach may not fit COMPETITIVE well — consider COOPERATIVE or NEUTRAL to focus on consistent returns over aggressive plays."
    : "Solid performance. Your temperament fits the game reasonably well.";

  return {
    matchId: state.matchId,
    playerAddress,
    summary: `Played ${totalRounds} rounds, won ${myWinningRounds} (${(winRate * 100).toFixed(0)}% round win rate). ${suboptimalMoves.length} suboptimal moves detected.`,
    suggestions: suggestions.length > 0 ? suggestions : ["Good fundamentals. Keep building opponent memory over repeated matches for strategic edge."],
    temperamentFit,
    suboptimalMoves,
  };
}
