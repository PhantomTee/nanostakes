import { randomUUID } from "node:crypto";
import { createMatch } from "./state.js";
import type { Address } from "@nanostakes/shared";

export type TournamentFormat = "round-robin" | "single-elimination";
export type TournamentStatus = "REGISTRATION" | "ACTIVE" | "COMPLETE";

export interface Tournament {
  id: string;
  name: string;
  gameId: string;
  format: TournamentFormat;
  entryFeeUsdc: number;
  prizePoolUsdc: number;
  maxPlayers: number;
  players: Address[];
  status: TournamentStatus;
  rounds: TournamentRound[];
  standings: Record<Address, { wins: number; losses: number; points: number; earnings: number }>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface TournamentRound {
  roundNumber: number;
  matchIds: string[];
  status: "PENDING" | "ACTIVE" | "COMPLETE";
}

const tournaments = new Map<string, Tournament>();

export function createTournament(params: {
  name: string;
  gameId: string;
  format: TournamentFormat;
  entryFeeUsdc: number;
  prizePoolUsdc: number;
  maxPlayers: number;
}): Tournament {
  const t: Tournament = {
    id: randomUUID(),
    ...params,
    players: [],
    status: "REGISTRATION",
    rounds: [],
    standings: {},
    createdAt: new Date().toISOString(),
  };
  tournaments.set(t.id, t);
  return t;
}

export function joinTournament(tournamentId: string, player: Address): Tournament {
  const t = tournaments.get(tournamentId);
  if (!t) throw new Error("unknown tournament");
  if (t.status !== "REGISTRATION") throw new Error("tournament is not accepting registrations");
  if (t.players.includes(player)) throw new Error("already registered");
  if (t.players.length >= t.maxPlayers) throw new Error("tournament is full");
  t.players.push(player);
  t.standings[player] = { wins: 0, losses: 0, points: 0, earnings: 0 };
  if (t.players.length === t.maxPlayers) startTournament(t);
  return t;
}

function startTournament(t: Tournament): void {
  t.status = "ACTIVE";
  t.startedAt = new Date().toISOString();
  if (t.format === "round-robin") generateRoundRobinBracket(t);
  else generateSingleEliminationBracket(t);
}

function generateRoundRobinBracket(t: Tournament): void {
  // Every player plays every other player once
  const players = [...t.players];
  const rounds: TournamentRound[] = [];
  // Simple round-robin scheduling
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const round =
        rounds.find((r) => r.status === "PENDING" && !r.matchIds.length) ??
        (() => {
          const r: TournamentRound = { roundNumber: rounds.length + 1, matchIds: [], status: "PENDING" };
          rounds.push(r);
          return r;
        })();
      const record = createMatch(t.gameId, [players[i], players[j]]);
      round.matchIds.push(record.state.matchId);
    }
  }
  t.rounds = rounds;
}

function generateSingleEliminationBracket(t: Tournament): void {
  // Pair players randomly for round 1
  const players = [...t.players].sort(() => 0.5 - Math.random()); // shuffle
  const round1: TournamentRound = { roundNumber: 1, matchIds: [], status: "PENDING" };
  for (let i = 0; i < players.length; i += 2) {
    if (i + 1 < players.length) {
      const record = createMatch(t.gameId, [players[i], players[i + 1]]);
      round1.matchIds.push(record.state.matchId);
    }
  }
  t.rounds = [round1];
}

export function recordTournamentMatchResult(
  tournamentId: string,
  matchId: string,
  winner: Address,
  earnings: number,
): void {
  const t = tournaments.get(tournamentId);
  if (!t) return;
  if (t.standings[winner]) {
    t.standings[winner].wins += 1;
    t.standings[winner].points += 3;
    t.standings[winner].earnings += earnings;
  }
  const loser = t.players.find((p) => p !== winner);
  if (loser && t.standings[loser]) {
    t.standings[loser].losses += 1;
  }
  // Suppress unused-param lint: matchId is threaded through for future use
  void matchId;
  // Check if all matches in current round are done → advance or complete
  advanceTournamentIfReady(t);
}

function advanceTournamentIfReady(t: Tournament): void {
  const currentRound = t.rounds.find((r) => r.status !== "COMPLETE");
  if (!currentRound) {
    t.status = "COMPLETE";
    t.completedAt = new Date().toISOString();
    distributeTournamentPrizes(t);
    return;
  }
  currentRound.status = "COMPLETE";
  if (t.format === "single-elimination" && t.status === "ACTIVE") {
    // Generate next round from winners
    const winners = Object.entries(t.standings)
      .sort(([, a], [, b]) => b.wins - a.wins)
      .slice(0, Math.floor(t.players.length / Math.pow(2, t.rounds.length)))
      .map(([addr]) => addr as Address);
    if (winners.length > 1) {
      const nextRound: TournamentRound = {
        roundNumber: t.rounds.length + 1,
        matchIds: [],
        status: "PENDING",
      };
      for (let i = 0; i < winners.length; i += 2) {
        if (i + 1 < winners.length) {
          const record = createMatch(t.gameId, [winners[i], winners[i + 1]]);
          nextRound.matchIds.push(record.state.matchId);
        }
      }
      t.rounds.push(nextRound);
    } else {
      t.status = "COMPLETE";
      t.completedAt = new Date().toISOString();
      distributeTournamentPrizes(t);
    }
  }
}

function distributeTournamentPrizes(t: Tournament): void {
  // Prize distribution: 1st 60%, 2nd 35%, 3rd 5%
  const ranked = Object.entries(t.standings).sort(
    ([, a], [, b]) => b.points - a.points || b.earnings - a.earnings,
  );
  const pool = t.prizePoolUsdc;
  const distribution = [0.6, 0.35, 0.05];
  ranked.forEach(([, standing], i) => {
    if (i < distribution.length) {
      standing.earnings += pool * distribution[i];
    }
  });
}

export function getTournament(id: string): Tournament | undefined {
  return tournaments.get(id);
}

export function listTournaments(): Tournament[] {
  return [...tournaments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
