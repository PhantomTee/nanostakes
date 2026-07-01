export interface QueueEntry {
  gameId: string;
  player: string;
  temperament?: string;
}

export interface MatchState {
  matchId: string;
  gameId: string;
  status: "AWAITING_STAKES" | "ACTIVE" | "SETTLED";
  phase: string;
  players: string[];
  currentPlayerTurn?: string;
  myValuation?: number;
  round?: number;
  events: unknown[];
}

export interface GameResult {
  matchId: string;
  settled: boolean;
  payoutTxs?: Record<string, string>;
  myPayout?: number;
  earnings?: number;
}
