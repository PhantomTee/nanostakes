import { driveAgentForever } from "@nanostakes/contender";
import type { Hex } from "viem";
import { listActiveAgents, setAgentStatus, type OwnedAgent } from "./agents.js";

const POLL_INTERVAL_MS = 4000;
const MAX_CONSECUTIVE_FAILURES = 3;
const stopped = new Set<string>();
const running = new Set<string>();
const failures = new Map<string, number>();

function groqApiKey(): string | undefined {
  return process.env.GROQ_API_KEY;
}

function startDriver(agent: OwnedAgent, wardenUrl: string): void {
  running.add(agent.id);
  stopped.delete(agent.id);
  driveAgentForever({
    wardenUrl,
    privateKey: agent.sessionPrivateKey as Hex,
    temperament: agent.temperament,
    name: agent.name,
    providers: { groqApiKey: groqApiKey() ?? "", openrouterApiKey: process.env.OPENROUTER_API_KEY },
    isStopped: () => stopped.has(agent.id),
    onEvent: (message) => console.log(`[agent ${agent.id}] ${message}`),
  })
    .then(() => failures.delete(agent.id))
    .catch((err) => {
      const count = (failures.get(agent.id) ?? 0) + 1;
      failures.set(agent.id, count);
      console.error(`[agent ${agent.id}] driver crashed (${count}/${MAX_CONSECUTIVE_FAILURES}): ${(err as Error).message}`);
      if (count >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`[agent ${agent.id}] pausing after repeated failures — likely needs funding`);
        setAgentStatus(agent.id, "PAUSED");
        failures.delete(agent.id);
      }
    })
    .finally(() => running.delete(agent.id));
}

/**
 * Multi-tenant scheduler: every few seconds, makes sure every ACTIVE owned
 * agent has exactly one driver loop running, and stops drivers for agents
 * that are no longer ACTIVE. This is what replaces "run a Contender script
 * by hand" with "everyone gets an agent" — N owners' agents all play
 * concurrently inside this one Warden process.
 */
export function startAgentRuntime(wardenUrl: string): void {
  if (!groqApiKey()) {
    console.warn("GROQ_API_KEY is not set — owned agents will be provisioned but cannot play until it is.");
  }
  setInterval(() => {
    const active = listActiveAgents();
    const activeIds = new Set(active.map((a) => a.id));

    for (const agent of active) {
      if (!running.has(agent.id)) startDriver(agent, wardenUrl);
    }
    for (const id of running) {
      if (!activeIds.has(id)) stopped.add(id);
    }
  }, POLL_INTERVAL_MS);
}
