import { createHash, randomUUID } from "node:crypto";
import type { Address, EngineEvent, GameEngine, GameManifest, MatchResult } from "@nanostakes/shared";

export const ENTRY_STAKE_EACH = 3.0;
const RAKE_FRACTION = 0.03;

// ── Types ────────────────────────────────────────────────────────────────────

export interface PokerState {
  matchId: string;
  players: Address[];
  entryStakeEach: number;
  rakeFraction: number;
  stakeAsset?: "USDC" | "EURC";
  broker?: { address: Address; spreadFraction: number };
  phase: "PRE_FLOP" | "FLOP" | "RIVER" | "SHOWDOWN" | "DONE";
  deck: string[];
  holeCards: Record<Address, [string, string]>;
  communityCards: string[];
  pot: number;
  bets: Record<Address, number>;
  folded: Record<Address, boolean>;
  acted: Record<Address, boolean>;
  winner?: Address;
  handRankings?: Record<Address, number>;
  // internal tracking
  _roundSeed: number; // increments each betting round to make seed unique
  _actionIndex: number; // whose turn it is (index into active players)
}

export interface BetMove {
  type: "bet";
  amount: number; // 0 = check
}

export interface FoldMove {
  type: "fold";
}

export type PokerMove = BetMove | FoldMove;

const manifest: GameManifest = {
  id: "poker",
  name: "Texas Hold'em",
  minPlayers: 2,
  maxPlayers: 3,
};

// ── Deck utilities ───────────────────────────────────────────────────────────

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
const SUITS = ["s", "h", "d", "c"] as const;

function buildDeck(): string[] {
  const deck: string[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Fisher-Yates shuffle seeded deterministically via SHA-256. */
function shuffleDeck(deck: string[], seed: string): string[] {
  const arr = [...deck];
  const hashBuf = createHash("sha256").update(seed).digest();
  // Use each byte as a source of entropy, cycling if needed
  let byteIdx = 0;
  function nextByte(): number {
    return hashBuf[byteIdx++ % 32];
  }
  // For better coverage, rehash when we cycle
  let hashCycle = 0;
  function nextRandByte(): number {
    if (byteIdx >= 32) {
      byteIdx = 0;
      hashCycle++;
      const extended = createHash("sha256")
        .update(seed + hashCycle.toString())
        .digest();
      return extended[byteIdx++];
    }
    return nextByte();
  }

  for (let i = arr.length - 1; i > 0; i--) {
    // Build a uniform index in [0..i] from two random bytes
    const r = ((nextRandByte() << 8) | nextRandByte()) % (i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[r]!;
    arr[r] = tmp;
  }
  return arr;
}

// ── Hand evaluation ──────────────────────────────────────────────────────────

function cardRank(card: string): number {
  return RANKS.indexOf(card[0] as typeof RANKS[number]);
}

function cardSuit(card: string): string {
  return card[1]!;
}

/**
 * Evaluates the best 5-card hand from the given cards (2 hole + 5 community).
 * Returns a numeric score — higher is better.
 * Hand class scores:
 *   High card       0
 *   Pair         1000
 *   Two pair     2000
 *   Three of a kind 3000
 *   Straight     4000
 *   Flush        5000
 *   Full house   6000
 *   Four of a kind 7000
 *   Straight flush 8000
 * Tiebreaker: card rank values embedded after the class score.
 */
function evaluateHand(cards: string[]): number {
  // Generate all C(n,5) combinations
  const best = chooseBest5(cards);
  return score5(best);
}

function chooseBest5(cards: string[]): string[] {
  if (cards.length <= 5) return cards;
  let bestScore = -1;
  let bestHand: string[] = [];
  for (let i = 0; i < cards.length - 4; i++) {
    for (let j = i + 1; j < cards.length - 3; j++) {
      for (let k = j + 1; k < cards.length - 2; k++) {
        for (let l = k + 1; l < cards.length - 1; l++) {
          for (let m = l + 1; m < cards.length; m++) {
            const hand = [cards[i]!, cards[j]!, cards[k]!, cards[l]!, cards[m]!];
            const s = score5(hand);
            if (s > bestScore) {
              bestScore = s;
              bestHand = hand;
            }
          }
        }
      }
    }
  }
  return bestHand;
}

function score5(cards: string[]): number {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);
  const isFlush = suits.every((s) => s === suits[0]);
  const isStraight = checkStraight(ranks);
  const rankCounts = countValues(ranks);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const tiebreaker = tiebreakerScore(ranks);

  if (isFlush && isStraight) return 8000 + tiebreaker;
  if (counts[0] === 4) return 7000 + tiebreaker;
  if (counts[0] === 3 && counts[1] === 2) return 6000 + tiebreaker;
  if (isFlush) return 5000 + tiebreaker;
  if (isStraight) return 4000 + tiebreaker;
  if (counts[0] === 3) return 3000 + tiebreaker;
  if (counts[0] === 2 && counts[1] === 2) return 2000 + tiebreaker;
  if (counts[0] === 2) return 1000 + tiebreaker;
  return tiebreaker;
}

function checkStraight(sortedRanks: number[]): boolean {
  // Normal straight
  if (sortedRanks[0]! - sortedRanks[4]! === 4 && new Set(sortedRanks).size === 5) return true;
  // Wheel: A-2-3-4-5
  const rankSet = new Set(sortedRanks);
  if (rankSet.has(12) && rankSet.has(0) && rankSet.has(1) && rankSet.has(2) && rankSet.has(3)) return true;
  return false;
}

function countValues(ranks: number[]): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const r of ranks) {
    counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

/** Encode sorted ranks into a tiebreaker score (each card 0-12, position weighted). */
function tiebreakerScore(sortedRanks: number[]): number {
  // Sort by count desc, then rank desc (so pairs beat kickers, etc.)
  const counts = countValues(sortedRanks);
  const groups: number[][] = [];
  const seenGroups = new Set<string>();
  for (const count of [4, 3, 2, 1]) {
    const inGroup = sortedRanks
      .filter((r) => counts[r] === count)
      .filter((r) => {
        const key = `${count}-${r}`;
        if (seenGroups.has(key)) return false;
        seenGroups.add(key);
        return true;
      })
      .sort((a, b) => b - a);
    for (const r of inGroup) {
      groups.push(new Array(count).fill(r));
    }
  }
  const ordered = groups.flat().slice(0, 5);
  // Weighted: position 0 = most significant
  let score = 0;
  for (let i = 0; i < ordered.length; i++) {
    score += (ordered[i] ?? 0) * Math.pow(13, 4 - i);
  }
  return score;
}

// ── State helpers ────────────────────────────────────────────────────────────

function activePlayers(state: PokerState): Address[] {
  return state.players.filter((p) => !state.folded[p]);
}

function currentPlayer(state: PokerState): Address {
  const active = activePlayers(state);
  return active[state._actionIndex % active.length]!;
}

function allActed(state: PokerState): boolean {
  return activePlayers(state).every((p) => state.acted[p]);
}

function resetActed(state: PokerState): void {
  for (const p of state.players) {
    state.acted[p] = false;
  }
}

function communityCardsForPhase(phase: PokerState["phase"]): number {
  if (phase === "PRE_FLOP") return 0;
  if (phase === "FLOP") return 3;
  if (phase === "RIVER") return 5;
  return 5;
}

// ── initState ────────────────────────────────────────────────────────────────

function initState(players: Address[], opts?: Record<string, unknown>): PokerState {
  if (players.length < 2 || players.length > 3) {
    throw new Error("Poker requires 2 or 3 players");
  }
  const matchId = randomUUID();
  const stakeAsset = opts?.stakeAsset as "USDC" | "EURC" | undefined;
  const broker = opts?.broker as { address: Address; spreadFraction: number } | undefined;

  const deck = shuffleDeck(buildDeck(), `${matchId}:deal`);

  const holeCards: Record<Address, [string, string]> = {};
  let deckIdx = 0;
  for (const p of players) {
    holeCards[p] = [deck[deckIdx++]!, deck[deckIdx++]!];
  }
  const remainingDeck = deck.slice(deckIdx);

  const smallBlind = ENTRY_STAKE_EACH * 0.1;
  const bigBlind = ENTRY_STAKE_EACH * 0.2;

  const bets: Record<Address, number> = {};
  const acted: Record<Address, boolean> = {};
  const folded: Record<Address, boolean> = {};
  let pot = 0;

  for (const p of players) {
    bets[p] = 0;
    acted[p] = false;
    folded[p] = false;
  }

  // Post blinds: player[0] = small blind, player[1] = big blind
  const sbPlayer = players[0]!;
  const bbPlayer = players[1]!;
  bets[sbPlayer] = smallBlind;
  bets[bbPlayer] = bigBlind;
  pot = smallBlind + bigBlind;
  // Blinds have acted automatically; betting starts from player[2] or loops back
  acted[sbPlayer] = false; // SB still needs to act (call/raise/fold)
  acted[bbPlayer] = false; // BB still needs to act
  // First to act pre-flop is player index 2 (or 0 if only 2 players)
  const firstActionIndex = players.length >= 3 ? 2 : 0;

  return {
    matchId,
    players,
    entryStakeEach: ENTRY_STAKE_EACH,
    rakeFraction: RAKE_FRACTION,
    stakeAsset,
    broker,
    phase: "PRE_FLOP",
    deck: remainingDeck,
    holeCards,
    communityCards: [],
    pot,
    bets,
    folded,
    acted,
    _roundSeed: 0,
    _actionIndex: firstActionIndex,
  };
}

// ── getLegalMoves ────────────────────────────────────────────────────────────

function getLegalMoves(state: PokerState, player: Address): Array<PokerMove["type"]> {
  if (state.phase === "DONE" || state.phase === "SHOWDOWN") return [];
  if (state.folded[player]) return [];
  const active = activePlayers(state);
  if (active.length === 0) return [];
  const whose = currentPlayer(state);
  if (whose !== player) return [];
  return ["bet", "fold"];
}

// ── advanceBettingRound ──────────────────────────────────────────────────────

function advanceBettingRound(state: PokerState, events: EngineEvent[]): void {
  const active = activePlayers(state);
  if (active.length === 1) {
    // Everyone else folded — immediate winner
    state.winner = active[0]!;
    state.phase = "DONE";
    events.push({
      type: "MATCH_RESOLVED",
      matchId: state.matchId,
      payload: getResult(state),
      at: new Date().toISOString(),
    });
    return;
  }

  if (state.phase === "PRE_FLOP") {
    state.phase = "FLOP";
    // Deal 3 community cards
    state.communityCards = [state.deck[0]!, state.deck[1]!, state.deck[2]!];
    state.deck = state.deck.slice(3);
  } else if (state.phase === "FLOP") {
    state.phase = "RIVER";
    // Deal 2 more community cards
    state.communityCards = [...state.communityCards, state.deck[0]!, state.deck[1]!];
    state.deck = state.deck.slice(2);
  } else if (state.phase === "RIVER") {
    state.phase = "SHOWDOWN";
    doShowdown(state, events);
    return;
  }

  resetActed(state);
  state._actionIndex = 0;
  state._roundSeed++;

  events.push({
    type: "ROUND_DEALT",
    matchId: state.matchId,
    payload: {
      phase: state.phase,
      communityCards: state.communityCards,
    },
    at: new Date().toISOString(),
  });
}

// ── Showdown ─────────────────────────────────────────────────────────────────

function doShowdown(state: PokerState, events: EngineEvent[]): void {
  const active = activePlayers(state);
  const handRankings: Record<Address, number> = {};

  for (const p of active) {
    const allCards = [...state.holeCards[p]!, ...state.communityCards];
    handRankings[p] = evaluateHand(allCards);
  }

  state.handRankings = handRankings;

  let bestScore = -1;
  let winner: Address | undefined;
  for (const p of active) {
    if (handRankings[p]! > bestScore) {
      bestScore = handRankings[p]!;
      winner = p;
    }
  }

  state.winner = winner;
  state.phase = "DONE";

  events.push({
    type: "MATCH_RESOLVED",
    matchId: state.matchId,
    payload: getResult(state),
    at: new Date().toISOString(),
  });
}

// ── applyMove ────────────────────────────────────────────────────────────────

function applyMove(
  state: PokerState,
  player: Address,
  move: PokerMove,
): { state: PokerState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];

  if (state.phase === "DONE" || state.phase === "SHOWDOWN") {
    throw new Error("Match is already over");
  }
  if (state.folded[player]) {
    throw new Error("Player has already folded");
  }
  const whose = currentPlayer(state);
  if (whose !== player) {
    throw new Error(`It is ${whose}'s turn, not ${player}'s`);
  }

  if (move.type === "fold") {
    state.folded[player] = true;
    state.acted[player] = true;

    events.push({
      type: "CLAIM_MADE",
      matchId: state.matchId,
      payload: { player, action: "fold" },
      at: new Date().toISOString(),
    });

    const active = activePlayers(state);
    if (active.length <= 1) {
      advanceBettingRound(state, events);
    } else {
      state._actionIndex = (state._actionIndex + 1) % active.length;
      if (allActed(state)) {
        advanceBettingRound(state, events);
      }
    }
  } else if (move.type === "bet") {
    const amount = Math.max(0, move.amount);
    state.bets[player] = (state.bets[player] ?? 0) + amount;
    state.pot += amount;
    state.acted[player] = true;

    events.push({
      type: "OFFER_MADE",
      matchId: state.matchId,
      payload: { player, action: "bet", amount },
      at: new Date().toISOString(),
    });

    const active = activePlayers(state);
    state._actionIndex = (state._actionIndex + 1) % active.length;

    if (allActed(state)) {
      advanceBettingRound(state, events);
    }
  } else {
    throw new Error("unknown move type");
  }

  return { state, events };
}

// ── isTerminal ───────────────────────────────────────────────────────────────

function isTerminal(state: PokerState): boolean {
  return state.phase === "DONE";
}

// ── getResult ────────────────────────────────────────────────────────────────

function getResult(state: PokerState): MatchResult {
  const totalEscrow = state.entryStakeEach * state.players.length;
  const brokerSpread = state.broker?.spreadFraction ?? 0;
  const payouts: Record<Address, number> = {};

  for (const p of state.players) {
    payouts[p] = 0;
  }

  if (state.winner) {
    // Winner receives pot fraction of total escrow, net of rake and broker spread
    const potFraction = state.pot / totalEscrow;
    payouts[state.winner] =
      potFraction * (1 - state.rakeFraction) * (1 - brokerSpread);
  }

  return { payouts };
}

// ── Fog of war ───────────────────────────────────────────────────────────────

/**
 * Returns a copy of state with other players' hole cards hidden.
 * Spectators see ["??","??"] for each opponent.
 */
export function sanitizeForPlayer(state: PokerState, playerAddress: Address): PokerState {
  const sanitizedHoleCards: Record<Address, [string, string]> = {};
  for (const [addr, cards] of Object.entries(state.holeCards)) {
    sanitizedHoleCards[addr] = addr === playerAddress ? cards : ["??", "??"];
  }
  return { ...state, holeCards: sanitizedHoleCards };
}

// ── Export ───────────────────────────────────────────────────────────────────

export { manifest };

export const poker: GameEngine<PokerState, PokerMove, MatchResult> = {
  manifest,
  initState,
  getLegalMoves,
  applyMove,
  isTerminal,
  getResult,
};
