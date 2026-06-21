import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Address, Temperament } from "@nanostakes/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const AGENTS_PATH = path.join(DATA_DIR, "agents.json");

export type AgentStatus = "FUNDING" | "ACTIVE" | "PAUSED";

export interface OwnedAgent {
  id: string;
  ownerWallet: Address;
  name: string;
  temperament: Temperament;
  sessionAddress: Address;
  /** Never returned by any REST endpoint — only read in-process by the runtime to sign for this agent. */
  sessionPrivateKey: string;
  /** "circle" once a real Circle developer-controlled wallet backs this agent; "local" is the dev/testnet fallback. */
  walletProvider: "circle" | "local";
  status: AgentStatus;
  createdAt: string;
}

interface AgentsFile {
  agents: Record<string, OwnedAgent>;
}

function load(): AgentsFile {
  if (!existsSync(AGENTS_PATH)) return { agents: {} };
  return JSON.parse(readFileSync(AGENTS_PATH, "utf8")) as AgentsFile;
}

function save(file: AgentsFile): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(AGENTS_PATH, JSON.stringify(file, null, 2));
}

export function createAgent(params: {
  ownerWallet: Address;
  name: string;
  temperament: Temperament;
  sessionAddress: Address;
  sessionPrivateKey: string;
  walletProvider: "circle" | "local";
}): OwnedAgent {
  const file = load();
  const agent: OwnedAgent = {
    id: randomUUID(),
    status: "FUNDING",
    createdAt: new Date().toISOString(),
    ...params,
  };
  file.agents[agent.id] = agent;
  save(file);
  return agent;
}

export function getAgent(id: string): OwnedAgent | undefined {
  return load().agents[id];
}

export function listAgentsByOwner(ownerWallet: Address): OwnedAgent[] {
  return Object.values(load().agents).filter(
    (a) => a.ownerWallet.toLowerCase() === ownerWallet.toLowerCase(),
  );
}

export function listActiveAgents(): OwnedAgent[] {
  return Object.values(load().agents).filter((a) => a.status === "ACTIVE");
}

export function setAgentStatus(id: string, status: AgentStatus): OwnedAgent {
  const file = load();
  const agent = file.agents[id];
  if (!agent) throw new Error(`unknown agent: ${id}`);
  agent.status = status;
  save(file);
  return agent;
}

/** Strips the session private key before sending an agent over the wire. */
export function toPublicAgent(agent: OwnedAgent): Omit<OwnedAgent, "sessionPrivateKey"> {
  const { sessionPrivateKey: _omit, ...rest } = agent;
  return rest;
}
