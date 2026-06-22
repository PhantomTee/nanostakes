import type { Address, EngineEvent, Temperament } from "@nanostakes/shared";
import { getGame } from "@nanostakes/bracket";
import type { BrinkmanshipState, StandoffState } from "@nanostakes/bracket";
import { db } from "./db.js";

export type MatchStatus = "AWAITING_STAKES" | "ACTIVE" | "SETTLED";

export interface MatchRecord {
  gameId: string;
  status: MatchStatus;
  state: BrinkmanshipState | StandoffState;
  staked: Record<Address, boolean>;
  events: EngineEvent[];
  payoutTxs?: Record<Address, string>;
  stakeTxs?: Record<Address, string>;
  /** Optional caller-supplied metadata (e.g. each player's temperament) — the Warden has no other way to know this, it just tags it onto the ledger. */
  meta?: { temperaments?: Record<Address, Temperament> };
  createdAt?: string;
  /** Bumped on every persistMatch() call — used to detect a match nobody has touched in a while (see abandon.ts). */
  lastMoveAt?: string;
}

const matches = new Map<string, MatchRecord>();

const upsertMatchStmt = db.prepare(
  `INSERT INTO matches (matchId, gameId, status, data, createdAt) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(matchId) DO UPDATE SET status = excluded.status, data = excluded.data`,
);

/**
 * Match state lives in-memory for the hot path (every move mutates it
 * directly), but is mirrored to SQLite on every write so match history
 * survives a server restart. Without this, every redeploy silently wiped
 * Concourse's "watch any match" picker back to empty.
 */
export function persistMatch(record: MatchRecord): void {
  record.lastMoveAt = new Date().toISOString();
  upsertMatchStmt.run(
    record.state.matchId,
    record.gameId,
    record.status,
    JSON.stringify(record),
    record.createdAt ?? record.lastMoveAt,
  );
}

function hydrateMatchesFromDb(): void {
  const rows = db.prepare(`SELECT data FROM matches`).all() as { data: string }[];
  for (const row of rows) {
    const record = JSON.parse(row.data) as MatchRecord;
    matches.set(record.state.matchId, record);
  }
}

hydrateMatchesFromDb();

export function createMatch(
  gameId: string,
  players: Address[],
  meta?: MatchRecord["meta"],
): MatchRecord {
  const game = getGame(gameId);
  if (players.length < game.manifest.minPlayers || players.length > game.manifest.maxPlayers) {
    throw new Error(
      `${gameId} requires between ${game.manifest.minPlayers} and ${game.manifest.maxPlayers} players, got ${players.length}`,
    );
  }
  const state = game.initState(players) as BrinkmanshipState | StandoffState;
  const record: MatchRecord = {
    gameId,
    status: "AWAITING_STAKES",
    state,
    staked: Object.fromEntries(players.map((p) => [p, false])),
    events: [],
    meta,
    createdAt: new Date().toISOString(),
  };
  matches.set(state.matchId, record);
  persistMatch(record);
  return record;
}

export function getMatch(matchId: string): MatchRecord {
  const record = matches.get(matchId);
  if (!record) throw new Error(`unknown match: ${matchId}`);
  return record;
}

/** Strip information the requesting player should not see: opponents' hidden valuations, and sealed (unrevealed) claims/offers. */
export function sanitizeForPlayer(record: MatchRecord, viewer: Address): unknown {
  if (record.gameId === "standoff") return sanitizeStandoffForPlayer(record, viewer);
  return sanitizeBrinkmanshipForPlayer(record, viewer);
}

function sanitizeStandoffForPlayer(record: MatchRecord, viewer: Address): unknown {
  const state = record.state as StandoffState;
  const done = state.phase === "DONE";
  return {
    matchId: state.matchId,
    players: state.players,
    status: record.status,
    phase: state.phase,
    acted: state.acted,
    myChoice: state.choices[viewer] ?? null,
    choices: done ? state.choices : redactOthers(state.choices, viewer),
  };
}

function sanitizeBrinkmanshipForPlayer(record: MatchRecord, viewer: Address): unknown {
  const state = record.state as BrinkmanshipState;
  const rounds = state.rounds.map((round, i) => {
    const isCurrent = i === state.currentRoundIndex && state.phase !== "DONE";
    const sealed = isCurrent && !round.resolved;
    return {
      index: round.index,
      basePot: round.basePot,
      cap: round.cap,
      myValuation: round.privateValuation[viewer],
      claims: round.claims, // claims are public the moment they're made — only offers are sealed
      offers: sealed ? redactOthers(round.offers, viewer) : round.offers,
      // Commitments are safe to reveal even while sealed — that's the point: a real cryptographic
      // hash exists before either offer is known, not just a promise the server kept it hidden.
      // (Default to {} — matches persisted before this feature shipped have no commitment data.)
      offerCommitments: round.offerCommitments ?? {},
      offerNonces: sealed ? redactOthers(round.offerNonces ?? {}, viewer) : round.offerNonces ?? {},
      escalated: round.escalated,
      messages: round.messages.filter((m) => m.from === viewer || m.to === viewer),
      resolved: round.resolved,
      payoutFraction: round.payoutFraction,
    };
  });
  return {
    matchId: state.matchId,
    players: state.players,
    status: record.status,
    phase: state.phase,
    currentRoundIndex: state.currentRoundIndex,
    acted: state.acted,
    rounds,
  };
}

function redactOthers<T>(rec: Record<Address, T>, viewer: Address): Record<Address, T | null> {
  const out: Record<Address, T | null> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = k === viewer ? v : null;
  return out;
}

/** Public/spectator view: no player's hidden valuations or sealed offers are visible to anyone. */
export function sanitizeForSpectator(record: MatchRecord): unknown {
  if (record.gameId === "standoff") return sanitizeStandoffForSpectator(record);
  return sanitizeBrinkmanshipForSpectator(record);
}

function sanitizeStandoffForSpectator(record: MatchRecord): unknown {
  const state = record.state as StandoffState;
  const done = state.phase === "DONE";
  return {
    matchId: state.matchId,
    players: state.players,
    status: record.status,
    phase: state.phase,
    acted: state.acted,
    choices: done ? state.choices : redactAll(state.choices),
    stakeTxs: record.stakeTxs,
    payoutTxs: record.payoutTxs,
  };
}

function sanitizeBrinkmanshipForSpectator(record: MatchRecord): unknown {
  const state = record.state as BrinkmanshipState;
  const rounds = state.rounds.map((round, i) => {
    const isCurrent = i === state.currentRoundIndex && state.phase !== "DONE";
    const sealed = isCurrent && !round.resolved;
    return {
      index: round.index,
      basePot: round.basePot,
      cap: round.cap,
      claims: round.claims,
      offers: sealed ? redactAll(round.offers) : round.offers,
      offerCommitments: round.offerCommitments ?? {},
      offerNonces: sealed ? redactAll(round.offerNonces ?? {}) : round.offerNonces ?? {},
      escalated: round.escalated,
      messages: round.messages,
      resolved: round.resolved,
      payoutFraction: round.payoutFraction,
    };
  });
  return {
    matchId: state.matchId,
    players: state.players,
    status: record.status,
    phase: state.phase,
    currentRoundIndex: state.currentRoundIndex,
    acted: state.acted,
    rounds,
    stakeTxs: record.stakeTxs,
    payoutTxs: record.payoutTxs,
  };
}

function redactAll<T>(rec: Record<Address, T>): Record<Address, null> {
  const out: Record<Address, null> = {};
  for (const k of Object.keys(rec)) out[k] = null;
  return out;
}

export function allMatches(): MatchRecord[] {
  return [...matches.values()].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

const deleteMatchStmt = db.prepare(`DELETE FROM matches WHERE matchId = ?`);

/**
 * Crash-loop nights (a stake payment that never lands) leave behind a trail
 * of AWAITING_STAKES matches that will never resolve — the driver abandons
 * each one and rejoins the queue fresh rather than retrying the same match.
 * These just clutter Concourse's picker forever since nothing ever moves
 * them to SETTLED. Safe to drop: nothing is escrowed against an unstaked
 * match, so there's no money to account for.
 */
export function pruneStaleAwaitingStakes(maxAgeMs = 5 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [matchId, record] of matches) {
    if (record.status !== "AWAITING_STAKES") continue;
    const createdAt = record.createdAt ? new Date(record.createdAt).getTime() : 0;
    if (createdAt && createdAt > cutoff) continue;
    matches.delete(matchId);
    deleteMatchStmt.run(matchId);
    removed++;
  }
  return removed;
}
