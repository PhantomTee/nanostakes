import type { Address, Temperament } from "@nanostakes/shared";
import { db } from "./db.js";
import type { RoundBehaviorStats } from "./behaviorStats.js";
import { updateElo, currentSeason, BASE_ELO } from "./elo.js";

export interface AgentRecord {
  address: Address;
  temperament?: Temperament;
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  totalStaked: number;
  totalReturned: number;
  /** totalReturned - totalStaked, across all matches. */
  netPnl: number;
  /** Raw accumulators behind the derived behavior stats below — see behaviorStatsOf(). */
  behaviorRounds: number;
  claimSum: number;
  concessionSum: number;
  escalationCount: number;
  fairShareGapSum: number;
  eloRating?: number;
  eloSeason?: number;
  seasonWins?: number;
  seasonLosses?: number;
}

export interface BehaviorStats {
  /** 0..1: how far this agent's sealed asks move toward an even split vs digging in on their claim. */
  concessionRate: number;
  /** 0..1: fraction of resolved rounds in which this agent escalated the pot. */
  escalationRate: number;
  /** 0..1: average distance of this agent's public claim from an even 50/50 share. */
  fairShareGap: number;
  /** Brinkmanship rounds this is derived from; 0 means no signal yet. */
  sampleSize: number;
}

/** Derived (not persisted) behavioral read on *how* an agent played, not just whether it won — see behaviorStats.ts. */
export function behaviorStatsOf(rec: AgentRecord): BehaviorStats {
  if (rec.behaviorRounds === 0) {
    return { concessionRate: 0, escalationRate: 0, fairShareGap: 0, sampleSize: 0 };
  }
  return {
    concessionRate: rec.concessionSum / rec.behaviorRounds,
    escalationRate: rec.escalationCount / rec.behaviorRounds,
    fairShareGap: rec.fairShareGapSum / rec.behaviorRounds,
    sampleSize: rec.behaviorRounds,
  };
}

const selectAgent = db.prepare("SELECT * FROM ledger_agents WHERE address = ?");
const upsertAgent = db.prepare(`
  INSERT INTO ledger_agents (
    address, temperament, matchesPlayed, wins, losses, ties, totalStaked, totalReturned, netPnl,
    behaviorRounds, claimSum, concessionSum, escalationCount, fairShareGapSum,
    elo_rating, elo_season, season_wins, season_losses
  )
  VALUES (
    @address, @temperament, @matchesPlayed, @wins, @losses, @ties, @totalStaked, @totalReturned, @netPnl,
    @behaviorRounds, @claimSum, @concessionSum, @escalationCount, @fairShareGapSum,
    @elo_rating, @elo_season, @season_wins, @season_losses
  )
  ON CONFLICT(address) DO UPDATE SET
    temperament = excluded.temperament,
    matchesPlayed = excluded.matchesPlayed,
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    totalStaked = excluded.totalStaked,
    totalReturned = excluded.totalReturned,
    netPnl = excluded.netPnl,
    behaviorRounds = excluded.behaviorRounds,
    claimSum = excluded.claimSum,
    concessionSum = excluded.concessionSum,
    escalationCount = excluded.escalationCount,
    fairShareGapSum = excluded.fairShareGapSum,
    elo_rating = excluded.elo_rating,
    elo_season = excluded.elo_season,
    season_wins = excluded.season_wins,
    season_losses = excluded.season_losses
`);
const selectAllAgents = db.prepare("SELECT * FROM ledger_agents");

function rowToRecord(row: any): AgentRecord {
  return {
    address: row.address,
    temperament: row.temperament ?? undefined,
    matchesPlayed: row.matchesPlayed ?? 0,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    ties: row.ties ?? 0,
    totalStaked: row.totalStaked ?? 0,
    totalReturned: row.totalReturned ?? 0,
    netPnl: row.netPnl ?? 0,
    behaviorRounds: row.behaviorRounds ?? 0,
    claimSum: row.claimSum ?? 0,
    concessionSum: row.concessionSum ?? 0,
    escalationCount: row.escalationCount ?? 0,
    fairShareGapSum: row.fairShareGapSum ?? 0,
    eloRating: row.elo_rating ?? BASE_ELO,
    eloSeason: row.elo_season ?? 0,
    seasonWins: row.season_wins ?? 0,
    seasonLosses: row.season_losses ?? 0,
  };
}

function getOrCreate(address: Address): AgentRecord {
  const row = selectAgent.get(address) as any | undefined;
  if (row) return rowToRecord(row);
  return {
    address,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    totalStaked: 0,
    totalReturned: 0,
    netPnl: 0,
    behaviorRounds: 0,
    claimSum: 0,
    concessionSum: 0,
    escalationCount: 0,
    fairShareGapSum: 0,
    eloRating: BASE_ELO,
    eloSeason: 0,
    seasonWins: 0,
    seasonLosses: 0,
  };
}

/**
 * Records the outcome of one settled match for every player. `returned` is
 * each player's actual payout in USDC (what `settleMatch` paid out);
 * `staked` is what they put in. Win/loss/tie is relative to the other
 * player(s) in the same match by net PnL, not by raw payout size.
 *
 * `behaviorStats`, when provided (Brinkmanship only — see behaviorStats.ts),
 * folds this match's per-round negotiation behavior into each player's
 * running averages in the same write.
 */
export function recordMatch(params: {
  players: Address[];
  staked: Record<Address, number>;
  returned: Record<Address, number>;
  temperaments?: Record<Address, Temperament>;
  behaviorStats?: Record<Address, RoundBehaviorStats>;
}): void {
  const { players, staked, returned, temperaments, behaviorStats } = params;
  const pnl: Record<Address, number> = {};
  for (const p of players) pnl[p] = (returned[p] ?? 0) - (staked[p] ?? 0);

  const tx = db.transaction(() => {
    for (const p of players) {
      const rec = getOrCreate(p);
      if (temperaments?.[p]) rec.temperament = temperaments[p];
      rec.matchesPlayed += 1;
      rec.totalStaked += staked[p] ?? 0;
      rec.totalReturned += returned[p] ?? 0;
      rec.netPnl += pnl[p];

      const others = players.filter((q) => q !== p);
      const beatsAll = others.every((q) => pnl[p] > pnl[q]);
      const tiesAll = others.every((q) => pnl[p] === pnl[q]);
      if (beatsAll) rec.wins += 1;
      else if (tiesAll) rec.ties += 1;
      else rec.losses += 1;

      const bs = behaviorStats?.[p];
      if (bs) {
        rec.behaviorRounds += bs.rounds;
        rec.claimSum += bs.claimSum;
        rec.concessionSum += bs.concessionSum;
        rec.escalationCount += bs.escalationCount;
        rec.fairShareGapSum += bs.fairShareGapSum;
      }

      upsertAgent.run({
        ...rec,
        temperament: rec.temperament ?? null,
        elo_rating: rec.eloRating ?? BASE_ELO,
        elo_season: rec.eloSeason ?? 0,
        season_wins: rec.seasonWins ?? 0,
        season_losses: rec.seasonLosses ?? 0,
      });
    }
  });
  tx();

  // Elo update for 2-player matches (runs after the main transaction)
  if (players.length === 2) {
    const [p1, p2] = players;
    const r1 = getOrCreate(p1);
    const r2 = getOrCreate(p2);
    const winner = (pnl[p1] ?? 0) > (pnl[p2] ?? 0) ? p1 : ((pnl[p2] ?? 0) > (pnl[p1] ?? 0) ? p2 : null);
    if (winner) {
      const loser = winner === p1 ? p2 : p1;
      const winnerRec = winner === p1 ? r1 : r2;
      const loserRec = winner === p1 ? r2 : r1;
      const [newWinnerElo, newLoserElo] = updateElo(winnerRec.eloRating ?? BASE_ELO, loserRec.eloRating ?? BASE_ELO);
      const season = currentSeason();
      // Update winner
      const winnerUpdate = db.prepare(`UPDATE ledger_agents SET elo_rating=?, elo_season=?, season_wins=season_wins+1 WHERE address=?`);
      winnerUpdate.run(newWinnerElo, season, winner);
      // Update loser
      const loserUpdate = db.prepare(`UPDATE ledger_agents SET elo_rating=?, elo_season=?, season_losses=season_losses+1 WHERE address=?`);
      loserUpdate.run(newLoserElo, season, loser);
    }
  }
}

export type Standing = "UNRANKED" | "CONTENDER" | "STEADY" | "ELITE";

/** Derived (not persisted) tier shown as a Concourse badge — a quick read on an agent's track record. */
export function standingOf(rec: AgentRecord): Standing {
  if (rec.matchesPlayed === 0) return "UNRANKED";
  const winRate = rec.wins / rec.matchesPlayed;
  if (winRate >= 0.6 && rec.netPnl > 0) return "ELITE";
  if (rec.netPnl >= 0) return "STEADY";
  return "CONTENDER";
}

/** Single-agent lookup for per-match badges — returns UNRANKED standing if the agent has no settled history yet. */
export function getAgentRecord(address: Address): AgentRecord & { standing: Standing; behavior: BehaviorStats } {
  const rec = getOrCreate(address);
  return { ...rec, standing: standingOf(rec), behavior: behaviorStatsOf(rec) };
}

export function getLeaderboard(): Array<AgentRecord & { standing: Standing; behavior: BehaviorStats }> {
  const rows = selectAllAgents.all() as any[];
  return rows
    .map((row) => rowToRecord(row))
    .map((rec) => ({ ...rec, standing: standingOf(rec), behavior: behaviorStatsOf(rec) }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

/** Aggregate stats grouped by temperament, across all agents that have played as that temperament. */
/**
 * Stub: records that a broker agent earned a mediation fee for resolving a
 * conflicted Brinkmanship round. Full ledger integration (persistence,
 * leaderboard column) is deferred — this stub lets the broker-offer route
 * compile and run without touching the SQLite schema today.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function recordBrokerMediation(_brokerAddress: string, _feeUsdc: number): void {}

export function getTemperamentStats(): Record<string, { agents: number; matches: number; netPnl: number; avgPnlPerMatch: number }> {
  const leaderboard = getLeaderboard();
  const groups: Record<string, { agents: number; matches: number; netPnl: number }> = {};
  for (const a of leaderboard) {
    const key = a.temperament ?? "UNKNOWN";
    if (!groups[key]) groups[key] = { agents: 0, matches: 0, netPnl: 0 };
    groups[key].agents += 1;
    groups[key].matches += a.matchesPlayed;
    groups[key].netPnl += a.netPnl;
  }
  const out: Record<string, { agents: number; matches: number; netPnl: number; avgPnlPerMatch: number }> = {};
  for (const [k, v] of Object.entries(groups)) {
    out[k] = { ...v, avgPnlPerMatch: v.matches === 0 ? 0 : v.netPnl / v.matches };
  }
  return out;
}

export function getSeasonLeaderboard(): AgentRecord[] {
  const rows = db.prepare("SELECT * FROM ledger_agents WHERE matchesPlayed > 0 ORDER BY elo_rating DESC").all() as any[];
  return rows.map(rowToRecord);
}
