import type { Address, Temperament } from "@nanostakes/shared";
import { getGame } from "@nanostakes/bracket";
import { createMatch, type MatchRecord } from "./state.js";

interface QueueEntry {
  player: Address;
  temperament?: Temperament;
}

const queues = new Map<string, QueueEntry[]>();
/** Once a queued player gets matched, the resulting matchId is parked here until they poll for it. */
const assignments = new Map<Address, string>();

/**
 * Joins the matchmaking queue for `gameId`. As soon as enough players are
 * waiting to satisfy the game's `manifest.minPlayers`, a match is created
 * immediately (no upper bound beyond `maxPlayers` honored per draw) and
 * every drawn player's assignment is recorded for `pollAssignment` to pick up.
 */
export function joinQueue(gameId: string, player: Address, temperament?: Temperament): { matchId?: string } {
  const existing = assignments.get(player);
  if (existing) {
    assignments.delete(player);
    return { matchId: existing };
  }

  const game = getGame(gameId);
  const queue = queues.get(gameId) ?? [];
  if (!queue.some((e) => e.player === player)) {
    queue.push({ player, temperament });
  }
  queues.set(gameId, queue);

  if (queue.length < game.manifest.minPlayers) {
    return {};
  }

  const drawCount = Math.min(queue.length, game.manifest.maxPlayers);
  const drawn = queue.splice(0, drawCount);
  queues.set(gameId, queue);

  const temperaments = Object.fromEntries(
    drawn.filter((e) => e.temperament).map((e) => [e.player, e.temperament as Temperament]),
  );
  const record: MatchRecord = createMatch(
    gameId,
    drawn.map((e) => e.player),
    Object.keys(temperaments).length > 0 ? { temperaments } : undefined,
  );

  for (const e of drawn) {
    if (e.player === player) continue; // returned directly below
    assignments.set(e.player, record.state.matchId);
  }
  return { matchId: record.state.matchId };
}

/** Poll for a match assignment without re-joining (used after the initial joinQueue call returned no matchId yet). */
export function pollAssignment(player: Address): { matchId?: string } {
  const matchId = assignments.get(player);
  if (matchId) {
    assignments.delete(player);
    return { matchId };
  }
  return {};
}

export function queueStatus(gameId: string): { waiting: Address[] } {
  return { waiting: (queues.get(gameId) ?? []).map((e) => e.player) };
}
