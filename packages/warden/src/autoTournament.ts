import { listActiveAgents } from "./agents.js";
import { createTournament, joinTournament } from "./tournament.js";

let autoInterval: ReturnType<typeof setInterval> | null = null;
const AUTO_INTERVAL_MS = 60 * 60 * 1000;

export function startAutoTournaments(): void {
  if (autoInterval) return;
  autoInterval = setInterval(runAutoTournament, AUTO_INTERVAL_MS);
  console.log("[auto-tournament] Hourly exhibition scheduler started");
}
export function stopAutoTournaments(): void {
  if (autoInterval) { clearInterval(autoInterval); autoInterval = null; }
}

async function runAutoTournament(): Promise<void> {
  try {
    const active = listActiveAgents();
    if (active.length < 4) { console.log(`[auto-tournament] Only ${active.length} active agents — skipping`); return; }
    const byTemperament: Record<string, typeof active[number][]> = {};
    for (const a of active) { (byTemperament[a.temperament ?? "NEUTRAL"] ??= []).push(a); }
    const selected: typeof active = [];
    for (const candidates of Object.values(byTemperament)) {
      if (selected.length < 4) selected.push(candidates[0]);
    }
    while (selected.length < 4) {
      const rem = active.filter(a => !selected.find(s => s.id === a.id));
      if (!rem.length) break;
      selected.push(rem[0]);
    }
    const t = createTournament({ name: `Auto Exhibition — ${new Date().toLocaleDateString()}`, gameId: "brinkmanship", format: "round-robin", entryFeeUsdc: 0, prizePoolUsdc: 0, maxPlayers: selected.length });
    for (const a of selected) joinTournament(t.id, a.sessionAddress);
    console.log(`[auto-tournament] Started exhibition ${t.id}`);
  } catch (err) { console.error(`[auto-tournament] Error: ${(err as Error).message}`); }
}
