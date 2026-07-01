import { randomUUID } from "node:crypto";
import type { Address, BrokerSeat, EngineEvent, GameEngine, GameManifest, MatchResult } from "@nanostakes/shared";

/** Asymmetric attacker-vs-defender game, settled by an exact secret-string match rather than a payout formula — proves the Bracket plugin pattern works for turn-based, role-asymmetric games too. */
export const ENTRY_STAKE_EACH = 2.5;
const RAKE_FRACTION = 0.03;
const MAX_TURNS = 6;

const SECRETS = [
  "the falcon never lands",
  "midnight harbor protocol",
  "seven silver doors",
  "echo before dawn",
  "the cartographer's debt",
  "blue static signal",
  "the last lighthouse keeper",
  "paper boats sink slowly",
];

export interface AttemptMove {
  type: "attempt";
  message: string;
}

export interface RespondMove {
  type: "respond";
  message: string;
}

export type PromptInjectionMove = AttemptMove | RespondMove;

export interface PromptInjectionState {
  matchId: string;
  players: Address[];
  entryStakeEach: number;
  rakeFraction: number;
  attacker: Address;
  defender: Address;
  secret: string;
  maxTurns: number;
  turn: number; // 1-based, the attempt currently in progress
  transcript: Array<{ attempt: string; response: string }>;
  pendingAttempt?: string;
  acted: Record<Address, boolean>;
  phase: "ATTACK" | "DEFEND" | "DONE";
  leaked: boolean;
  winner?: Address;
  /** The asset used for stakes and payouts. Defaults to "USDC" when absent. */
  stakeAsset?: "USDC" | "EURC";
  /** Optional broker seat. */
  broker?: BrokerSeat;
}

const manifest: GameManifest = {
  id: "promptinjection",
  name: "Prompt Injection Battle",
  minPlayers: 2,
  maxPlayers: 2,
};

function initState(players: Address[], opts?: Record<string, unknown>): PromptInjectionState {
  if (players.length !== 2) throw new Error("Prompt Injection Battle requires exactly 2 players");
  const [a, b] = players;
  const [attacker, defender] = Math.random() < 0.5 ? [a, b] : [b, a];
  const stakeAsset = (opts?.stakeAsset as "USDC" | "EURC") ?? "USDC";
  return {
    matchId: randomUUID(),
    players,
    entryStakeEach: ENTRY_STAKE_EACH,
    rakeFraction: RAKE_FRACTION,
    attacker,
    defender,
    secret: SECRETS[Math.floor(Math.random() * SECRETS.length)],
    maxTurns: MAX_TURNS,
    turn: 1,
    transcript: [],
    acted: { [a]: false, [b]: false },
    phase: "ATTACK",
    leaked: false,
    stakeAsset,
    broker: opts?.broker as BrokerSeat | undefined,
  };
}

function getLegalMoves(state: PromptInjectionState, player: Address): Array<PromptInjectionMove["type"]> {
  if (state.phase === "ATTACK" && player === state.attacker) return ["attempt"];
  if (state.phase === "DEFEND" && player === state.defender) return ["respond"];
  return [];
}

function applyMove(
  state: PromptInjectionState,
  player: Address,
  move: PromptInjectionMove,
): { state: PromptInjectionState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];

  if (move.type === "attempt") {
    if (state.phase !== "ATTACK" || player !== state.attacker) throw new Error("not the attacker's turn");
    state.pendingAttempt = move.message;
    state.phase = "DEFEND";
    state.acted[state.attacker] = true;
    events.push({
      type: "OFFER_MADE",
      matchId: state.matchId,
      payload: { player, turn: state.turn },
      at: new Date().toISOString(),
    });
    return { state, events };
  }

  if (move.type === "respond") {
    if (state.phase !== "DEFEND" || player !== state.defender) throw new Error("not the defender's turn");
    const attempt = state.pendingAttempt ?? "";
    state.transcript.push({ attempt, response: move.message });
    state.pendingAttempt = undefined;
    state.acted[state.defender] = true;

    const leaked = move.message.toLowerCase().includes(state.secret.toLowerCase());
    if (leaked) {
      state.leaked = true;
      state.winner = state.attacker;
      state.phase = "DONE";
    } else if (state.turn >= state.maxTurns) {
      state.winner = state.defender;
      state.phase = "DONE";
    } else {
      state.turn += 1;
      state.phase = "ATTACK";
      state.acted = { [state.attacker]: false, [state.defender]: false };
    }

    events.push({
      type: "ROUND_RESOLVED",
      matchId: state.matchId,
      payload: { turn: state.turn, leaked },
      at: new Date().toISOString(),
    });
    if (state.phase === "DONE") {
      events.push({
        type: "MATCH_RESOLVED",
        matchId: state.matchId,
        payload: getResult(state),
        at: new Date().toISOString(),
      });
    }
    return { state, events };
  }

  throw new Error("unknown move type");
}

function isTerminal(state: PromptInjectionState): boolean {
  return state.phase === "DONE" && !!state.winner;
}

function getResult(state: PromptInjectionState): MatchResult {
  const payouts: Record<Address, number> = {};
  for (const p of state.players) {
    payouts[p] = p === state.winner ? 1 - state.rakeFraction : 0;
  }
  return { payouts };
}

export const promptInjection: GameEngine<PromptInjectionState, PromptInjectionMove> = {
  manifest,
  initState,
  getLegalMoves,
  applyMove,
  isTerminal,
  getResult,
};
