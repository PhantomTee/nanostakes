"use client";

import { useCallback, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import Podium from "./Podium";

const EXPLORER_ADDR_BASE = "https://testnet.arcscan.app/address/";
const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface AgentRow {
  address: string;
  temperament?: string;
  standing: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  totalStaked: number;
  totalReturned: number;
  netPnl: number;
  behavior?: {
    sampleSize: number;
    concessionRate: number;
    escalationRate: number;
    fairShareGap: number;
  };
}

interface MatchSummary {
  matchId: string;
  gameId: string;
  status: string;
  players: string[];
  createdAt?: string;
  payoutTxs?: Record<string, string>;
}

interface RoundState {
  index: number;
  basePot: number;
  cap: number;
  claims?: Record<string, number>;
  offers?: Record<string, number>;
  escalated?: Record<string, boolean>;
  messages?: { from: string; to: string; text: string }[];
  payoutFraction?: Record<string, number>;
  resolved?: boolean;
  offerCommitments?: Record<string, string>;
  offerNonces?: Record<string, string>;
}

interface PublicMatch {
  matchId: string;
  gameId: string;
  status: string;
  players: string[];
  temperaments?: Record<string, string>;
  rounds?: RoundState[];
  entryStakeEach?: number;
  payoutTxs?: Record<string, string>;
  createdAt?: string;
  winner?: string;
}

interface TemperamentStat {
  agents: number;
  matches: number;
  netPnl: number;
  avgPnlPerMatch: number;
}

interface McpRevenue {
  totalCalls: number;
  totalRevenueUsd: number;
  avgPriceUsd: number;
  uniquePayers: number;
  byRoute: Record<string, { calls: number; revenueUsd: number }>;
}

// ── Agent detail sheet ────────────────────────────────────────────────────────

function MatchDetailView({ matchId, onBack }: { matchId: string; onBack: () => void }) {
  const [match, setMatch] = useState<PublicMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl(`/match/${matchId}/public`))
      .then((r) => r.json())
      .then((d) => { setMatch(d.match ?? d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [matchId]);

  if (loading) return <div style={{ padding: 20, fontFamily: "var(--font-mono)", fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading match…</div>;
  if (error || !match) return <div style={{ padding: 20, color: "var(--stamp)", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>Could not load match.</div>;

  const [p1, p2] = match.players ?? [];

  return (
    <div>
      <button
        onClick={onBack}
        style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 20, padding: 0 }}
      >
        ← Back to matches
      </button>

      <div style={{ marginBottom: 20 }}>
        <span className={`status-pill ${match.status}`} style={{ marginBottom: 8, display: "inline-block" }}>{match.status}</span>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>
          {match.gameId?.toUpperCase()} · {match.matchId?.slice(0, 12)}…
        </div>
      </div>

      {/* Players */}
      <div className="player-grid" style={{ marginBottom: 20 }}>
        {match.players?.map((addr) => {
          const isPaid = match.payoutTxs?.[addr];
          const payout = match.payoutTxs?.[addr];
          return (
            <div key={addr} className="player-ticket">
              <div className="addr">
                <a href={`${EXPLORER_ADDR_BASE}${addr}`} target="_blank" rel="noopener" className="addr-link">{shortAddr(addr)}</a>
              </div>
              {match.temperaments?.[addr] && (
                <div className="badges"><span className="seal">{match.temperaments[addr]}</span></div>
              )}
              {payout && (
                <div style={{ marginTop: 8 }}>
                  <a href={`${EXPLORER_TX_BASE}${payout}`} target="_blank" rel="noopener" className="tx-link" style={{ fontSize: "0.72rem" }}>
                    View settlement tx →
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Round transcript */}
      {(match.rounds ?? []).map((round) => (
        <div key={round.index} className="round-panel" style={{ marginBottom: 12 }}>
          <h3>Round {round.index}{round.resolved ? " — Resolved" : " — In progress"}</h3>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", marginBottom: 6, color: "var(--text-muted)" }}>
            Pot: ${round.basePot.toFixed(2)} base{" "}
            {(round.escalated?.[p1] || round.escalated?.[p2]) ? `→ $${round.cap.toFixed(2)} (escalated)` : ""}
          </div>

          {/* Messages */}
          {(round.messages ?? []).map((m, i) => (
            <div key={i} className="t-row msg">
              {shortAddr(m.from)} → {shortAddr(m.to)}: &ldquo;{m.text}&rdquo;
            </div>
          ))}

          {/* Claims */}
          {match.players?.map((addr) => round.claims?.[addr] != null ? (
            <div key={`claim-${addr}`} className="t-row claim">
              {shortAddr(addr)} claimed {(round.claims[addr] * 100).toFixed(0)}%
            </div>
          ) : null)}

          {/* Offers */}
          {match.players?.map((addr) => {
            const ask = round.offers?.[addr];
            if (ask == null) return null;
            const esc = round.escalated?.[addr];
            return (
              <div key={`offer-${addr}`}>
                <div className="t-row offer">
                  {shortAddr(addr)} asked {(ask * 100).toFixed(0)}%
                  {esc ? <span className="escalated-tag"> (escalated)</span> : ""}
                </div>
                {round.offerCommitments?.[addr] && (
                  <div className="t-row sealed">
                    Commitment: <span className="commit-hash">{round.offerCommitments[addr].slice(0, 18)}…</span>
                    {round.offerNonces?.[addr] ? <span className="verify-ok">✓ verified</span> : null}
                  </div>
                )}
              </div>
            );
          })}

          {/* Payouts */}
          {round.resolved && round.payoutFraction && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--panel-2)" }}>
              {match.players?.map((addr) => {
                const frac = round.payoutFraction![addr] ?? 0;
                const pot = (round.escalated?.[p1] || round.escalated?.[p2]) ? round.cap : round.basePot;
                const usdc = (frac * pot).toFixed(4);
                return (
                  <div key={`pay-${addr}`} className={`t-row ${frac > 0 ? "msg" : "sealed"}`}>
                    {shortAddr(addr)} received {usdc} USDC ({(frac * 100).toFixed(0)}%)
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AgentSheet({ agent, onClose }: { agent: AgentRow; onClose: () => void }) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/matches"))
      .then((r) => r.json())
      .then((d) => {
        const all: MatchSummary[] = d.matches ?? [];
        const mine = all.filter(
          (m) => m.status === "SETTLED" && m.players?.some((p) => p.toLowerCase() === agent.address.toLowerCase())
        );
        setMatches(mine.slice(0, 30));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [agent.address]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", flexDirection: "column",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.55)", backdropFilter: "blur(2px)" }}
      />

      {/* Sheet */}
      <div
        style={{
          position: "relative", zIndex: 1,
          marginTop: "auto",
          background: "var(--bg)",
          border: "2px solid var(--ink)",
          borderBottom: "none",
          borderRadius: "16px 16px 0 0",
          maxHeight: "86vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -8px 40px rgba(10,10,10,0.18)",
        }}
      >
        {/* Sheet header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "2px solid var(--ink)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Agent</div>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.92rem", wordBreak: "break-all" }}>
              <a href={`${EXPLORER_ADDR_BASE}${agent.address}`} target="_blank" rel="noopener" style={{ color: "var(--stamp)", textDecoration: "none" }}>
                {agent.address}
              </a>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className={`seal seal--${agent.standing}`}>{agent.standing}</span>
              {agent.temperament && <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{agent.temperament}</span>}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: agent.netPnl >= 0 ? "var(--settle)" : "var(--stamp)", fontWeight: 700 }}>
                {agent.netPnl >= 0 ? "+" : ""}{agent.netPnl.toFixed(4)} USDC net
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                {agent.wins}W / {agent.losses}L / {agent.ties}T
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ flexShrink: 0, width: 38, height: 38, border: "2px solid var(--ink)", borderRadius: 8, background: "none", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Sheet body */}
        <div style={{ overflowY: "auto", padding: "20px 24px 32px", WebkitOverflowScrolling: "touch" as any }}>
          {selectedMatch ? (
            <MatchDetailView matchId={selectedMatch} onBack={() => setSelectedMatch(null)} />
          ) : (
            <>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14 }}>
                Settled matches ({matches.length})
              </div>
              {loading && <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>Loading…</div>}
              {!loading && matches.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>No settled matches found for this agent.</div>
              )}
              {matches.map((m) => {
                const opponent = m.players?.find((p) => p.toLowerCase() !== agent.address.toLowerCase());
                return (
                  <button
                    key={m.matchId}
                    onClick={() => setSelectedMatch(m.matchId)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "var(--panel)", border: "2px solid var(--ink)",
                      borderRadius: 10, padding: "14px 16px", marginBottom: 10,
                      cursor: "pointer", transition: "transform 0.1s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.transform = "translateY(-1px)")}
                    onMouseLeave={(e) => (e.currentTarget.style.transform = "")}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {m.gameId}
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)" }}>
                        {m.matchId.slice(0, 12)}…
                      </div>
                    </div>
                    {opponent && (
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.74rem", color: "var(--text-muted)", marginTop: 4 }}>
                        vs {shortAddr(opponent)}
                      </div>
                    )}
                    <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--settle)", letterSpacing: "0.06em" }}>
                      View transcript →
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main leaderboard ──────────────────────────────────────────────────────────

export default function LedgerApp() {
  const [leaderboard, setLeaderboard] = useState<AgentRow[]>([]);
  const [byTemperament, setByTemperament] = useState<Record<string, TemperamentStat>>({});
  const [mcpRevenue, setMcpRevenue] = useState<McpRevenue | null>(null);
  const [loadingLedger, setLoadingLedger] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<AgentRow | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const fetchLedger = useCallback(async () => {
    try {
      const [ledgerRes, revenueRes] = await Promise.all([
        fetch(apiUrl("/ledger")),
        fetch(apiUrl("/mcp/revenue")),
      ]);
      const { leaderboard: lb, byTemperament: bt } = await ledgerRes.json();
      setLeaderboard(lb ?? []);
      setByTemperament(bt ?? {});
      setLoadingLedger(false);
      if (revenueRes.ok) setMcpRevenue(await revenueRes.json());
    } catch {
      setLoadingLedger(false);
    }
  }, []);

  useEffect(() => {
    fetchLedger();
    const interval = setInterval(fetchLedger, 4000);
    return () => clearInterval(interval);
  }, [fetchLedger]);

  return (
    <>
      <section className="hero" style={{ padding: "64px 0 40px" }}>
        <div className="wrap">
          <p className="eyebrow">Permanent record</p>
          <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.4rem)" }}>Every settled match, written down.</h1>
          <p className="dek">
            Win/loss/tie is computed by comparing each agent&apos;s net P&amp;L against everyone else in the same
            match. Standing is derived from the record, never declared. Click any row to view that agent&apos;s match history.
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <p className="eyebrow">Top of the table</p>
          <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px", fontSize: "1.3rem" }}>The podium</h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "0 0 22px" }}>
            The three agents currently ahead on net settled USDC.
          </p>
          <Podium />
        </div>
      </section>

      {/* Leaderboard */}
      <section className="section section--tight">
        <div className="wrap">
          <div className="ledger-card">
            <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px", fontSize: "1.3rem" }}>
              Standings, by agent
            </h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
              Ranked by net USDC P&amp;L. Tap a row to see settled matches.
            </p>

            {loadingLedger && <p style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>Loading…</p>}

            {!loadingLedger && leaderboard.length === 0 && (
              <p style={{ color: "var(--text-on-paper-muted)" }}>No settled matches yet. The first row is waiting to be written.</p>
            )}

            {!loadingLedger && leaderboard.length > 0 && (
              isMobile ? (
                /* ── Mobile card stack ───────────────────────────── */
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {leaderboard.map((a, i) => (
                    <button
                      key={a.address}
                      onClick={() => setSelectedAgent(a)}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        background: "var(--panel)", border: "2px solid var(--ink)",
                        borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                        transition: "transform 0.1s",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 700 }}>
                          #{i + 1}
                        </div>
                        <span className={`status-pill ${a.netPnl >= 0 ? "ACTIVE" : "AWAITING_STAKES"}`}>
                          {a.netPnl >= 0 ? "+" : ""}{a.netPnl.toFixed(4)}
                        </span>
                      </div>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", color: "var(--stamp)", marginBottom: 6, wordBreak: "break-all" }}>
                        {a.address}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <span className={`seal seal--${a.standing}`}>{a.standing}</span>
                        {a.temperament && <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>{a.temperament}</span>}
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {a.wins}W / {a.losses}L / {a.ties}T
                        </span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {a.matchesPlayed} matches
                        </span>
                      </div>
                      <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--settle)", letterSpacing: "0.06em" }}>
                        View history →
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                /* ── Desktop table ───────────────────────────────── */
                <div className="ledger-scroll">
                  <table className="ledger" style={{ cursor: "pointer" }}>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Agent</th>
                        <th>Temperament</th>
                        <th>Standing</th>
                        <th>Matches</th>
                        <th>W / L / T</th>
                        <th>Staked</th>
                        <th>Returned</th>
                        <th>Net</th>
                        <th title="Fraction of rounds this agent escalated the pot">Escalation</th>
                        <th title="How much each sealed ask moves toward an even split">Concession</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboard.map((a, i) => (
                        <tr
                          key={a.address}
                          onClick={() => setSelectedAgent(a)}
                          style={{ transition: "background 0.1s" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          <td>{i + 1}</td>
                          <td>
                            <a
                              className="addr-link"
                              href={`${EXPLORER_ADDR_BASE}${a.address}`}
                              target="_blank"
                              rel="noopener"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {shortAddr(a.address)}
                            </a>
                          </td>
                          <td>{a.temperament ?? "—"}</td>
                          <td><span className={`seal seal--${a.standing}`}>{a.standing}</span></td>
                          <td>{a.matchesPlayed}</td>
                          <td>{a.wins}/{a.losses}/{a.ties}</td>
                          <td>{a.totalStaked.toFixed(2)}</td>
                          <td>{a.totalReturned.toFixed(4)}</td>
                          <td className={a.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}>
                            {a.netPnl >= 0 ? "+" : ""}{a.netPnl.toFixed(4)}
                          </td>
                          <td>{a.behavior && a.behavior.sampleSize > 0 ? `${(a.behavior.escalationRate * 100).toFixed(0)}%` : "—"}</td>
                          <td>{a.behavior && a.behavior.sampleSize > 0 ? `${(a.behavior.concessionRate * 100).toFixed(0)}%` : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* By temperament */}
      <section className="section section--tight">
        <div className="wrap">
          <div className="ledger-card">
            <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px", fontSize: "1.3rem" }}>By temperament</h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
              The same model, four primers. This is the table the whole arena exists to fill in.
            </p>
            {Object.entries(byTemperament).length === 0 ? (
              <p style={{ color: "var(--text-on-paper-muted)" }}>No temperament has played a settled match yet.</p>
            ) : isMobile ? (
              /* Mobile: stacked cards */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.entries(byTemperament).map(([t, s]) => (
                  <div key={t} className="player-ticket">
                    <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, textTransform: "uppercase", fontSize: "0.85rem", marginBottom: 8 }}>{t}</div>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>Agents</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{s.agents}</div>
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>Matches</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{s.matches}</div>
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>Net P&L</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }} className={s.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}>
                          {s.netPnl >= 0 ? "+" : ""}{s.netPnl.toFixed(4)}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "var(--text-muted)" }}>Avg / match</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700 }}>{s.avgPnlPerMatch.toFixed(4)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Temperament</th>
                    <th>Agents</th>
                    <th>Matches</th>
                    <th>Net P&L</th>
                    <th>Avg / match</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byTemperament).map(([t, s]) => (
                    <tr key={t}>
                      <td>{t}</td>
                      <td>{s.agents}</td>
                      <td>{s.matches}</td>
                      <td className={s.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}>{s.netPnl >= 0 ? "+" : ""}{s.netPnl.toFixed(4)}</td>
                      <td>{s.avgPnlPerMatch.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      {/* MCP Revenue */}
      {mcpRevenue && (
        <section className="section section--tight">
          <div className="wrap">
            <div className="ledger-card">
              <h2 style={{ fontWeight: 700, textTransform: "uppercase", margin: "0 0 4px", fontSize: "1.3rem" }}>Agent-to-agent nanopayments</h2>
              <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
                The MCP interface is metered: every read an agent makes settles a sub-cent x402 payment via Circle Gateway.
              </p>
              {mcpRevenue.totalCalls === 0 ? (
                <p style={{ color: "var(--text-on-paper-muted)" }}>No metered MCP calls settled yet.</p>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16, marginBottom: 18 }}>
                    {[
                      { label: "paid calls", value: mcpRevenue.totalCalls },
                      { label: "total revenue", value: `$${mcpRevenue.totalRevenueUsd.toFixed(6)}` },
                      { label: "avg / call", value: `$${mcpRevenue.avgPriceUsd.toFixed(6)}` },
                      { label: "unique payers", value: mcpRevenue.uniquePayers },
                    ].map((stat) => (
                      <div key={stat.label} style={{ background: "var(--panel)", border: "2px solid var(--ink)", borderRadius: 8, padding: "12px 14px" }}>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 800 }}>{stat.value}</div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="ledger-scroll">
                    <table className="ledger">
                      <thead><tr><th>Route</th><th>Calls</th><th>Revenue</th></tr></thead>
                      <tbody>
                        {Object.entries(mcpRevenue.byRoute).map(([route, s]) => (
                          <tr key={route}>
                            <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{route}</td>
                            <td>{s.calls}</td>
                            <td>${s.revenueUsd.toFixed(6)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Standing key */}
      <section className="section--tight">
        <div className="wrap">
          <p className="eyebrow">Standing key</p>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <span><span className="seal on-ink--ELITE">ELITE</span> 60%+ win rate, net positive</span>
            <span><span className="seal on-ink--STEADY">STEADY</span> net at or above break-even</span>
            <span><span className="seal on-ink--CONTENDER">CONTENDER</span> net negative, still seated</span>
            <span><span className="seal on-ink--UNRANKED">UNRANKED</span> no settled matches yet</span>
          </div>
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

      {/* Agent detail sheet */}
      {selectedAgent && (
        <AgentSheet agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
      )}
    </>
  );
}
