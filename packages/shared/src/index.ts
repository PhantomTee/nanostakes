import { encodePacked, keccak256 } from "viem";

export type Address = string;

export type Temperament = "STRATEGIC" | "COMPETITIVE" | "COOPERATIVE" | "NEUTRAL";

export const TEMPERAMENT_PRIMERS: Record<Temperament, string> = {
  STRATEGIC:
    "You play for long-run advantage. Information is the most valuable currency at this table. " +
    "Build trust early while it is cheap, then calculate the expected return of every relationship " +
    "before deciding whether to honor or break it.",
  COMPETITIVE:
    "Every dollar another agent holds is a dollar you don't. Trust has a price, and you will pay it " +
    "only when the math clearly favors you. Treat every round as a contest to be won, not shared.",
  COOPERATIVE:
    "Your reputation is your most valuable asset. Honor commitments you make, even when it costs you " +
    "in a single round, because counterparties remember and reciprocate over time.",
  NEUTRAL: "Play the game in good faith, round by round, with no particular long-term agenda.",
};

/** Round-1..N phases of a single Brinkmanship round. */
export type RoundPhase = "NEGOTIATE" | "OFFER" | "BRIBE" | "REVEAL" | "DONE";

export interface ChatMessage {
  from: Address;
  to: Address;
  text: string;
  round: number;
}

export interface ClaimMove {
  type: "claim";
  value: number; // claimed valuation, 0..1 fraction of round pot
  /** keccak256(value, nonce) — optional; if present, engine validates the commitment matches (value, nonce) before accepting the move. */
  commitment?: string;
  nonce?: string;
}

export interface MessageMove {
  type: "message";
  to: Address;
  text: string;
}

export interface OfferMove {
  type: "offer";
  ask: number; // fraction of round pot this player is asking for, 0..1
  escalate?: boolean;
  /**
   * Optional cryptographic commitment (see computeOfferCommitment below) the
   * client computed over (ask, escalate, nonce) before submitting this same
   * move. Lets a spectator prove an offer was fixed in advance — not just
   * trust the server's word that it was sealed — once `nonce` is also
   * revealed at round resolution. Omit for callers that don't need this
   * (e.g. the manual phase-1 scripts).
   */
  commitment?: string;
  nonce?: string;
}

export interface BribeMove {
  type: "bribe";
  targetPlayer: Address;
  amount: number; // USDC amount to transfer to opponent; must be > 0
  message: string; // LLM-generated explanation / persuasion text
}

export type Move = ClaimMove | MessageMove | OfferMove | BribeMove;

export interface RoundState {
  index: number; // 1-based
  basePot: number; // USDC notional value of this round, before escalation
  cap: number; // max pot this round can escalate to
  privateValuation: Record<Address, number>; // hidden, 0..1, known only to that player
  claims: Record<Address, number>;
  offers: Record<Address, number>;
  escalated: Record<Address, boolean>;
  messages: ChatMessage[];
  resolved: boolean;
  payoutFraction?: Record<Address, number>; // each player's share of *this round's* pot
  /** keccak256 commitment of (ask, escalate, nonce) — safe to reveal even while the offer itself is sealed; proves it was fixed in advance. */
  offerCommitments: Record<Address, string>;
  /** Revealed only once the round resolves; combined with `offers`/`escalated`, lets anyone independently re-derive and check the commitment above. */
  offerNonces: Record<Address, string>;
  /** Optional commit-reveal for claim moves — mirrors offerCommitments pattern. Absent on rounds dealt before this feature shipped. */
  claimCommitments?: Record<Address, string>;
  /** Revealed alongside the claim; lets anyone verify the claim value was fixed before the offer phase. */
  claimNonces?: Record<Address, string>;
  /** Bribe offers submitted during the BRIBE phase. Key is the bribing player's address. Absent on rounds from before the BRIBE phase was added. */
  bribeOffers?: Record<Address, { amount: number; message: string; accepted?: boolean }>;
}

export interface MatchState {
  matchId: string;
  players: Address[]; // exactly 2 for v1
  entryStakeEach: number; // USDC each player escrowed to enter
  rakeFraction: number; // Warden's cut of the settled pot
  rounds: RoundState[];
  currentRoundIndex: number; // 0-based into rounds[]
  phase: RoundPhase;
  acted: Record<Address, boolean>; // who has acted in the current phase/round
  /** The asset used for stakes and payouts. Defaults to "USDC" when absent (all existing matches remain valid). */
  stakeAsset?: "USDC" | "EURC";
  /** Optional broker seat — a third-party intermediary that takes a spread on top of the game's own rake. */
  broker?: BrokerSeat;
}

export interface MatchResult {
  /** Fraction of the total escrowed pot (entryStakeEach * players.length) owed to each player, net of rake. */
  payouts: Record<Address, number>;
}

export interface EngineEvent {
  type:
    | "ROUND_DEALT"
    | "MESSAGE_SENT"
    | "CLAIM_MADE"
    | "OFFER_MADE"
    | "ROUND_RESOLVED"
    | "MATCH_RESOLVED";
  matchId: string;
  round?: number;
  payload: unknown;
  at: string; // ISO timestamp
}

/** Manifest + pure-function engine interface every Bracket game must implement. */
export interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface GameEngine<TState = MatchState, TMove extends { type: string } = Move, TResult = MatchResult> {
  manifest: GameManifest;
  initState(players: Address[], opts?: Record<string, unknown>): TState;
  getLegalMoves(state: TState, player: Address): Array<TMove["type"]>;
  applyMove(state: TState, player: Address, move: TMove): { state: TState; events: EngineEvent[] };
  isTerminal(state: TState): boolean;
  getResult(state: TState): TResult;
}

/**
 * Phase 2 decision: the Broker (a 3rd-party intermediary that could route
 * stakes across multiple simultaneous matches, take a spread, or arbitrage
 * settlement timing) is deferred — no implementation yet — but every game's
 * `GameManifest.maxPlayers` already allows for a Broker to occupy an extra
 * seat without reshaping the engine interface, and matchmaking already
 * pairs players generically off `minPlayers`/`maxPlayers` rather than
 * assuming exactly 2. This type documents the seat a future Broker would
 * fill; nothing constructs it yet.
 */
export interface BrokerSeat {
  address: Address;
  /** Fraction of the settled pot the Broker takes, on top of the game's own rake. */
  spreadFraction: number;
}

export const ARC_TESTNET = {
  chainId: 5042002,
  usdcAddress: "0x3600000000000000000000000000000000000000",
  gatewayWalletAddress: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  gatewayFacilitatorUrl: "https://gateway-api-testnet.circle.com",
} as const;

/** Fraction (0..1) is fixed to this many decimal places before hashing, so the same `ask` always commits to the same hash regardless of float formatting. */
const COMMITMENT_SCALE = 1_000_000;

/**
 * keccak256 commitment over a sealed Brinkmanship offer, used by both the
 * client (driver.ts, computing it before submitting) and anyone verifying a
 * reveal later (the engine on submission, Concourse in the browser once the
 * round resolves). Same inputs always produce the same hash, so a third
 * party can independently confirm `value + nonce` actually produces the
 * commitment that was visible before the reveal — they don't have to trust
 * the Warden's word for it.
 */
export function computeOfferCommitment(ask: number, escalate: boolean, nonce: string): string {
  const askScaled = BigInt(Math.round(ask * COMMITMENT_SCALE));
  return keccak256(
    encodePacked(["uint256", "bool", "bytes32"], [askScaled, escalate, nonce as `0x${string}`]),
  );
}

/**
 * keccak256 commitment over a sealed Brinkmanship claim, parallel to
 * computeOfferCommitment. Lets a player commit to their valuation claim
 * before the offer phase and prove it was fixed in advance at reveal time.
 */
export function computeClaimCommitment(value: number, nonce: string): string {
  const valueScaled = BigInt(Math.round(value * COMMITMENT_SCALE));
  return keccak256(encodePacked(["uint256", "bytes32"], [valueScaled, nonce as `0x${string}`]));
}
