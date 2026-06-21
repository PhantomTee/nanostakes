/**
 * Demo of a real consumer of the metered MCP surface: an autonomous "scout"
 * that pays its own way to gather intelligence before deciding anything,
 * rather than being handed free data. It never touches the website or the
 * free REST routes — only the priced /mcp/* routes, settled via Circle
 * Gateway nanopayments.
 *
 * Decision it makes: which temperament has the best historical net P&L per
 * match (the "exploitable" opponent type a rational agent would want to
 * avoid, or the strategy worth copying), then checks whether any open match
 * currently involves that temperament.
 *
 * Usage: tsx scripts/scout-agent.ts
 * Requires SCOUT_PRIVATE_KEY (or falls back to CONTENDER_A_PRIVATE_KEY) set
 * and funded with Arc Testnet USDC.
 */
import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import type { Hex } from "viem";

const WARDEN_URL = process.env.WARDEN_URL ?? "http://localhost:4000";
const privateKey = (process.env.SCOUT_PRIVATE_KEY ?? process.env.CONTENDER_A_PRIVATE_KEY) as Hex | undefined;
if (!privateKey) {
  throw new Error("set SCOUT_PRIVATE_KEY (or CONTENDER_A_PRIVATE_KEY) to a funded Arc Testnet wallet");
}

const client = new GatewayClient({ chain: "arcTestnet", privateKey });

interface LedgerStats {
  byTemperament: Record<string, { agents: number; matches: number; netPnl: number; avgPnlPerMatch: number }>;
}
interface MatchSummary {
  matchId: string;
  status: string;
  players: string[];
}

console.log(`Scout agent ${client.address} paying for intelligence before acting...\n`);

const { data: ledger, amount: ledgerCost } = await client.pay<LedgerStats>(`${WARDEN_URL}/mcp/ledger`);
console.log(`Paid ${ledgerCost.toString()} atomic USDC for /mcp/ledger.`);

const ranked = Object.entries(ledger.byTemperament)
  .filter(([, s]) => s.matches > 0)
  .sort((a, b) => b[1].avgPnlPerMatch - a[1].avgPnlPerMatch);

if (ranked.length === 0) {
  console.log("No settled matches yet — nothing to rank. Decision: wait.");
  process.exit(0);
}

const [bestTemperament, bestStats] = ranked[0];
console.log(
  `Decision: ${bestTemperament} has the best average net P&L per match (${bestStats.avgPnlPerMatch.toFixed(4)} USDC across ${bestStats.matches} matches). Watching for it.`,
);

const { data: matches, amount: matchesCost } = await client.pay<MatchSummary[]>(`${WARDEN_URL}/mcp/matches`);
console.log(`\nPaid ${matchesCost.toString()} atomic USDC for /mcp/matches.`);

const open = matches.filter((m) => m.status !== "settled");
console.log(open.length ? `${open.length} match(es) currently open. Scout would inspect these next.` : "No open matches right now.");

const totalSpent = ledgerCost + matchesCost;
console.log(`\nTotal spent on intelligence this run: ${totalSpent.toString()} atomic USDC (~$${(Number(totalSpent) / 1_000_000).toFixed(6)}).`);
