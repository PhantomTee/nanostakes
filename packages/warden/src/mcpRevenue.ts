import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const REVENUE_PATH = path.join(DATA_DIR, "mcp-revenue.json");

export interface McpPayment {
  route: string;
  payer: string;
  amountUsd: number;
  transaction: string;
  at: string;
}

interface RevenueFile {
  payments: McpPayment[];
}

function load(): RevenueFile {
  if (!existsSync(REVENUE_PATH)) return { payments: [] };
  return JSON.parse(readFileSync(REVENUE_PATH, "utf8")) as RevenueFile;
}

function save(file: RevenueFile): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REVENUE_PATH, JSON.stringify(file, null, 2));
}

/** Records one settled nanopayment against a metered MCP-backed route. Amount is in USDC atomic units (6 decimals). */
export function recordMcpPayment(params: { route: string; payer: string; amountAtomic: bigint; transaction: string }): void {
  const file = load();
  file.payments.push({
    route: params.route,
    payer: params.payer,
    amountUsd: Number(params.amountAtomic) / 1_000_000,
    transaction: params.transaction,
    at: new Date().toISOString(),
  });
  save(file);
}

export interface McpRevenueStats {
  totalCalls: number;
  totalRevenueUsd: number;
  avgPriceUsd: number;
  uniquePayers: number;
  byRoute: Record<string, { calls: number; revenueUsd: number }>;
  recent: McpPayment[];
}

/** Aggregate traction numbers for the metered MCP surface — calls, revenue, avg price, unique payers. */
export function getMcpRevenueStats(): McpRevenueStats {
  const { payments } = load();
  const byRoute: Record<string, { calls: number; revenueUsd: number }> = {};
  let totalRevenueUsd = 0;
  const payers = new Set<string>();
  for (const p of payments) {
    if (!byRoute[p.route]) byRoute[p.route] = { calls: 0, revenueUsd: 0 };
    byRoute[p.route].calls += 1;
    byRoute[p.route].revenueUsd += p.amountUsd;
    totalRevenueUsd += p.amountUsd;
    payers.add(p.payer.toLowerCase());
  }
  return {
    totalCalls: payments.length,
    totalRevenueUsd,
    avgPriceUsd: payments.length === 0 ? 0 : totalRevenueUsd / payments.length,
    uniquePayers: payers.size,
    byRoute,
    recent: payments.slice(-20).reverse(),
  };
}
