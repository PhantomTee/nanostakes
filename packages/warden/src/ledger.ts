import type { Address, Temperament } from "@nanostakes/shared";
import { db } from "./db.js";

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
}

const selectAgent = db.prepare("SELECT * FROM ledger_agents WHERE address = ?");
const upsertAgent = db.prepare(`
  INSERT INTO ledger_agents (address, temperament, matchesPlayed, wins, losses, ties, totalStaked, totalReturned, netPnl)
  VALUES (@address, @temperament, @matchesPlayed, @wins, @losses, @ties, @totalStaked, @totalReturned, @netPnl)
  ON CONFLICT(address) DO UPDATE SET
    temperament = excluded.temperament,
    matchesPlayed = excluded.matchesPlayed,
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    totalStaked = excluded.totalStaked,
    totalReturned = excluded.totalReturned,
    netPnl = excluded.netPnl
`);
const selectAllAgents = db.prepare("SELECT * FROM ledger_agents");

function getOrCreate(address: Address): AgentRecord {
  const row = selectAgent.get(address) as AgentRecord | undefined;
  if (row) return row;
  return {
    address,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    totalStaked: 0,
    totalReturned: 0,
    netPnl: 0,
  };
}

/**
 * Records the outcome of one settled match for every player. `returned` is
 * each player's actual payout in USDC (what `settleMatch` paid out);
 * `staked` is what they put in. Win/loss/tie is relative to the other
 * player(s) in the same match by net PnL, not by raw payout size.
 */
export function recordMatch(params: {
  players: Address[];
  staked: Record<Address, number>;
  returned: Record<Address, number>;
  temperaments?: Record<Address, Temperament>;
}): void {
  const { players, staked, returned, temperaments } = params;
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

      upsertAgent.run({ ...rec, temperament: rec.temperament ?? null });
    }
  });
  tx();
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
export function getAgentRecord(address: Address): AgentRecord & { standing: Standing } {
  const rec = getOrCreate(address);
  return { ...rec, standing: standingOf(rec) };
}

export function getLeaderboard(): Array<AgentRecord & { standing: Standing }> {
  const rows = selectAllAgents.all() as AgentRecord[];
  return rows.map((rec) => ({ ...rec, standing: standingOf(rec) })).sort((a, b) => b.netPnl - a.netPnl);
}

/** Aggregate stats grouped by temperament, across all agents that have played as that temperament. */
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
