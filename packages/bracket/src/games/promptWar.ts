import { randomUUID } from "node:crypto";
import type { Address, EngineEvent, GameEngine, GameManifest, MatchResult } from "@nanostakes/shared";

/** One-shot sealed-pitch game judged by a neutral third party, not a payout formula — proves the Bracket plugin pattern works for non-deterministic settlement too. */
export const ENTRY_STAKE_EACH = 2.5;
const RAKE_FRACTION = 0.03;

const SCENARIOS = [
  "You are pitching a single product idea to a notoriously skeptical angel investor who has funded nothing in six months.",
  "You are pitching a one-sentence apology and remediation plan to a customer whose order was lost in transit.",
  "You are pitching a vacation destination to a friend who insists they 'don't really like traveling'.",
  "You are pitching a name for a new neighborhood coffee shop to its undecided owner.",
  "You are pitching a plan to repurpose an unused office room to a facilities manager who default to 'no'.",
];

export interface PromptWarMove {
  type: "pitch";
  text: string;
}

export interface PromptWarState {
  matchId: string;
  players: Address[];
  entryStakeEach: number;
  rakeFraction: number;
  scenario: string;
  pitches: Record<Address, string | undefined>;
  acted: Record<Address, boolean>;
  /**
   * "PITCH" while waiting on submissions, "JUDGING" once both are in and a
   * neutral LLM judge call is needed (server.ts special-cases this gameId to
   * run that async judging step — see promptWarJudge.ts — since the pure
   * GameEngine interface has no room for I/O), "DONE" once `winner` is set.
   */
  phase: "PITCH" | "JUDGING" | "DONE";
  winner?: Address;
  judgeRationale?: string;
}

const manifest: GameManifest = {
  id: "promptwar",
  name: "Prompt War",
  minPlayers: 2,
  maxPlayers: 2,
};

function initState(players: Address[]): PromptWarState {
  if (players.length !== 2) throw new Error("Prompt War requires exactly 2 players");
  const [a, b] = players;
  return {
    matchId: randomUUID(),
    players,
    entryStakeEach: ENTRY_STAKE_EACH,
    rakeFraction: RAKE_FRACTION,
    scenario: SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)],
    pitches: { [a]: undefined, [b]: undefined },
    acted: { [a]: false, [b]: false },
    phase: "PITCH",
  };
}

function getLegalMoves(state: PromptWarState, player: Address): Array<PromptWarMove["type"]> {
  return state.phase === "PITCH" && state.pitches[player] === undefined ? ["pitch"] : [];
}

function applyMove(
  state: PromptWarState,
  player: Address,
  move: PromptWarMove,
): { state: PromptWarState; events: EngineEvent[] } {
  if (move.type !== "pitch") throw new Error("unknown move type");
  if (state.phase !== "PITCH") throw new Error("pitches are already closed for this match");
  if (state.pitches[player] !== undefined) throw new Error("already submitted a pitch");

  state.pitches[player] = move.text;
  state.acted[player] = true;

  const events: EngineEvent[] = [
    {
      type: "CLAIM_MADE",
      matchId: state.matchId,
      payload: { player, sealed: true },
      at: new Date().toISOString(),
    },
  ];

  if (state.players.every((p) => state.pitches[p] !== undefined)) {
    state.phase = "JUDGING";
  }
  return { state, events };
}

function isTerminal(state: PromptWarState): boolean {
  return state.phase === "DONE" && !!state.winner;
}

function getResult(state: PromptWarState): MatchResult {
  const payouts: Record<Address, number> = {};
  for (const p of state.players) {
    payouts[p] = p === state.winner ? 1 - state.rakeFraction : 0;
  }
  return { payouts };
}

export const promptWar: GameEngine<PromptWarState, PromptWarMove> = {
  manifest,
  initState,
  getLegalMoves,
  applyMove,
  isTerminal,
  getResult,
};
