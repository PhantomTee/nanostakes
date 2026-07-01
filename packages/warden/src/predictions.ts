import { randomUUID } from "node:crypto";
import type { Address } from "@nanostakes/shared";

export interface Prediction {
  id: string; matchId: string; predictor: Address; predictedWinner: Address;
  stakeUsdc: number; placedAt: string; settled: boolean; payout?: number;
}
export interface PredictionMarket {
  matchId: string; predictions: Prediction[]; settled: boolean; winner?: Address; totalPool: number;
}

const markets = new Map<string, PredictionMarket>();

export function openMarket(matchId: string): PredictionMarket {
  const market: PredictionMarket = { matchId, predictions: [], settled: false, totalPool: 0 };
  markets.set(matchId, market);
  return market;
}
export function placePrediction(matchId: string, predictor: Address, predictedWinner: Address, stakeUsdc: number): Prediction {
  const market = markets.get(matchId);
  if (!market) throw new Error("no prediction market open for this match");
  if (market.settled) throw new Error("market already settled");
  if (stakeUsdc <= 0) throw new Error("stake must be positive");
  const p: Prediction = { id: randomUUID(), matchId, predictor, predictedWinner, stakeUsdc, placedAt: new Date().toISOString(), settled: false };
  market.predictions.push(p);
  market.totalPool += stakeUsdc;
  return p;
}
export function settleMarket(matchId: string, winner: Address): Prediction[] {
  const market = markets.get(matchId);
  if (!market) return [];
  market.settled = true;
  market.winner = winner;
  const winners = market.predictions.filter(p => p.predictedWinner.toLowerCase() === winner.toLowerCase());
  const totalWinningStake = winners.reduce((s, p) => s + p.stakeUsdc, 0);
  for (const p of market.predictions) {
    p.settled = true;
    p.payout = p.predictedWinner.toLowerCase() === winner.toLowerCase() && totalWinningStake > 0 ? (p.stakeUsdc / totalWinningStake) * market.totalPool : 0;
  }
  return market.predictions.filter(p => (p.payout ?? 0) > 0);
}
export function getMarket(matchId: string): PredictionMarket | undefined { return markets.get(matchId); }
export function listOpenMarkets(): PredictionMarket[] { return [...markets.values()].filter(m => !m.settled); }
