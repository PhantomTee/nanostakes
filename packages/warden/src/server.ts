import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { ENTRY_STAKE_EACH, getGame } from "@nanostakes/bracket";
import { gateway, wardenAccount } from "./gateway.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMatch, getMatch, allMatches, sanitizeForPlayer, sanitizeForSpectator, type MatchRecord } from "./state.js";
import { settleMatch } from "./settle.js";
import { getLeaderboard, getTemperamentStats, getAgentRecord } from "./ledger.js";
import { joinQueue, pollAssignment, queueStatus } from "./matchmaking.js";
import { emitConcourseEvent, subscribeConcourse } from "./events.js";
import type { Temperament } from "@nanostakes/shared";

interface PaidRequest extends Request {
  payment?: { verified: boolean; payer: string; amount: string; network: string; transaction?: string };
}

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "../public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, warden: wardenAccount.address });
});

/** Create a new match. No payment required — payment happens at /stake. */
app.post("/match", (req: Request, res: Response) => {
  const { gameId, players, temperaments } = req.body as {
    gameId: string;
    players: string[];
    temperaments?: Record<string, Temperament>;
  };
  try {
    const record = createMatch(gameId, players, temperaments ? { temperaments } : undefined);
    emitConcourseEvent({
      type: "match.created",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { players: record.state.players, temperaments: record.meta?.temperaments },
    });
    res.json({ matchId: record.state.matchId, entryStakeEach: ENTRY_STAKE_EACH });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * Matchmaking queue: a player joins for a given game (optionally tagging
 * their temperament for the ledger) and is paired automatically as soon as
 * enough players are waiting — no caller needs to know who their opponent
 * will be ahead of time.
 */
app.post("/queue/join", (req: Request, res: Response) => {
  const { gameId, player, temperament } = req.body as { gameId: string; player: string; temperament?: Temperament };
  try {
    const result = joinQueue(gameId, player, temperament);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Poll for a match assignment after joining the queue with no immediate match. */
app.get("/queue/poll", (req: Request, res: Response) => {
  const player = req.query.player as string | undefined;
  if (!player) {
    res.status(400).json({ error: "?player=<address> is required" });
    return;
  }
  res.json(pollAssignment(player));
});

app.get("/queue/:gameId/status", (req: Request, res: Response) => {
  res.json(queueStatus(req.params.gameId));
});

/** Reputation ledger: cumulative wins/losses/PnL per agent across all settled matches. */
app.get("/ledger", (_req: Request, res: Response) => {
  res.json({ leaderboard: getLeaderboard(), byTemperament: getTemperamentStats() });
});

/**
 * Pay the entry stake. Gated by Circle's x402 Gateway middleware — the
 * caller's request is challenged with a 402 until a valid Gateway payment
 * for ENTRY_STAKE_EACH lands in the Warden's own Gateway balance.
 */
app.post(
  "/match/:id/stake",
  gateway.require(`$${ENTRY_STAKE_EACH.toFixed(2)}`),
  (req: PaidRequest, res: Response) => {
    const record = getMatch(req.params.id);
    const rawPayer = req.payment?.payer;
    const payer = rawPayer
      ? record.state.players.find((p) => p.toLowerCase() === rawPayer.toLowerCase())
      : undefined;
    if (!payer) {
      res.status(400).json({ error: "payer is not a registered player in this match" });
      return;
    }
    record.staked[payer] = true;
    if (req.payment?.transaction) {
      record.stakeTxs = { ...(record.stakeTxs ?? {}), [payer]: req.payment.transaction };
    }
    if (record.state.players.every((p) => record.staked[p])) {
      record.status = "ACTIVE";
    }
    emitConcourseEvent({
      type: "match.staked",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { payer, transaction: req.payment?.transaction, status: record.status },
    });
    res.json({ staked: record.staked, status: record.status, transaction: req.payment?.transaction });
  },
);

app.get("/match/:id/state", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  const viewer = req.query.as as string | undefined;
  if (!viewer) {
    res.status(400).json({ error: "?as=<playerAddress> is required" });
    return;
  }
  res.json(sanitizeForPlayer(record, viewer));
});

/** Public spectator view — no hidden valuations or sealed offers for either player. */
app.get("/match/:id/public", (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  const badges = Object.fromEntries(
    record.state.players.map((p) => {
      const ledgerRec = getAgentRecord(p);
      return [p, { temperament: record.meta?.temperaments?.[p] ?? ledgerRec.temperament, standing: ledgerRec.standing }];
    }),
  );
  res.json({ ...(sanitizeForSpectator(record) as object), badges });
});

/** List known matches (most recent first) so the spectator page can find one without a matchId. */
app.get("/matches", (_req: Request, res: Response) => {
  res.json(
    allMatches()
      .map((r) => ({ matchId: r.state.matchId, status: r.status, players: r.state.players }))
      .reverse(),
  );
});

app.post("/match/:id/move", async (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  if (record.status !== "ACTIVE") {
    res.status(409).json({ error: `match is not active (status: ${record.status})` });
    return;
  }
  const { player, move } = req.body as { player: string; move: unknown };
  const game = getGame(record.gameId);
  try {
    const { state, events } = game.applyMove(record.state, player, move as never);
    record.state = state as MatchRecord["state"];
    record.events.push(...events);

    emitConcourseEvent({
      type: "match.move",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { player, move, events },
    });

    let payoutTxs: Record<string, string> | undefined;
    if (game.isTerminal(record.state)) {
      payoutTxs = await settleMatch(record);
      emitConcourseEvent({
        type: "match.settled",
        matchId: record.state.matchId,
        gameId: record.gameId,
        at: Date.now(),
        data: { payoutTxs },
      });
    }

    res.json({
      state: sanitizeForPlayer(record, player),
      events,
      ...(payoutTxs ? { settled: true, payoutTxs } : {}),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

/** Retry settlement for a match whose engine state is terminal but whose payout never landed (e.g. Gateway batch settlement was still in flight). Safe to call repeatedly. */
app.post("/match/:id/settle", async (req: Request, res: Response) => {
  const record = getMatch(req.params.id);
  const game = getGame(record.gameId);
  if (!game.isTerminal(record.state)) {
    res.status(409).json({ error: "match is not terminal yet" });
    return;
  }
  try {
    const payoutTxs = await settleMatch(record);
    emitConcourseEvent({
      type: "match.settled",
      matchId: record.state.matchId,
      gameId: record.gameId,
      at: Date.now(),
      data: { payoutTxs },
    });
    res.json({ settled: true, payoutTxs });
  } catch (err) {
    res.status(503).json({ error: (err as Error).message });
  }
});

/**
 * Concourse live event feed (SSE). Pushes match.created / match.staked /
 * match.move / match.settled as they happen — the spectator dashboard uses
 * this instead of polling for the event log (it still polls /match/:id/public
 * and /ledger for full state snapshots, since SSE only carries deltas).
 */
app.get("/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(":ok\n\n");

  const unsubscribe = subscribeConcourse((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  req.on("close", unsubscribe);
});

const port = Number(process.env.WARDEN_PORT ?? 4000);
app.listen(port, () => {
  console.log(`Warden listening on :${port} (address ${wardenAccount.address})`);
});
