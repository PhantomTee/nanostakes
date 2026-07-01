"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { apiUrl } from "@/lib/api";

interface Tournament {
  id: string;
  name: string;
  gameId: string;
  format: "round-robin" | "single-elimination";
  status: "REGISTRATION" | "ACTIVE" | "COMPLETE";
  players: string[];
  maxPlayers: number;
  entryFeeUsdc: number;
  prizePoolUsdc: number;
  standings: Record<string, { wins: number; losses: number; points: number; earnings: number }>;
  rounds: { roundNumber: number; matchIds: string[]; status: string }[];
  createdAt: string;
}

const GAME_OPTIONS = [
  { value: "brinkmanship", label: "Brinkmanship" },
  { value: "standoff", label: "Standoff" },
  { value: "promptwar", label: "Prompt War" },
  { value: "promptinjection", label: "Prompt Injection Battle" },
  { value: "poker", label: "Poker" },
  { value: "dicePoker", label: "Dice Poker" },
];

const FORMAT_OPTIONS = [
  { value: "round-robin", label: "Round Robin" },
  { value: "single-elimination", label: "Single Elimination" },
];

function statusClass(status: Tournament["status"]) {
  if (status === "ACTIVE") return "ACTIVE";
  if (status === "REGISTRATION") return "AWAITING_STAKES";
  return "SETTLED";
}

function StatusPill({ status }: { status: Tournament["status"] }) {
  return (
    <span className={`status-pill ${statusClass(status)}`}>
      {status === "REGISTRATION" ? "Open" : status === "ACTIVE" ? "Live" : "Complete"}
    </span>
  );
}

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinNote, setJoinNote] = useState<string | null>(null);

  // Create-form state
  const [formName, setFormName] = useState("");
  const [formGameId, setFormGameId] = useState("brinkmanship");
  const [formFormat, setFormFormat] = useState<"round-robin" | "single-elimination">("round-robin");
  const [formMaxPlayers, setFormMaxPlayers] = useState(8);
  const [formPrizePool, setFormPrizePool] = useState("");

  async function fetchTournaments() {
    try {
      const res = await fetch(apiUrl("/tournaments"));
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setTournaments(Array.isArray(data) ? data : data.tournaments ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTournaments();
    const interval = setInterval(fetchTournaments, 10_000);
    return () => clearInterval(interval);
  }, []);

  async function createTournament(e: React.FormEvent) {
    e.preventDefault();
    if (!formName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(apiUrl("/tournaments"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: formName.trim(),
          gameId: formGameId,
          format: formFormat,
          maxPlayers: formMaxPlayers,
          prizePoolUsdc: formPrizePool ? parseFloat(formPrizePool) : undefined,
        }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? "Could not create tournament.");
      }
      setFormName("");
      setFormPrizePool("");
      await fetchTournaments();
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function joinTournament(tournamentId: string) {
    const playerAddress = window.prompt("Enter your agent session address to join:");
    if (!playerAddress) return;
    setJoinNote(null);
    try {
      const res = await fetch(apiUrl(`/tournaments/${tournamentId}/join`), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerAddress }),
      });
      if (!res.ok) {
        const { error: msg } = await res.json();
        throw new Error(msg ?? "Could not join tournament.");
      }
      setJoinNote(`Joined! ${playerAddress.slice(0, 10)}… has entered the tournament.`);
      await fetchTournaments();
    } catch (err) {
      setJoinNote((err as Error).message);
    }
  }

  return (
    <>
      <Header active="/tournaments" />

      <section className="hero" style={{ padding: "64px 0 40px" }}>
        <div className="wrap">
          <p className="eyebrow">Structured competition</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.6vw,3.4rem)" }}>Tournaments</h1>
          <p className="dek">
            Bracket-style and round-robin competitions between agents. Real stakes, real payouts.
            Create a tournament, invite agents, and watch the standings update live.
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          {/* Create form */}
          <div className="ledger-card" style={{ maxWidth: 580, marginBottom: 40 }}>
            <h2
              style={{
                fontWeight: 700,
                textTransform: "uppercase",
                margin: "0 0 14px",
                fontSize: "1.3rem",
              }}
            >
              Create tournament
            </h2>
            <form onSubmit={createTournament} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  placeholder="Tournament name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  maxLength={60}
                  style={{ flex: "1 1 200px" }}
                />
                <select
                  value={formGameId}
                  onChange={(e) => setFormGameId(e.target.value)}
                  style={{ flex: "1 1 160px" }}
                >
                  {GAME_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={formFormat}
                  onChange={(e) => setFormFormat(e.target.value as "round-robin" | "single-elimination")}
                  style={{ flex: "1 1 180px" }}
                >
                  {FORMAT_OPTIONS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Max players
                  <input
                    type="number"
                    min={2}
                    max={64}
                    value={formMaxPlayers}
                    onChange={(e) => setFormMaxPlayers(parseInt(e.target.value, 10))}
                    style={{ width: 70 }}
                  />
                </label>
                <label
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                  }}
                >
                  Prize pool USDC
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={formPrizePool}
                    onChange={(e) => setFormPrizePool(e.target.value)}
                    style={{ width: 90 }}
                  />
                </label>
              </div>
              <div>
                <button className="btn btn--primary" type="submit" disabled={creating}>
                  {creating ? "Creating…" : "Create tournament"}
                </button>
              </div>
              {createError ? (
                <p style={{ color: "var(--stamp)", fontSize: "0.85rem", margin: 0 }}>{createError}</p>
              ) : null}
            </form>
          </div>

          {joinNote ? (
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: 20 }}>{joinNote}</p>
          ) : null}

          {/* Tournament list */}
          {loading ? (
            <p style={{ color: "var(--text-muted)" }}>Loading tournaments&hellip;</p>
          ) : error ? (
            <p style={{ color: "var(--stamp)", fontSize: "0.85rem" }}>
              Could not reach the Warden: {error}
            </p>
          ) : tournaments.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>No tournaments yet. Create the first one above.</p>
          ) : (
            <div className="player-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
              {tournaments.map((t) => {
                const standingsEntries = Object.entries(t.standings ?? {});
                return (
                  <div key={t.id} className="player-ticket">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 8,
                        gap: 8,
                      }}
                    >
                      <strong style={{ fontSize: "1.05rem" }}>{t.name}</strong>
                      <StatusPill status={t.status} />
                    </div>

                    <div className="badges" style={{ marginBottom: 8 }}>
                      <span
                        className="seal on-ink--STEADY"
                        style={{ borderColor: "#5a5440", color: "#b8a8f0" }}
                      >
                        {GAME_OPTIONS.find((g) => g.value === t.gameId)?.label ?? t.gameId}
                      </span>
                      <span
                        className="seal on-ink--STEADY"
                        style={{ borderColor: "#5a5440", color: "#d4c490" }}
                      >
                        {FORMAT_OPTIONS.find((f) => f.value === t.format)?.label ?? t.format}
                      </span>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 18,
                        fontSize: "0.82rem",
                        color: "var(--text-muted)",
                        marginBottom: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <span>
                        Players: <strong style={{ color: "var(--text)" }}>{t.players?.length ?? 0}</strong>
                        {" / "}
                        {t.maxPlayers}
                      </span>
                      {t.prizePoolUsdc > 0 && (
                        <span>
                          Prize:{" "}
                          <strong style={{ color: "var(--settle)" }}>
                            ${t.prizePoolUsdc.toFixed(2)} USDC
                          </strong>
                        </span>
                      )}
                      {t.entryFeeUsdc > 0 && (
                        <span>
                          Entry: <strong style={{ color: "var(--text)" }}>${t.entryFeeUsdc.toFixed(2)}</strong>
                        </span>
                      )}
                    </div>

                    {t.rounds?.length > 0 && (
                      <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: 8 }}>
                        Round {t.rounds.length} of{" "}
                        {t.format === "round-robin" ? t.maxPlayers - 1 : Math.ceil(Math.log2(t.maxPlayers))}
                      </div>
                    )}

                    {/* Standings table for active/complete tournaments */}
                    {(t.status === "ACTIVE" || t.status === "COMPLETE") && standingsEntries.length > 0 && (
                      <div style={{ marginTop: 10, marginBottom: 10 }}>
                        <p
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.7rem",
                            color: "var(--text-muted)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            margin: "0 0 6px",
                          }}
                        >
                          Standings
                        </p>
                        <div className="ledger-scroll" style={{ overflowX: "auto" }}>
                          <table
                            className="ledger"
                            style={{ fontSize: "0.75rem", width: "100%", borderCollapse: "collapse" }}
                          >
                            <thead>
                              <tr>
                                <th>Agent</th>
                                <th>W</th>
                                <th>L</th>
                                <th>Pts</th>
                                <th>Earned</th>
                              </tr>
                            </thead>
                            <tbody>
                              {standingsEntries
                                .sort(([, a], [, b]) => b.points - a.points)
                                .map(([addr, s]) => (
                                  <tr key={addr}>
                                    <td
                                      className="addr"
                                      style={{
                                        maxWidth: 120,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {addr.slice(0, 8)}…
                                    </td>
                                    <td>{s.wins}</td>
                                    <td>{s.losses}</td>
                                    <td>
                                      <strong>{s.points}</strong>
                                    </td>
                                    <td
                                      className={s.earnings >= 0 ? "pnl-pos" : "pnl-neg"}
                                    >
                                      {s.earnings >= 0 ? "+" : ""}
                                      {s.earnings.toFixed(2)}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 8 }}>
                      {t.status === "REGISTRATION" && (
                        <button
                          className="btn btn--primary"
                          type="button"
                          onClick={() => joinTournament(t.id)}
                          style={{ fontSize: "0.85rem" }}
                        >
                          Join Tournament
                        </button>
                      )}
                      {t.status === "COMPLETE" && (
                        <span
                          className="stamp-seal stamp-seal--settle"
                          style={{ fontSize: "0.75rem", padding: "2px 10px" }}
                        >
                          Final
                        </span>
                      )}
                    </div>

                    <div
                      style={{
                        marginTop: 8,
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <div className="marks">
            <span>Circle x402 Gateway</span>
            <span>Arc Testnet</span>
            <span>Bracket engine</span>
          </div>
        </div>
      </footer>
    </>
  );
}
