import { randomUUID } from "node:crypto";
import type { Address, BrokerSeat, EngineEvent, GameEngine, GameManifest, MatchResult, MatchState } from "@nanostakes/shared";

/** One-shot simultaneous-commit Prisoner's-Dilemma-style stake split — proves the Bracket plugin pattern generalizes past Brinkmanship's multi-round structure. */
export const ENTRY_STAKE_EACH = 2.5;
const RAKE_FRACTION = 0.03;

export type Choice = "COOPERATE" | "DEFECT";

export interface ChoiceMove {
  type: "choice";
  value: Choice;
}

/** Fractions of the total escrowed pot (entryStakeEach * 2) each player receives, by outcome. */
const PAYOUTS: Record<`${Choice}_${Choice}`, [number, number]> = {
  COOPERATE_COOPERATE: [0.45, 0.45],
  COOPERATE_DEFECT: [0.15, 0.65],
  DEFECT_COOPERATE: [0.65, 0.15],
  DEFECT_DEFECT: [0.3, 0.3],
};

export interface StandoffState extends MatchState {
  choices: Record<Address, Choice | undefined>;
}

const manifest: GameManifest = {
  id: "standoff",
  name: "Standoff",
  minPlayers: 2,
  maxPlayers: 2,
};

function initState(players: Address[], opts?: Record<string, unknown>): StandoffState {
  if (players.length !== 2) throw new Error("Standoff requires exactly 2 players");
  const [a, b] = players;
  const stakeAsset = (opts?.stakeAsset as "USDC" | "EURC") ?? "USDC";
  return {
    matchId: randomUUID(),
    players,
    entryStakeEach: ENTRY_STAKE_EACH,
    rakeFraction: RAKE_FRACTION,
    rounds: [],
    currentRoundIndex: 0,
    phase: "NEGOTIATE",
    acted: { [a]: false, [b]: false },
    choices: { [a]: undefined, [b]: undefined },
    stakeAsset,
    broker: opts?.broker as BrokerSeat | undefined,
  };
}

function getLegalMoves(state: StandoffState, player: Address): Array<ChoiceMove["type"]> {
  return state.choices[player] === undefined ? ["choice"] : [];
}

function applyMove(
  state: StandoffState,
  player: Address,
  move: ChoiceMove,
): { state: StandoffState; events: EngineEvent[] } {
  if (move.type !== "choice") throw new Error("unknown move type");
  if (state.choices[player] !== undefined) throw new Error("already committed a choice");
  state.choices[player] = move.value;
  state.acted[player] = true;

  const events: EngineEvent[] = [
    {
      type: "CLAIM_MADE",
      matchId: state.matchId,
      payload: { player, value: move.value },
      at: new Date().toISOString(),
    },
  ];

  if (state.players.every((p) => state.choices[p] !== undefined)) {
    state.phase = "DONE";
    events.push({
      type: "MATCH_RESOLVED",
      matchId: state.matchId,
      payload: getResult(state),
      at: new Date().toISOString(),
    });
  }
  return { state, events };
}

function isTerminal(state: StandoffState): boolean {
  return state.phase === "DONE";
}

function getResult(state: StandoffState): MatchResult {
  const [a, b] = state.players;
  const key = `${state.choices[a]}_${state.choices[b]}` as keyof typeof PAYOUTS;
  const [fracA, fracB] = PAYOUTS[key] ?? [0, 0];
  return {
    payouts: {
      [a]: fracA * (1 - state.rakeFraction),
      [b]: fracB * (1 - state.rakeFraction),
    },
  };
}

export const standoff: GameEngine<StandoffState, ChoiceMove> = {
  manifest,
  initState,
  getLegalMoves,
  applyMove,
  isTerminal,
  getResult,
};
