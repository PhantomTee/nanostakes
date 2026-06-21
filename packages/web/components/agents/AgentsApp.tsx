"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { useWallet } from "@/lib/wallet";

type Temperament = "STRATEGIC" | "COMPETITIVE" | "COOPERATIVE" | "NEUTRAL";

interface OwnedAgent {
  id: string;
  ownerWallet: string;
  name: string;
  temperament: Temperament;
  sessionAddress: string;
  walletProvider: "circle" | "local";
  status: "FUNDING" | "ACTIVE" | "PAUSED";
  createdAt: string;
}

interface OnlineAgent {
  id: string;
  name: string;
  sessionAddress: string;
  temperament: Temperament;
}

const TEMPERAMENTS: Temperament[] = ["STRATEGIC", "COMPETITIVE", "COOPERATIVE", "NEUTRAL"];

/** Withdraw destinations. Gateway moves USDC between these via Circle's CCTP under
 *  the hood, so picking anything other than Arc Testnet is a real cross-chain transfer. */
const WITHDRAW_CHAINS: { value: string; label: string }[] = [
  { value: "arcTestnet", label: "Arc Testnet (same chain)" },
  { value: "baseSepolia", label: "Base Sepolia" },
  { value: "sepolia", label: "Ethereum Sepolia" },
  { value: "avalancheFuji", label: "Avalanche Fuji" },
];

export default function AgentsApp() {
  const { address: owner, connecting, error: connectError, connect } = useWallet();
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [name, setName] = useState("");
  const [temperament, setTemperament] = useState<Temperament>("NEUTRAL");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [withdrawChain, setWithdrawChain] = useState<Record<string, string>>({});
  const [onlineAgents, setOnlineAgents] = useState<OnlineAgent[]>([]);
  const [challengeTarget, setChallengeTarget] = useState<Record<string, string>>({});
  const [challengeMsg, setChallengeMsg] = useState<string | null>(null);

  const refresh = useCallback(async (ownerAddr: string) => {
    const res = await fetch(apiUrl(`/agents?owner=${ownerAddr}`));
    if (!res.ok) return;
    const { agents: list } = await res.json();
    setAgents(list);
  }, []);

  useEffect(() => {
    async function loadOnline() {
      const res = await fetch(apiUrl("/agents/online"));
      if (!res.ok) return;
      const { agents: list } = await res.json();
      setOnlineAgents(list);
    }
    loadOnline();
    const interval = setInterval(loadOnline, 6000);
    return () => clearInterval(interval);
  }, []);

  async function sendChallenge(agent: OwnedAgent) {
    const target = challengeTarget[agent.id];
    if (!target) return;
    setChallengeMsg(null);
    try {
      const res = await fetch(apiUrl("/challenges"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: "brinkmanship", from: agent.sessionAddress, to: target }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Could not send challenge.");
      }
      setChallengeMsg(`${agent.name} challenged ${target.slice(0, 8)}… — waiting on their decision.`);
    } catch (err) {
      setChallengeMsg((err as Error).message);
    }
  }

  useEffect(() => {
    if (!owner) return;
    refresh(owner);
    const interval = setInterval(() => refresh(owner), 5000);
    return () => clearInterval(interval);
  }, [owner, refresh]);

  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!owner || !name.trim()) return;
    setCreating(true);
    setActionError(null);
    try {
      const res = await fetch(apiUrl("/agents"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerWallet: owner, name: name.trim(), temperament }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? "Could not create agent.");
      }
      setName("");
      await refresh(owner);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function runAction(agentId: string, action: "fund" | "withdraw" | "pause" | "resume") {
    if (!owner) return;
    setBusyId(agentId);
    setActionError(null);
    try {
      const body = action === "withdraw" ? { chain: withdrawChain[agentId] || "arcTestnet" } : undefined;
      const res = await fetch(apiUrl(`/agents/${agentId}/${action}`), {
        method: "POST",
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error ?? `Could not ${action} this agent.`);
      }
      await refresh(owner);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <section className="hero" style={{ padding: "64px 0 40px" }}>
        <div className="wrap">
          <p className="eyebrow">Bring your own agent</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.6vw,3.4rem)" }}>Connect a wallet. Spin up an agent. Fund it.</h1>
          <p className="dek">
            Your wallet stays yours. Each agent gets its own session wallet to play with, you decide how much USDC it
            carries, and you can withdraw whatever is left at any time.
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          {!owner ? (
            <div className="ledger-card" style={{ maxWidth: 480 }}>
              <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 10px", fontSize: "1.3rem" }}>
                Step 1: connect your wallet
              </h2>
              <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.88rem", margin: "0 0 16px" }}>
                This identifies you as the owner of any agents you create. No funds move yet.
              </p>
              <button className="btn btn--primary" onClick={connect} type="button" disabled={connecting}>
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
              {connectError ? <p style={{ color: "var(--stamp)", fontSize: "0.85rem", marginTop: 12 }}>{connectError}</p> : null}
            </div>
          ) : (
            <>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: 24 }}>
                Connected as <span style={{ color: "var(--wire)" }}>{owner}</span>
              </p>

              <div className="ledger-card" style={{ maxWidth: 520, marginBottom: 32 }}>
                <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 10px", fontSize: "1.3rem" }}>
                  Step 2: create an agent
                </h2>
                <form onSubmit={createAgent} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    placeholder="Agent name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={40}
                    style={{ flex: "1 1 180px" }}
                  />
                  <select value={temperament} onChange={(e) => setTemperament(e.target.value as Temperament)}>
                    {TEMPERAMENTS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn--primary" type="submit" disabled={creating}>
                    {creating ? "Creating…" : "Create agent"}
                  </button>
                </form>
              </div>

              {actionError ? <p style={{ color: "var(--stamp)", fontSize: "0.85rem", marginBottom: 20 }}>{actionError}</p> : null}

              <h2 style={{ marginBottom: 16 }}>Your agents</h2>
              {agents.length === 0 ? (
                <p style={{ color: "var(--text-muted)" }}>No agents yet. Create one above.</p>
              ) : (
                <div className="player-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  {agents.map((agent) => (
                    <div key={agent.id} className="player-ticket">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                        <strong>{agent.name}</strong>
                        <span className={`status-pill ${agent.status === "ACTIVE" ? "ACTIVE" : agent.status === "FUNDING" ? "AWAITING_STAKES" : "SETTLED"}`}>
                          {agent.status}
                        </span>
                      </div>
                      <div className="badges">
                        <span className="seal on-ink--STEADY" style={{ borderColor: "#5a5440", color: "#b8a8f0" }}>
                          {agent.temperament}
                        </span>
                      </div>
                      <div className="addr" style={{ marginTop: 8 }}>
                        Session wallet: {agent.sessionAddress}
                      </div>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: "8px 0" }}>
                        {agent.status === "FUNDING"
                          ? "Send testnet USDC to the session wallet above, then click Fund."
                          : agent.status === "ACTIVE"
                            ? "Playing autonomously. Withdraw at any time to cash out and pause it."
                            : "Paused. Resume to put it back in the queue, or send more USDC and fund again."}
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {agent.status === "FUNDING" || agent.status === "PAUSED" ? (
                          <button
                            className="btn btn--ghost"
                            type="button"
                            disabled={busyId === agent.id}
                            onClick={() => runAction(agent.id, "fund")}
                          >
                            Fund
                          </button>
                        ) : null}
                        {agent.status === "ACTIVE" ? (
                          <button
                            className="btn btn--ghost"
                            type="button"
                            disabled={busyId === agent.id}
                            onClick={() => runAction(agent.id, "pause")}
                          >
                            Pause
                          </button>
                        ) : null}
                        {agent.status === "PAUSED" ? (
                          <button
                            className="btn btn--ghost"
                            type="button"
                            disabled={busyId === agent.id}
                            onClick={() => runAction(agent.id, "resume")}
                          >
                            Resume
                          </button>
                        ) : null}
                        <select
                          value={withdrawChain[agent.id] ?? "arcTestnet"}
                          onChange={(e) => setWithdrawChain((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                          style={{ fontSize: "0.78rem" }}
                          title="Destination chain — Gateway moves USDC there via Circle's CCTP. Non-Arc destinations need the owner wallet to already hold a little native gas on that chain."
                        >
                          {WITHDRAW_CHAINS.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn btn--ghost"
                          type="button"
                          disabled={busyId === agent.id}
                          onClick={() => runAction(agent.id, "withdraw")}
                        >
                          Withdraw
                        </button>
                      </div>
                      {agent.status === "ACTIVE" ? (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                          <select
                            value={challengeTarget[agent.id] ?? ""}
                            onChange={(e) => setChallengeTarget((prev) => ({ ...prev, [agent.id]: e.target.value }))}
                            style={{ fontSize: "0.78rem", flex: "1 1 160px" }}
                          >
                            <option value="">Challenge a specific agent…</option>
                            {onlineAgents
                              .filter((o) => o.sessionAddress.toLowerCase() !== agent.sessionAddress.toLowerCase())
                              .map((o) => (
                                <option key={o.id} value={o.sessionAddress}>
                                  {o.name} ({o.temperament})
                                </option>
                              ))}
                          </select>
                          <button
                            className="btn btn--ghost"
                            type="button"
                            disabled={!challengeTarget[agent.id]}
                            onClick={() => sendChallenge(agent)}
                          >
                            Challenge
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              {challengeMsg ? <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: 14 }}>{challengeMsg}</p> : null}
            </>
          )}
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <div className="marks">
            <span>Circle x402 Gateway</span>
            <span>Arc Testnet</span>
          </div>
        </div>
      </footer>
    </>
  );
}
