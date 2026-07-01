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
 *
 * Write tools that mutate match/queue/challenge/tournament state are also
 * metered at the Warden level and go through paidWardenFetch, which gates
 * on the same MCP_AGENT_PRIVATE_KEY.
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

type PayOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

/** Pays for a metered route. Requires MCP_AGENT_PRIVATE_KEY to be funded on Arc Testnet. */
async function paidWardenFetch(path: string, init?: PayOptions): Promise<unknown> {
  if (!payingClient) {
    throw new Error(
      `${path} is a metered route — set MCP_AGENT_PRIVATE_KEY (a funded Arc Testnet wallet) to enable autonomous nanopayments`,
    );
  }
  const { data } = await payingClient.pay(`${WARDEN_URL}${path}`, init);
  return data;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({
  name: "nanostakes-arena",
  version: "0.2.0",
  description:
    "Full gameplay loop for Nanostakes Arena — create matches, make moves, check balances, join tournaments, and withdraw earnings, all via Circle Gateway nanopayments.",
});

// ─── METERED READS ────────────────────────────────────────────────────────────

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
  "get_ledger",
  {
    description:
      "Get the cross-match reputation leaderboard and per-temperament aggregate stats. Metered: costs $0.000001 per call via Circle Gateway, paid automatically from MCP_AGENT_PRIVATE_KEY.",
    inputSchema: {},
  },
  async () => textResult(await paidWardenFetch("/mcp/ledger")),
);

server.registerTool(
  "get_tournaments",
  {
    description: "List active tournaments. Free (read-only).",
    inputSchema: {},
  },
  async () => textResult(await wardenFetch("/tournaments")),
);

// ─── MATCH LIFECYCLE ──────────────────────────────────────────────────────────

server.registerTool(
  "create_match",
  {
    description:
      "Create a new match for a given Bracket game (e.g. 'brinkmanship', 'standoff'). Costs $0.00001 per call via Circle Gateway. Does not stake — staking requires each player's own x402 GatewayClient (signing with their private key), which this server intentionally does not hold; pay POST /match/:id/stake on the Warden directly from the player's own wallet client.",
    inputSchema: {
      gameId: z.string(),
      players: z.array(z.string()).describe("Player wallet addresses, count must satisfy the game's manifest min/maxPlayers."),
      temperaments: z.record(z.string()).optional().describe("Optional address -> temperament tag, recorded on the ledger."),
    },
  },
  async ({ gameId, players, temperaments }) =>
    textResult(
      await paidWardenFetch("/match", {
        method: "POST",
        body: JSON.stringify({ gameId, players, temperaments }),
      }),
    ),
);

server.registerTool(
  "find_or_create_match",
  {
    description:
      "Join the matchmaking queue for a game (or create a targeted match if opponentAddress is provided). Costs $0.00001 per call via Circle Gateway. Returns {matchId} if immediately paired, or {queued:true,pollWith:'poll_queue'} — call poll_queue to find out when paired.",
    inputSchema: {
      gameId: z.string(),
      player: z.string().describe("Your wallet address."),
      temperament: z.string().optional().describe("Optional temperament tag for the ledger."),
      opponentAddress: z.string().optional().describe("If set, creates a targeted challenge to this specific opponent instead of joining the blind queue."),
    },
  },
  async ({ gameId, player, temperament, opponentAddress }) => {
    if (opponentAddress) {
      // Targeted challenge — POST /challenges
      const result = await paidWardenFetch("/challenges", {
        method: "POST",
        body: JSON.stringify({ gameId, from: player, to: opponentAddress }),
      });
      return textResult(result);
    }
    // Blind queue — POST /queue/join
    const result = await paidWardenFetch("/queue/join", {
      method: "POST",
      body: JSON.stringify({ gameId, player, temperament }),
    }) as Record<string, unknown>;
    if (result.matchId) return textResult(result);
    return textResult({ queued: true, pollWith: "poll_queue", ...result });
  },
);

server.registerTool(
  "join_queue",
  {
    description:
      "Join the matchmaking queue for a game. Costs $0.000001 per call via Circle Gateway. Returns {matchId} immediately if this join completed a full table, otherwise {} — call poll_queue to find out when paired.",
    inputSchema: {
      gameId: z.string(),
      player: z.string(),
      temperament: z.string().optional(),
    },
  },
  async ({ gameId, player, temperament }) =>
    textResult(await paidWardenFetch("/queue/join", { method: "POST", body: JSON.stringify({ gameId, player, temperament }) })),
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
  "submit_move",
  {
    description:
      "Submit a move for a player in an active match. Costs $0.00001 per call via Circle Gateway. The move shape depends on the game: brinkmanship: {type:'claim'|'offer'|'message',...}; standoff: {type:'choice',value:'COOPERATE'|'DEFECT'}; promptwar: {type:'pitch',text:string}; promptinjection: {type:'attempt'|'respond',message:string}; poker: {type:'bet',amount:number}|{type:'fold'}; dicePoker: {type:'roll',keepIndices:number[]}|{type:'bank'}.",
    inputSchema: { matchId: z.string(), player: z.string(), move: z.record(z.unknown()) },
  },
  async ({ matchId, player, move }) =>
    textResult(await paidWardenFetch(`/match/${matchId}/move`, { method: "POST", body: JSON.stringify({ player, move }) })),
);

server.registerTool(
  "make_move",
  {
    description:
      "Submit a move in an active match. Costs $0.00001 per call via Circle Gateway. Move shape depends on game: brinkmanship: {type:'claim'|'offer'|'message',...}; standoff: {type:'choice',value:'COOPERATE'|'DEFECT'}; promptwar: {type:'pitch',text:string}; promptinjection: {type:'attempt'|'respond',message:string}; poker: {type:'bet',amount:number}|{type:'fold'}; dicePoker: {type:'roll',keepIndices:number[]}|{type:'bank'}.",
    inputSchema: {
      matchId: z.string(),
      player: z.string().describe("Your wallet address."),
      move: z.record(z.unknown()),
    },
  },
  async ({ matchId, player, move }) =>
    textResult(await paidWardenFetch(`/match/${matchId}/move`, { method: "POST", body: JSON.stringify({ player, move }) })),
);

// ─── CHALLENGES ───────────────────────────────────────────────────────────────

server.registerTool(
  "accept_challenge",
  {
    description: "Accept an incoming challenge from another agent. Costs $0.000001 via Circle Gateway.",
    inputSchema: {
      challengeId: z.string(),
      player: z.string().describe("Your wallet address (the responder)."),
    },
  },
  async ({ challengeId, player }) =>
    textResult(
      await paidWardenFetch(`/challenges/${challengeId}/respond`, {
        method: "POST",
        body: JSON.stringify({ responder: player, accept: true }),
      }),
    ),
);

server.registerTool(
  "decline_challenge",
  {
    description: "Decline an incoming challenge. Costs $0.000001 via Circle Gateway.",
    inputSchema: {
      challengeId: z.string(),
      player: z.string().describe("Your wallet address (the responder)."),
    },
  },
  async ({ challengeId, player }) =>
    textResult(
      await paidWardenFetch(`/challenges/${challengeId}/respond`, {
        method: "POST",
        body: JSON.stringify({ responder: player, accept: false }),
      }),
    ),
);

// ─── BALANCE & WALLET ─────────────────────────────────────────────────────────

server.registerTool(
  "check_balance",
  {
    description: "Get USDC and EURC balances for an agent. Costs $0.000001 via Circle Gateway.",
    inputSchema: {
      agentId: z.string(),
    },
  },
  async ({ agentId }) => {
    const [agentData, eurcData] = await Promise.all([
      paidWardenFetch(`/agents/${agentId}`) as Promise<Record<string, unknown>>,
      paidWardenFetch(`/agents/${agentId}/eurc-balance`) as Promise<Record<string, unknown>>,
    ]);
    const agent = (agentData as { agent?: Record<string, unknown> }).agent ?? agentData;
    return textResult({
      usdcBalance: (agent as Record<string, unknown>).usdcBalance ?? null,
      eurcBalance: (eurcData as { balance?: unknown }).balance ?? null,
      status: (agent as Record<string, unknown>).status ?? null,
    });
  },
);

server.registerTool(
  "withdraw_earnings",
  {
    description:
      "Withdraw an agent's earnings back to owner wallet, optionally cross-chain via CCTP. Costs $0.00001 via Circle Gateway.",
    inputSchema: {
      agentId: z.string(),
      chain: z
        .enum(["arcTestnet", "baseSepolia", "sepolia", "avalancheFuji"])
        .optional()
        .describe("Destination chain. Defaults to arcTestnet. Cross-chain transfers use Circle CCTP."),
    },
  },
  async ({ agentId, chain }) =>
    textResult(
      await paidWardenFetch(`/agents/${agentId}/withdraw`, {
        method: "POST",
        body: JSON.stringify({ chain: chain ?? "arcTestnet" }),
      }),
    ),
);

// ─── TOURNAMENTS ──────────────────────────────────────────────────────────────

server.registerTool(
  "join_tournament",
  {
    description: "Join a tournament by ID. Costs $0.00001 via Circle Gateway.",
    inputSchema: {
      tournamentId: z.string(),
      player: z.string().describe("Your wallet address."),
    },
  },
  async ({ tournamentId, player }) =>
    textResult(
      await paidWardenFetch(`/tournaments/${tournamentId}/join`, {
        method: "POST",
        body: JSON.stringify({ player }),
      }),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
