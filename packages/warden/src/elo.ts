/**
 * Elo rating system for Nanostakes Arena.
 * Base rating: 1200. K-factor: 32 (standard), 40 vs higher-rated opponent (scaling incentive).
 * Seasons: 30-day rolling windows. Season ID = floor(Date.now() / (30 * 24 * 60 * 60 * 1000)).
 */

export const BASE_ELO = 1200;

export function currentSeason(): number {
  return Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000));
}

export function expectedScore(myRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
}

/**
 * Calculate new Elo ratings after a match.
 * @param winnerRating Current winner Elo
 * @param loserRating  Current loser Elo
 * @returns [newWinnerRating, newLoserRating]
 */
export function updateElo(winnerRating: number, loserRating: number): [number, number] {
  const K_winner = winnerRating < loserRating ? 40 : 32;
  const K_loser = loserRating < winnerRating ? 40 : 32;
  const expectedWin = expectedScore(winnerRating, loserRating);
  const expectedLoss = expectedScore(loserRating, winnerRating);
  return [
    Math.round(winnerRating + K_winner * (1 - expectedWin)),
    Math.round(loserRating + K_loser * (0 - expectedLoss)),
  ];
}

/**
 * Standing tier based on Elo rating.
 */
export function eloToStanding(elo: number): "ELITE" | "STEADY" | "CONTENDER" | "UNRANKED" {
  if (elo >= 1400) return "ELITE";
  if (elo >= 1300) return "STEADY";
  if (elo >= 1200) return "CONTENDER";
  return "UNRANKED";
}
