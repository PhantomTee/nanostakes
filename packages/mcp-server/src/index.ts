#!/usr/bin/env node
/**
 * MCP-compatible interface onto the Warden's REST API — lets any
 * MCP-aware agent framework (Claude Desktop, other MCP clients) play
 * Nanostakes Arena matches as a Contender without speaking the Warden's
 * bespoke HTTP API directly. Pure proxy: every tool call is a single
 * fetch against WARDEN_URL, no game logic lives here.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const WARDEN_URL = process.env.WARDEN_URL ?? "http://localhost:4000";

async function wardenFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${WARDEN_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Warden ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: "nanostakes-arena", version: "0.1.0" });

server.registerTool(
  "list_matches",
  {
    description: "List known Nanostakes Arena matches (most recent first), with status and players.",
    inputSchema: {},
  },
  async () => textResult(await wardenFetch("/matches")),
);

server.registerTool(
  "create_match",
  {
    description:
      "Create a new match for a given Bracket game (e.g. 'brinkmanship', 'standoff'). Does not stake — staking requires each player's own x402 GatewayClient (signing with their private key), which this server intentionally does not hold; pay POST /match/:id/stake on the Warden directly from the player's own wallet client.",
    inputSchema: {
      gameId: z.string(),
      players: z.array(z.string()).describe("Player wallet addresses, count must satisfy the game's manifest min/maxPlayers."),
      temperaments: z.record(z.string()).optional().describe("Optional address -> temperament tag, recorded on the ledger."),
    },
  },
  async ({ gameId, players, temperaments }) =>
    textResult(
      await wardenFetch("/match", {
        method: "POST",
        body: JSON.stringify({ gameId, players, temperaments }),
      }),
    ),
);

server.registerTool(
  "join_queue",
  {
    description:
      "Join the matchmaking queue for a game. Returns {matchId} immediately if this join completed a full table, otherwise {} — call poll_queue to find out when paired.",
    inputSchema: {
      gameId: z.string(),
      player: z.string(),
      temperament: z.string().optional(),
    },
  },
  async ({ gameId, player, temperament }) =>
    textResult(await wardenFetch("/queue/join", { method: "POST", body: JSON.stringify({ gameId, player, temperament }) })),
);

server.registerTool(
  "poll_queue",
  {
    description: "Check whether a queued player has been assigned a match yet.",
    inputSchema: { player: z.string() },
  },
  async ({ player }) => textResult(await wardenFetch(`/queue/poll?player=${encodeURIComponent(player)}`)),
);

server.registerTool(
  "get_match_state",
  {
    description: "Get the player's-eye view of a match (own valuations/choices visible, opponent's hidden until resolved).",
    inputSchema: { matchId: z.string(), as: z.string().describe("The requesting player's address.") },
  },
  async ({ matchId, as }) => textResult(await wardenFetch(`/match/${matchId}/state?as=${encodeURIComponent(as)}`)),
);

server.registerTool(
  "get_public_match",
  {
    description: "Get the spectator view of a match, including Temperament/Standing badges. No hidden information.",
    inputSchema: { matchId: z.string() },
  },
  async ({ matchId }) => textResult(await wardenFetch(`/match/${matchId}/public`)),
);

server.registerTool(
  "submit_move",
  {
    description:
      "Submit a move for a player in an active match. The move shape depends on the game (e.g. brinkmanship: {type:'claim'|'offer'|'message', ...}; standoff: {type:'choice', value:'COOPERATE'|'DEFECT'}).",
    inputSchema: { matchId: z.string(), player: z.string(), move: z.record(z.unknown()) },
  },
  async ({ matchId, player, move }) =>
    textResult(await wardenFetch(`/match/${matchId}/move`, { method: "POST", body: JSON.stringify({ player, move }) })),
);

server.registerTool(
  "get_ledger",
  {
    description: "Get the cross-match reputation leaderboard and per-temperament aggregate stats.",
    inputSchema: {},
  },
  async () => textResult(await wardenFetch("/ledger")),
);

const transport = new StdioServerTransport();
await server.connect(transport);
