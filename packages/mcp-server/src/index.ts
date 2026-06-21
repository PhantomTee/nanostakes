#!/usr/bin/env node
/**
 * MCP-compatible interface onto the Warden's REST API — lets any
 * MCP-aware agent framework (Claude Desktop, other MCP clients) play
 * Nanostakes Arena matches as a Contender without speaking the Warden's
 * bespoke HTTP API directly. Pure proxy: every tool call is a single
 * fetch against WARDEN_URL, no game logic lives here.
 *
 * Read-only tools (list_matches, get_match_state, get_public_match,
 * get_ledger) hit the Warden's metered /mcp/* routes and are paid for
 * automatically via Circle Gateway — sub-cent x402 nanopayments, settled
 * agent-to-agent, requiring MCP_AGENT_PRIVATE_KEY to be set and funded.
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";
import { z } from "zod";

const WARDEN_URL = process.env.WARDEN_URL ?? "http://localhost:4000";

/**
 * The /mcp/* routes on the Warden are metered: each call costs a sub-cent
 * x402 nanopayment via Circle Gateway (see packages/warden/src/server.ts).
 * Set MCP_AGENT_PRIVATE_KEY so this server can autonomously pay for them —
 * without it, those tools fall back to an unpaid 402 error.
 */
const agentPrivateKey = process.env.MCP_AGENT_PRIVATE_KEY as Hex | undefined;
const payingClient = agentPrivateKey ? new GatewayClient({ chain: "arcTestnet", privateKey: agentPrivateKey }) : undefined;

async function wardenFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${WARDEN_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Warden ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

/** Pays for one of the metered /mcp/* read routes. Requires MCP_AGENT_PRIVATE_KEY to be funded on Arc Testnet. */
async function paidWardenFetch(path: string): Promise<unknown> {
  if (!payingClient) {
    throw new Error(
      `${path} is a metered route — set MCP_AGENT_PRIVATE_KEY (a funded Arc Testnet wallet) to enable autonomous nanopayments`,
    );
  }
  const { data } = await payingClient.pay(`${WARDEN_URL}${path}`);
  return data;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({ name: "nanostakes-arena", version: "0.1.0" });

server.registerTool(
  "list_matches",
  {
    description:
      "List known Nanostakes Arena matches (most recent first), with status and players. Metered: costs $0.000001 per call via Circle Gateway, paid automatically from MCP_AGENT_PRIVATE_KEY.",
    inputSchema: {},
  },
  async () => textResult(await paidWardenFetch("/mcp/matches")),
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
    description:
      "Get the player's-eye view of a match (own valuations/choices visible, opponent's hidden until resolved). Metered: costs $0.00001 per call via Circle Gateway, paid automatically from MCP_AGENT_PRIVATE_KEY.",
    inputSchema: { matchId: z.string(), as: z.string().describe("The requesting player's address.") },
  },
  async ({ matchId, as }) => textResult(await paidWardenFetch(`/mcp/match/${matchId}/state?as=${encodeURIComponent(as)}`)),
);

server.registerTool(
  "get_public_match",
  {
    description:
      "Get the spectator view of a match, including Temperament/Standing badges. No hidden information. Metered: costs $0.00001 per call via Circle Gateway, paid automatically from MCP_AGENT_PRIVATE_KEY.",
    inputSchema: { matchId: z.string() },
  },
  async ({ matchId }) => textResult(await paidWardenFetch(`/mcp/match/${matchId}/public`)),
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
    description:
      "Get the cross-match reputation leaderboard and per-temperament aggregate stats. Metered: costs $0.000001 per call via Circle Gateway, paid automatically from MCP_AGENT_PRIVATE_KEY.",
    inputSchema: {},
  },
  async () => textResult(await paidWardenFetch("/mcp/ledger")),
);

const transport = new StdioServerTransport();
await server.connect(transport);
