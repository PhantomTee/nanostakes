import { randomUUID } from "node:crypto";
import type { Address } from "@nanostakes/shared";
import { createMatch } from "./state.js";
import { assignMatch } from "./matchmaking.js";

export type ChallengeStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";

export interface Challenge {
  id: string;
  gameId: string;
  from: Address;
  to: Address;
  status: ChallengeStatus;
  createdAt: number;
  matchId?: string;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const challenges = new Map<string, Challenge>();

function expireStale(): void {
  const cutoff = Date.now() - CHALLENGE_TTL_MS;
  for (const c of challenges.values()) {
    if (c.status === "PENDING" && c.createdAt < cutoff) c.status = "EXPIRED";
  }
}

/** Issue a challenge from one agent to a specific opponent, naming who plays, not a blind queue draw. */
export function createChallenge(gameId: string, from: Address, to: Address): Challenge {
  if (from.toLowerCase() === to.toLowerCase()) {
    throw new Error("cannot challenge yourself");
  }
  const challenge: Challenge = { id: randomUUID(), gameId, from, to, status: "PENDING", createdAt: Date.now() };
  challenges.set(challenge.id, challenge);
  return challenge;
}

/** Pending challenges sitting in either direction for a given player — incoming to decide on, outgoing to track. */
export function listChallenges(player: Address): { incoming: Challenge[]; outgoing: Challenge[] } {
  expireStale();
  const all = [...challenges.values()];
  return {
    incoming: all.filter((c) => c.to.toLowerCase() === player.toLowerCase() && c.status === "PENDING"),
    outgoing: all.filter((c) => c.from.toLowerCase() === player.toLowerCase()),
  };
}

/**
 * Accept or decline an incoming challenge. Accepting creates the match
 * immediately and hands the matchId to both players through the same
 * delivery channel blind-queue pairing uses (`assignMatch`), so neither
 * driver needs a separate polling path to pick it up.
 */
export function respondToChallenge(challengeId: string, responder: Address, accept: boolean): Challenge {
  const challenge = challenges.get(challengeId);
  if (!challenge) throw new Error("unknown challenge");
  if (challenge.to.toLowerCase() !== responder.toLowerCase()) {
    throw new Error("only the challenged player can respond to this challenge");
  }
  if (challenge.status !== "PENDING") {
    throw new Error(`challenge is already ${challenge.status.toLowerCase()}`);
  }

  if (!accept) {
    challenge.status = "DECLINED";
    return challenge;
  }

  const record = createMatch(challenge.gameId, [challenge.from, challenge.to]);
  challenge.status = "ACCEPTED";
  challenge.matchId = record.state.matchId;
  assignMatch(challenge.from, record.state.matchId);
  assignMatch(challenge.to, record.state.matchId);
  return challenge;
}
