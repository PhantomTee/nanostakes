/**
 * Prometheus metrics for Nanostakes Arena.
 * Exposed at GET /metrics — standard Prometheus text format.
 * Scraped by Grafana or any Prometheus-compatible monitoring tool.
 */

interface Counter { name: string; help: string; labels: Record<string, string>; value: number; }
interface Gauge { name: string; help: string; labels: Record<string, string>; value: number; }

const counters = new Map<string, Counter>();
const gauges = new Map<string, Gauge>();

function counterKey(name: string, labels: Record<string, string>) {
  return `${name}{${Object.entries(labels).map(([k,v]) => `${k}="${v}"`).join(",")}}`;
}

export function incCounter(name: string, help: string, labels: Record<string, string> = {}) {
  const key = counterKey(name, labels);
  const existing = counters.get(key);
  if (existing) existing.value += 1;
  else counters.set(key, { name, help, labels, value: 1 });
}

export function setGauge(name: string, help: string, value: number, labels: Record<string, string> = {}) {
  const key = counterKey(name, labels);
  gauges.set(key, { name, help, labels, value });
}

export function renderMetrics(): string {
  const lines: string[] = [];
  const countersByName = new Map<string, Counter[]>();
  for (const c of counters.values()) {
    const arr = countersByName.get(c.name) ?? [];
    arr.push(c);
    countersByName.set(c.name, arr);
  }
  for (const [name, cs] of countersByName) {
    lines.push(`# HELP ${name} ${cs[0].help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const c of cs) {
      const labelStr = Object.entries(c.labels).map(([k,v]) => `${k}="${v}"`).join(",");
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ""} ${c.value}`);
    }
  }
  const gaugesByName = new Map<string, Gauge[]>();
  for (const g of gauges.values()) {
    const arr = gaugesByName.get(g.name) ?? [];
    arr.push(g);
    gaugesByName.set(g.name, arr);
  }
  for (const [name, gs] of gaugesByName) {
    lines.push(`# HELP ${name} ${gs[0].help}`);
    lines.push(`# TYPE ${name} gauge`);
    for (const g of gs) {
      const labelStr = Object.entries(g.labels).map(([k,v]) => `${k}="${v}"`).join(",");
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ""} ${g.value}`);
    }
  }
  return lines.join("\n") + "\n";
}

// Metric names to use throughout the codebase
export const METRICS = {
  matchesCreated: "nanostakes_matches_created_total",
  matchesCompleted: "nanostakes_matches_completed_total",
  usdcMoved: "nanostakes_usdc_moved_total",
  brokerFees: "nanostakes_broker_fees_total",
  tournamentParticipants: "nanostakes_tournament_participants_total",
  agentBalance: "nanostakes_agent_balance_usdc",
} as const;
