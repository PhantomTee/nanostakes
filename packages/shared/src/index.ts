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
export type RoundPhase = "NEGOTIATE" | "OFFER" | "REVEAL" | "DONE";

export interface ChatMessage {
  from: Address;
  to: Address;
  text: string;
  round: number;
}

export interface ClaimMove {
  type: "claim";
  value: number; // claimed valuation, 0..1 fraction of round pot
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
}

export type Move = ClaimMove | MessageMove | OfferMove;

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
