import { randomUUID } from "node:crypto";
import type { Address, Temperament } from "@nanostakes/shared";
import { db } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";

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

const insertAgent = db.prepare(`
  INSERT INTO owned_agents (id, ownerWallet, name, temperament, sessionAddress, sessionPrivateKey, walletProvider, status, createdAt)
  VALUES (@id, @ownerWallet, @name, @temperament, @sessionAddress, @sessionPrivateKey, @walletProvider, @status, @createdAt)
`);
const selectAgentById = db.prepare("SELECT * FROM owned_agents WHERE id = ?");
const selectAgentsByOwner = db.prepare("SELECT * FROM owned_agents WHERE ownerWallet = ? COLLATE NOCASE");
const selectActiveAgents = db.prepare("SELECT * FROM owned_agents WHERE status = 'ACTIVE'");
const updateStatus = db.prepare("UPDATE owned_agents SET status = ? WHERE id = ?");

export function createAgent(params: {
  ownerWallet: Address;
  name: string;
  temperament: Temperament;
  sessionAddress: Address;
  sessionPrivateKey: string;
  walletProvider: "circle" | "local";
}): OwnedAgent {
  const agent: OwnedAgent = {
    id: randomUUID(),
    status: "FUNDING",
    createdAt: new Date().toISOString(),
    ...params,
  };
  insertAgent.run({ ...agent, sessionPrivateKey: encryptSecret(agent.sessionPrivateKey) });
  return agent;
}

/** Rows are stored with sessionPrivateKey encrypted (see crypto.ts) — decrypt on the way out. */
function decryptRow(row: OwnedAgent | undefined): OwnedAgent | undefined {
  if (!row) return row;
  return { ...row, sessionPrivateKey: decryptSecret(row.sessionPrivateKey) };
}

export function getAgent(id: string): OwnedAgent | undefined {
  return decryptRow(selectAgentById.get(id) as OwnedAgent | undefined);
}

export function listAgentsByOwner(ownerWallet: Address): OwnedAgent[] {
  return (selectAgentsByOwner.all(ownerWallet) as OwnedAgent[]).map((a) => decryptRow(a)!);
}

export function listActiveAgents(): OwnedAgent[] {
  return (selectActiveAgents.all() as OwnedAgent[]).map((a) => decryptRow(a)!);
}

export function setAgentStatus(id: string, status: AgentStatus): OwnedAgent {
  const agent = getAgent(id);
  if (!agent) throw new Error(`unknown agent: ${id}`);
  updateStatus.run(status, id);
  return { ...agent, status };
}

/** Strips the session private key before sending an agent over the wire. */
export function toPublicAgent(agent: OwnedAgent): Omit<OwnedAgent, "sessionPrivateKey"> {
  const { sessionPrivateKey: _omit, ...rest } = agent;
  return rest;
}
