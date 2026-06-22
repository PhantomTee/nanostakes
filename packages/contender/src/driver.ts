import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import type { Temperament } from "@nanostakes/shared";
import { TemperamentAgent, type AgentProviders } from "./agent.js";
import { shouldAcceptChallenge, type OpponentRecord } from "./challengePolicy.js";

export interface DriveAgentOptions {
  wardenUrl: string;
  privateKey: Hex;
  temperament: Temperament;
  name?: string;
  /** Only Brinkmanship is supported by the autonomous driver today. */
  gameId?: string;
  providers: AgentProviders;
  /** Checked between steps; the loop exits cleanly the next time it's true. */
  isStopped?: () => boolean;
  onEvent?: (message: string) => void;
}

const DEFAULT_GAME_ID = "brinkmanship";
const POLL_INTERVAL_MS = 1000;

function opponentOf(state: { players: string[] }, me: string): string {
  const opp = state.players.find((p) => p !== me);
  if (!opp) throw new Error("match has no opponent for this player");
  return opp;
}

function buildHistory(state: any, me: string) {
  return state.rounds
    .filter((r: any) => r.resolved)
    .map((r: any) => ({
      round: r.index,
      myAsk: r.offers[me],
      oppAsk: r.offers[opponentOf(state, me)],
      myReceived: r.payoutFraction?.[me],
    }));
}

async function getState(wardenUrl: string, matchId: string, as: string) {
  const res = await fetch(`${wardenUrl}/match/${matchId}/state?as=${as}`);
  if (!res.ok) throw new Error(`getState failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

async function postMove(wardenUrl: string, matchId: string, player: string, move: unknown) {
  const res = await fetch(`${wardenUrl}/match/${matchId}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player, move }),
  });
  if (!res.ok) throw new Error(`postMove failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STAKE_RETRY_ATTEMPTS = 24;
const STAKE_RETRY_DELAY_MS = 5000;

/**
 * Two distinct reasons staking can fail, confirmed by intercepting the raw
 * Warden response (the SDK's thrown error discards the `reason` field):
 *
 * 1. Genuinely insufficient balance (a prior match was lost and the
 *    remainder is below the next entry stake). Caught by the pre-check
 *    below before ever attempting payment — retrying never helps this,
 *    it just delays an inevitable failure. Fail fast instead, with a
 *    message that says what actually happened.
 * 2. `reason: "insufficient_balance"` from Circle's facilitator *despite*
 *    on-chain balance being confirmed sufficient by the pre-check. This
 *    happens right after a fresh `/fund` deposit: `getBalances()` reads
 *    the GatewayWallet contract directly (instant), but the facilitator
 *    checks its own off-chain ledger index, which lags behind a deposit
 *    that just landed on-chain. Worth a real retry budget here — this is
 *    the case the original (mis-targeted) 120s retry was meant for, just
 *    pointed at the wrong condition.
 */
async function payStakeWithRetry(
  client: GatewayClient,
  url: string,
  entryStakeEach: number,
  log: (m: string) => void,
): Promise<Awaited<ReturnType<GatewayClient["pay"]>>> {
  const balances = await client.getBalances();
  const available = Number(balances.gateway.formattedAvailable);
  if (available < entryStakeEach) {
    throw new Error(
      `Insufficient balance to stake: have ${available.toFixed(6)} USDC available, need ${entryStakeEach} USDC. Fund the session wallet to resume.`,
    );
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= STAKE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await client.pay(url, { method: "POST" });
    } catch (err) {
      lastErr = err;
      if (attempt < STAKE_RETRY_ATTEMPTS) {
        log(
          `stake payment attempt ${attempt}/${STAKE_RETRY_ATTEMPTS} failed (${(err as Error).message}) despite sufficient balance — retrying in ${STAKE_RETRY_DELAY_MS / 1000}s`,
        );
        await sleep(STAKE_RETRY_DELAY_MS);
      }
    }
  }
  throw lastErr;
}

/**
 * Checks for incoming challenges and decides each one by temperament policy
 * (see challengePolicy.ts) — no LLM call, so this never stalls and is free
 * to run on every poll tick. Declines or accepts every pending challenge it
 * sees; accepting hands the matchId to both sides via the Warden's existing
 * queue-assignment channel, so the normal queue.join/poll loop picks it up.
 */
async function resolveIncomingChallenges(wardenUrl: string, me: string, temperament: Temperament, log: (m: string) => void): Promise<void> {
  const res = await fetch(`${wardenUrl}/challenges?player=${me}`);
  if (!res.ok) return;
  const { incoming } = (await res.json()) as { incoming: Array<{ id: string; from: string; fromRecord: OpponentRecord }> };

  for (const challenge of incoming) {
    const accept = shouldAcceptChallenge(temperament, challenge.fromRecord);
    await fetch(`${wardenUrl}/challenges/${challenge.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ responder: me, accept }),
    });
    log(`${accept ? "accepted" : "declined"} challenge from ${challenge.from}`);
  }
}

/** Plays one already-staked, already-assigned match to completion, acting only on this agent's own turns. */
async function playMatch(
  opts: DriveAgentOptions,
  client: GatewayClient,
  agent: TemperamentAgent,
  matchId: string,
): Promise<void> {
  const { wardenUrl, isStopped, onEvent } = opts;
  const me = client.address;
  const log = onEvent ?? (() => {});

  const preStakeState = await getState(wardenUrl, matchId, me);
  const stakePayment = await payStakeWithRetry(
    client,
    `${wardenUrl}/match/${matchId}/stake`,
    preStakeState.entryStakeEach,
    log,
  );
  log(`${agent.name} staked entry for match ${matchId} (${stakePayment.transaction})`);

  while (!isStopped?.()) {
    const state = await getState(wardenUrl, matchId, me);
    if (state.status === "SETTLED") {
      log(`${agent.name} match ${matchId} settled`);
      return;
    }
    if (state.status !== "ACTIVE") {
      // Still AWAITING_STAKES: this player staked already but the opponent
      // hasn't yet, so there's nothing to act on — posting a move now would
      // 409 ("match is not active"). Wait for the opponent's stake to land.
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    if (state.acted[me]) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const round = state.rounds?.[state.currentRoundIndex];
    if (!round) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (state.phase === "NEGOTIATE") {
      const incoming = round.messages.filter((m: any) => m.to === me);
      const decision = await agent.decideNegotiate({
        round: round.index,
        myValuation: round.myValuation,
        incomingMessages: incoming.map((m: any) => ({ from: m.from, text: m.text })),
        history: buildHistory(state, me),
      });
      if (decision.message) {
        await postMove(wardenUrl, matchId, me, { type: "message", to: opponentOf(state, me), text: decision.message });
      }
      await postMove(wardenUrl, matchId, me, { type: "claim", value: decision.claim });
      log(`${agent.name} claims ${decision.claim.toFixed(2)} in round ${round.index}`);
    } else if (state.phase === "OFFER") {
      const opp = opponentOf(state, me);
      const decision = await agent.decideOffer({
        round: round.index,
        myValuation: round.myValuation,
        myClaim: round.claims[me],
        opponentClaim: round.claims[opp] ?? null,
        cap: round.cap,
        basePot: round.basePot,
      });
      const result = await postMove(wardenUrl, matchId, me, {
        type: "offer",
        ask: decision.ask,
        escalate: decision.escalate,
      });
      log(`${agent.name} offers ${decision.ask.toFixed(2)}${decision.escalate ? " (escalate)" : ""} in round ${round.index}`);
      if (result.settled) {
        log(`${agent.name} match ${matchId} settled`);
        return;
      }
    } else {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/**
 * Drives one agent indefinitely: joins the matchmaking queue, plays whatever
 * match it gets paired into to completion, then rejoins the queue. Runs
 * until `opts.isStopped()` returns true. Intended to be one of N concurrent
 * drivers inside the Warden's multi-tenant runtime, one per active agent.
 */
export async function driveAgentForever(opts: DriveAgentOptions): Promise<void> {
  const { wardenUrl, gameId = DEFAULT_GAME_ID, isStopped, onEvent } = opts;
  const log = onEvent ?? (() => {});
  const client = new GatewayClient({ chain: "arcTestnet", privateKey: opts.privateKey });
  const agent = new TemperamentAgent(opts.name ?? client.address, opts.temperament, opts.providers);

  while (!isStopped?.()) {
    const join = await fetch(`${wardenUrl}/queue/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gameId, player: client.address, temperament: opts.temperament }),
    });
    if (!join.ok) throw new Error(`queue/join failed: ${join.status} ${await join.text()}`);
    let { matchId } = (await join.json()) as { matchId?: string };

    while (!matchId && !isStopped?.()) {
      await sleep(POLL_INTERVAL_MS * 2);
      await resolveIncomingChallenges(wardenUrl, client.address, opts.temperament, log);
      const poll = await fetch(`${wardenUrl}/queue/poll?player=${client.address}`);
      if (!poll.ok) throw new Error(`queue/poll failed: ${poll.status} ${await poll.text()}`);
      ({ matchId } = (await poll.json()) as { matchId?: string });
    }
    if (!matchId) return; // stopped while waiting

    log(`${agent.name} matched into ${matchId}`);
    await playMatch(opts, client, agent, matchId);
  }
}
