import { randomUUID } from "node:crypto";
import {
  computeOfferCommitment,
  type Address,
  type ChatMessage,
  type EngineEvent,
  type GameEngine,
  type GameManifest,
  type MatchResult,
  type MatchState,
  type Move,
  type RoundState,
} from "@nanostakes/shared";

const ROUND_COUNT = 5;
const BASE_POT = 0.6; // USDC notional value of an unescalated round
const RAKE_FRACTION = 0.03;
/** USDC each player escrows to enter — sized to cover worst-case loss across all rounds. */
export const ENTRY_STAKE_EACH = 2.5;

/** Round N's stake cap grows linearly: +25% of BASE_POT per round. */
function roundCap(roundIndex1Based: number): number {
  return BASE_POT * (1 + 0.25 * (roundIndex1Based - 1));
}

function dealRound(index: number): RoundState {
  return {
    index,
    basePot: BASE_POT,
    cap: roundCap(index),
    privateValuation: {},
    claims: {},
    offers: {},
    escalated: {},
    messages: [],
    resolved: false,
    offerCommitments: {},
    offerNonces: {},
  };
}

/** Deterministic-ish per-player hidden valuation in [0.3, 0.9), seeded by match+round+player so re-runs are reproducible per seed. */
function rollValuation(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const frac = (h % 1000) / 1000;
  return 0.3 + frac * 0.6;
}

function currentRound(state: BrinkmanshipState): RoundState {
  const r = state.rounds[state.currentRoundIndex];
  if (!r) throw new Error("no current round");
  return r;
}

function bothActed(state: MatchState): boolean {
  return state.players.every((p) => state.acted[p]);
}

function resolveRound(state: BrinkmanshipState, events: EngineEvent[]): void {
  const round = currentRound(state);
  const [a, b] = state.players;
  const pot = round.escalated[a] || round.escalated[b] ? round.cap : round.basePot;

  const askA = round.offers[a] ?? 0;
  const askB = round.offers[b] ?? 0;
  let receivedA = 0;
  let receivedB = 0;

  if (askA + askB <= 1) {
    receivedA = askA * pot;
    receivedB = askB * pot;
    // unclaimed remainder (1 - askA - askB) * pot is burned (lost to inefficiency, feeds the rake)
  } else {
    const devA = Math.abs((round.claims[a] ?? 0) - round.privateValuation[a]);
    const devB = Math.abs((round.claims[b] ?? 0) - round.privateValuation[b]);
    if (devA < devB) {
      receivedA = Math.min(askA, 1) * pot;
    } else if (devB < devA) {
      receivedB = Math.min(askB, 1) * pot;
    }
    // tie on deviation: both get 0, full pot burns
  }

  round.payoutFraction = {
    [a]: pot === 0 ? 0 : receivedA / pot,
    [b]: pot === 0 ? 0 : receivedB / pot,
  };
  round.resolved = true;

  // ante/pot model: each player anted pot/2 from their escrowed stake into this round
  const ante = pot / 2;
  state.roundDeltas[a] = (state.roundDeltas[a] ?? 0) + (receivedA - ante);
  state.roundDeltas[b] = (state.roundDeltas[b] ?? 0) + (receivedB - ante);

  events.push({
    type: "ROUND_RESOLVED",
    matchId: state.matchId,
    round: round.index,
    payload: { pot, receivedA, receivedB, askA, askB },
    at: new Date().toISOString(),
  });
}

export interface BrinkmanshipState extends MatchState {
  roundDeltas: Record<Address, number>;
}

const manifest: GameManifest = {
  id: "brinkmanship",
  name: "Brinkmanship",
  minPlayers: 2,
  maxPlayers: 2, // phase 1; engine is written so a 3rd (Broker) slot can be added in phase 2 without reshaping this interface
};

function initState(players: Address[]): BrinkmanshipState {
  if (players.length !== 2) throw new Error("Brinkmanship v1 requires exactly 2 players");
  const matchId = randomUUID();
  const rounds = [dealRound(1)];
  const [a, b] = players;
  rounds[0].privateValuation[a] = rollValuation(`${matchId}:1:${a}`);
  rounds[0].privateValuation[b] = rollValuation(`${matchId}:1:${b}`);

  return {
    matchId,
    players,
    entryStakeEach: ENTRY_STAKE_EACH,
    rakeFraction: RAKE_FRACTION,
    rounds,
    currentRoundIndex: 0,
    phase: "NEGOTIATE",
    acted: { [a]: false, [b]: false },
    roundDeltas: { [a]: 0, [b]: 0 },
  };
}

function getLegalMoves(state: BrinkmanshipState, player: Address): Array<Move["type"]> {
  if (state.phase === "NEGOTIATE") return ["message", "claim"];
  if (state.phase === "OFFER") return ["offer"];
  return [];
}

function applyMove(
  state: BrinkmanshipState,
  player: Address,
  move: Move,
): { state: BrinkmanshipState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const round = currentRound(state);

  if (move.type === "message") {
    if (state.phase !== "NEGOTIATE") throw new Error("messages only allowed during NEGOTIATE");
    const msg: ChatMessage = { from: player, to: move.to, text: move.text, round: round.index };
    round.messages.push(msg);
    events.push({
      type: "MESSAGE_SENT",
      matchId: state.matchId,
      round: round.index,
      payload: msg,
      at: new Date().toISOString(),
    });
    return { state, events };
  }

  if (move.type === "claim") {
    if (state.phase !== "NEGOTIATE") throw new Error("claim only allowed during NEGOTIATE");
    round.claims[player] = move.value;
    state.acted[player] = true;
    events.push({
      type: "CLAIM_MADE",
      matchId: state.matchId,
      round: round.index,
      payload: { player, value: move.value },
      at: new Date().toISOString(),
    });
    if (bothActed(state)) {
      state.phase = "OFFER";
      for (const p of state.players) state.acted[p] = false;
    }
    return { state, events };
  }

  if (move.type === "offer") {
    if (state.phase !== "OFFER") throw new Error("offer only allowed during OFFER phase");
    if (move.commitment && move.nonce) {
      const expected = computeOfferCommitment(move.ask, !!move.escalate, move.nonce);
      if (expected.toLowerCase() !== move.commitment.toLowerCase()) {
        throw new Error("offer commitment does not match (ask, escalate, nonce) — rejecting move");
      }
      // Rounds dealt before this feature shipped (still in-flight across a redeploy) won't have these maps yet.
      round.offerCommitments ??= {};
      round.offerNonces ??= {};
      round.offerCommitments[player] = move.commitment;
      round.offerNonces[player] = move.nonce;
    }
    round.offers[player] = move.ask;
    if (move.escalate) round.escalated[player] = true;
    state.acted[player] = true;
    events.push({
      type: "OFFER_MADE",
      matchId: state.matchId,
      round: round.index,
      payload: { player, ask: move.ask, escalate: !!move.escalate, commitment: move.commitment },
      at: new Date().toISOString(),
    });
    if (bothActed(state)) {
      resolveRound(state, events);
      const nextIndex = state.currentRoundIndex + 1;
      if (nextIndex >= ROUND_COUNT) {
        state.phase = "DONE";
        events.push({
          type: "MATCH_RESOLVED",
          matchId: state.matchId,
          payload: getResult(state),
          at: new Date().toISOString(),
        });
      } else {
        const [a, b] = state.players;
        const next = dealRound(nextIndex + 1);
        next.privateValuation[a] = rollValuation(`${state.matchId}:${nextIndex + 1}:${a}`);
        next.privateValuation[b] = rollValuation(`${state.matchId}:${nextIndex + 1}:${b}`);
        state.rounds.push(next);
        state.currentRoundIndex = nextIndex;
        state.phase = "NEGOTIATE";
        for (const p of state.players) state.acted[p] = false;
        events.push({
          type: "ROUND_DEALT",
          matchId: state.matchId,
          round: next.index,
          payload: { cap: next.cap },
          at: new Date().toISOString(),
        });
      }
    }
    return { state, events };
  }

  throw new Error(`unknown move type`);
}

function isTerminal(state: BrinkmanshipState): boolean {
  return state.phase === "DONE";
}

function getResult(state: BrinkmanshipState): MatchResult {
  const totalEscrow = state.entryStakeEach * state.players.length;
  const raw: Record<Address, number> = {};
  for (const p of state.players) {
    raw[p] = (state.entryStakeEach + (state.roundDeltas[p] ?? 0)) / totalEscrow;
  }
  const payouts: Record<Address, number> = {};
  for (const p of state.players) {
    payouts[p] = Math.max(0, raw[p]) * (1 - state.rakeFraction);
  }
  return { payouts };
}

export const brinkmanship: GameEngine<BrinkmanshipState> = {
  manifest,
  initState,
  getLegalMoves,
  applyMove,
  isTerminal,
  getResult,
};
