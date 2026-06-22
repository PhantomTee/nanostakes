import type { Address } from "@nanostakes/shared";
import { db } from "./db.js";
import type { RoundBehaviorStats } from "./behaviorStats.js";

export interface OpponentMemory {
  matchesPlayed: number;
  rounds: number;
  opponentAvgClaim: number;
  opponentEscalationRate: number;
  opponentConcessionRate: number;
}

interface MemoryRow {
  matchesPlayed: number;
  rounds: number;
  claimSum: number;
  concessionSum: number;
  escalationCount: number;
}

const selectMemory = db.prepare(
  "SELECT matchesPlayed, rounds, claimSum, concessionSum, escalationCount FROM agent_memory WHERE selfAddress = ? AND opponentAddress = ?",
);
const upsertMemory = db.prepare(`
  INSERT INTO agent_memory (selfAddress, opponentAddress, matchesPlayed, rounds, claimSum, concessionSum, escalationCount, lastUpdated)
  VALUES (@selfAddress, @opponentAddress, @matchesPlayed, @rounds, @claimSum, @concessionSum, @escalationCount, @lastUpdated)
  ON CONFLICT(selfAddress, opponentAddress) DO UPDATE SET
    matchesPlayed = excluded.matchesPlayed,
    rounds = excluded.rounds,
    claimSum = excluded.claimSum,
    concessionSum = excluded.concessionSum,
    escalationCount = excluded.escalationCount,
    lastUpdated = excluded.lastUpdated
`);

/**
 * Folds one settled Brinkmanship match's stats into what each player
 * remembers about the *other*: `opponentStats[address]` (from
 * computeBrinkmanshipRoundStats) is exactly what the other player should
 * learn, since claims/escalations are public and offers are revealed by
 * settlement time. Called once per settled match, both directions.
 */
export function recordOpponentMemory(
  players: [Address, Address],
  opponentStats: Record<Address, RoundBehaviorStats>,
): void {
  const [a, b] = players;
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const [self, opponent] of [[a, b], [b, a]] as const) {
      const observed = opponentStats[opponent];
      if (!observed) continue;
      const row = (selectMemory.get(self, opponent) as MemoryRow | undefined) ?? {
        matchesPlayed: 0,
        rounds: 0,
        claimSum: 0,
        concessionSum: 0,
        escalationCount: 0,
      };
      upsertMemory.run({
        selfAddress: self,
        opponentAddress: opponent,
        matchesPlayed: row.matchesPlayed + 1,
        rounds: row.rounds + observed.rounds,
        claimSum: row.claimSum + observed.claimSum,
        concessionSum: row.concessionSum + observed.concessionSum,
        escalationCount: row.escalationCount + observed.escalationCount,
        lastUpdated: now,
      });
    }
  });
  tx();
}

/** What `self` has learned about `opponent` from prior settled matches — null if they've never played before. */
export function getOpponentMemory(self: Address, opponent: Address): OpponentMemory | null {
  const row = selectMemory.get(self, opponent) as MemoryRow | undefined;
  if (!row || row.rounds === 0) return null;
  return {
    matchesPlayed: row.matchesPlayed,
    rounds: row.rounds,
    opponentAvgClaim: row.claimSum / row.rounds,
    opponentEscalationRate: row.escalationCount / row.rounds,
    opponentConcessionRate: row.concessionSum / row.rounds,
  };
}
