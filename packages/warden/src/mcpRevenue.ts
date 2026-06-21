import { db } from "./db.js";

export interface McpPayment {
  route: string;
  payer: string;
  amountUsd: number;
  transaction: string;
  at: string;
}

const insertPayment = db.prepare(`
  INSERT INTO mcp_payments (route, payer, amountUsd, txn, at) VALUES (?, ?, ?, ?, ?)
`);
const selectAllPayments = db.prepare('SELECT route, payer, amountUsd, txn AS "transaction", at FROM mcp_payments');
const selectRecentPayments = db.prepare(
  'SELECT route, payer, amountUsd, txn AS "transaction", at FROM mcp_payments ORDER BY id DESC LIMIT 20',
);

/** Records one settled nanopayment against a metered MCP-backed route. Amount is in USDC atomic units (6 decimals). */
export function recordMcpPayment(params: { route: string; payer: string; amountAtomic: bigint; transaction: string }): void {
  insertPayment.run(params.route, params.payer, Number(params.amountAtomic) / 1_000_000, params.transaction, new Date().toISOString());
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
  const payments = selectAllPayments.all() as McpPayment[];
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
    recent: selectRecentPayments.all() as McpPayment[],
  };
}
