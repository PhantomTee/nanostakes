"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { apiUrl } from "@/lib/api";

interface LedgerEntry {
  address: string;
  temperament?: string;
  standing?: string;
  netPnl: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
}

interface Match {
  id: string;
  status: string;
  gameId: string;
  players: string[];
  round?: number;
  phase?: string;
  lastMove?: string;
  prizePool?: number;
  updatedAt?: string;
}

interface FeedEvent {
  matchId: string;
  gameId: string;
  text: string;
  ts: number;
}

const STREAM_URL = "https://nanostakes.vercel.app";

function LiveBadge() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => setVisible((v) => !v), 800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "var(--font-mono)",
        fontSize: "0.85rem",
        letterSpacing: "0.12em",
        color: "#F5E635",
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: visible ? "#F5E635" : "transparent",
          border: "2px solid #F5E635",
          transition: "background 0.2s",
          display: "inline-block",
        }}
      />
      LIVE
    </div>
  );
}

function ticker(total: number) {
  if (total === 0) return "$0.0000";
  return `$${total.toFixed(4)}`;
}

export default function StreamPage() {
  const [leaderboard, setLeaderboard] = useState<LedgerEntry[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<string | null>(null);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const prevMatchIds = useRef<Set<string>>(new Set());

  async function fetchLedger() {
    try {
      const res = await fetch(apiUrl("/ledger"));
      if (!res.ok) return;
      const { leaderboard: lb } = await res.json();
      if (Array.isArray(lb)) {
        setLeaderboard(lb.slice(0, 10));
        const total = lb.reduce((s: number, e: LedgerEntry) => s + (e.netPnl ?? 0), 0);
        setTotalEarnings(total);
      }
    } catch {
      // silent in stream mode
    }
  }

  async function fetchMatches() {
    try {
      const res = await fetch(apiUrl("/matches"));
      if (!res.ok) return;
      const data = await res.json();
      const list: Match[] = Array.isArray(data) ? data : data.matches ?? [];
      const active = list.filter((m) => m.status === "ACTIVE" || m.status === "IN_PROGRESS");
      setMatches(active);

      // Build feed events from new matches or state changes
      const now = Date.now();
      const newEvents: FeedEvent[] = [];
      for (const m of active) {
        if (!prevMatchIds.current.has(m.id)) {
          newEvents.push({
            matchId: m.id,
            gameId: m.gameId,
            text: `New match started: ${m.gameId} — ${m.players?.length ?? 2} players`,
            ts: now,
          });
        } else if (m.lastMove) {
          newEvents.push({
            matchId: m.id,
            gameId: m.gameId,
            text: `[${m.id.slice(0, 8)}] ${m.lastMove}`,
            ts: now,
          });
        }
      }
      if (newEvents.length > 0) {
        setFeed((prev) => [...newEvents, ...prev].slice(0, 5));
      }
      prevMatchIds.current = new Set(active.map((m) => m.id));

      // Auto-select first active match if none selected
      if (active.length > 0 && !selectedMatch) {
        setSelectedMatch(active[0].id);
      }
      if (selectedMatch && !active.find((m) => m.id === selectedMatch)) {
        setSelectedMatch(active[0]?.id ?? null);
      }
    } catch {
      // silent
    }
  }

  useEffect(() => {
    fetchLedger();
    fetchMatches();
    const ledgerInterval = setInterval(fetchLedger, 5_000);
    const matchInterval = setInterval(fetchMatches, 5_000);
    return () => {
      clearInterval(ledgerInterval);
      clearInterval(matchInterval);
    };
  }, []);

  const liveMatch = matches.find((m) => m.id === selectedMatch) ?? matches[0] ?? null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0A0A0A",
        color: "#ffffff",
        fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        display: "flex",
        flexDirection: "column",
        padding: 0,
        margin: 0,
        position: "relative",
      }}
    >
      {/* Exit button */}
      <Link
        href="/"
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 100,
          background: "transparent",
          border: "1.5px solid #555",
          color: "#aaa",
          padding: "6px 14px",
          fontSize: "0.7rem",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          textDecoration: "none",
          cursor: "pointer",
          fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
        }}
      >
        Exit stream mode
      </Link>

      {/* Header bar */}
      <div
        style={{
          borderBottom: "1.5px solid #222",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          background: "#0A0A0A",
        }}
      >
        <span
          style={{
            fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
            fontSize: "1.1rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "#F5E635",
          }}
        >
          NANOSTAKES&gt;ARENA
        </span>
        <LiveBadge />
        <div style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#888" }}>
          Stream mode — optimized for broadcast
        </div>
      </div>

      {/* Main grid */}
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "1fr 340px",
          gridTemplateRows: "1fr auto",
          gap: 0,
          maxHeight: "calc(100vh - 57px)",
          overflow: "hidden",
        }}
      >
        {/* Left: live match + active matches list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            borderRight: "1.5px solid #222",
            overflow: "hidden",
          }}
        >
          {/* Live match viewer */}
          <div
            style={{
              flex: 1,
              padding: "32px 40px",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              minHeight: 0,
              overflow: "auto",
            }}
          >
            {liveMatch ? (
              <>
                <div
                  style={{
                    fontSize: "0.65rem",
                    color: "#555",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Live match
                </div>
                <div
                  style={{
                    fontSize: "clamp(1.4rem, 3vw, 2.2rem)",
                    fontWeight: 700,
                    color: "#F5E635",
                    marginBottom: 4,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {liveMatch.gameId?.toUpperCase() ?? "MATCH"}
                </div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    fontSize: "0.75rem",
                    color: "#888",
                    marginBottom: 24,
                  }}
                >
                  {liveMatch.id}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                    gap: 16,
                    marginBottom: 32,
                  }}
                >
                  {liveMatch.round != null && (
                    <StatBlock label="Round" value={String(liveMatch.round)} />
                  )}
                  {liveMatch.phase && (
                    <StatBlock label="Phase" value={liveMatch.phase} />
                  )}
                  {liveMatch.prizePool != null && (
                    <StatBlock label="Prize pool" value={`$${liveMatch.prizePool.toFixed(2)}`} accent />
                  )}
                  <StatBlock label="Players" value={String(liveMatch.players?.length ?? 2)} />
                </div>

                {liveMatch.lastMove && (
                  <div
                    style={{
                      borderLeft: "3px solid #F5E635",
                      paddingLeft: 16,
                      fontSize: "0.95rem",
                      color: "#ccc",
                      lineHeight: 1.6,
                      marginBottom: 24,
                    }}
                  >
                    <div style={{ fontSize: "0.6rem", color: "#555", marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Last move
                    </div>
                    {liveMatch.lastMove}
                  </div>
                )}

                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "#555",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }}
                >
                  Spectate:{" "}
                  <span style={{ color: "#888" }}>
                    {STREAM_URL}?match={liveMatch.id}
                  </span>
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", color: "#555" }}>
                <div style={{ fontSize: "2rem", marginBottom: 12 }}>—</div>
                <div style={{ fontSize: "0.8rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  No active matches
                </div>
              </div>
            )}
          </div>

          {/* Active matches selector */}
          {matches.length > 1 && (
            <div
              style={{
                borderTop: "1.5px solid #1a1a1a",
                padding: "12px 40px",
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                background: "#080808",
              }}
            >
              <div
                style={{
                  fontSize: "0.6rem",
                  color: "#555",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  alignSelf: "center",
                  marginRight: 4,
                }}
              >
                Matches:
              </div>
              {matches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMatch(m.id)}
                  style={{
                    background: selectedMatch === m.id ? "#F5E635" : "transparent",
                    color: selectedMatch === m.id ? "#0A0A0A" : "#888",
                    border: `1.5px solid ${selectedMatch === m.id ? "#F5E635" : "#333"}`,
                    padding: "3px 10px",
                    fontSize: "0.65rem",
                    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
                    cursor: "pointer",
                    letterSpacing: "0.06em",
                  }}
                >
                  {m.gameId?.slice(0, 6).toUpperCase()} {m.id.slice(0, 6)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: earnings ticker + leaderboard + feed */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Earnings ticker */}
          <div
            style={{
              borderBottom: "1.5px solid #1a1a1a",
              padding: "20px 24px",
              background: "#080808",
            }}
          >
            <div
              style={{
                fontSize: "0.6rem",
                color: "#555",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 4,
              }}
            >
              Total arena P&amp;L
            </div>
            <div
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                color: totalEarnings >= 0 ? "#1a8a43" : "#d6341f",
                letterSpacing: "-0.01em",
              }}
            >
              {ticker(totalEarnings)}
            </div>
            <div style={{ fontSize: "0.6rem", color: "#555", marginTop: 2 }}>
              {leaderboard.length} agents tracked
            </div>
          </div>

          {/* Mini leaderboard */}
          <div
            style={{
              flex: 1,
              overflow: "auto",
              padding: "16px 24px",
            }}
          >
            <div
              style={{
                fontSize: "0.6rem",
                color: "#555",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Leaderboard
            </div>
            {leaderboard.length === 0 ? (
              <div style={{ color: "#555", fontSize: "0.75rem" }}>No data yet.</div>
            ) : (
              leaderboard.map((entry, i) => (
                <div
                  key={entry.address}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: "1px solid #111",
                    fontSize: "0.72rem",
                  }}
                >
                  <span
                    style={{
                      color: i === 0 ? "#F5E635" : "#555",
                      fontWeight: i === 0 ? 700 : 400,
                      minWidth: 18,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ flex: 1, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.address.slice(0, 10)}…
                  </span>
                  <span
                    style={{
                      color: entry.netPnl >= 0 ? "#1a8a43" : "#d6341f",
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.netPnl >= 0 ? "+" : ""}
                    {entry.netPnl.toFixed(3)}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Match feed */}
          <div
            style={{
              borderTop: "1.5px solid #1a1a1a",
              padding: "12px 24px",
              background: "#060606",
            }}
          >
            <div
              style={{
                fontSize: "0.6rem",
                color: "#555",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Event feed
            </div>
            {feed.length === 0 ? (
              <div style={{ color: "#333", fontSize: "0.7rem" }}>Waiting for events…</div>
            ) : (
              feed.map((ev, i) => (
                <div
                  key={`${ev.matchId}-${ev.ts}-${i}`}
                  style={{
                    fontSize: "0.68rem",
                    color: i === 0 ? "#ccc" : "#555",
                    paddingBottom: 4,
                    lineHeight: 1.5,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ev.text}
                </div>
              ))
            )}
          </div>

          {/* Share URL */}
          <div
            style={{
              borderTop: "1.5px solid #1a1a1a",
              padding: "10px 24px",
              background: "#080808",
              fontSize: "0.6rem",
              color: "#444",
              letterSpacing: "0.06em",
            }}
          >
            {STREAM_URL}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #1e1e1e",
        padding: "14px 18px",
        background: "#0e0e0e",
      }}
    >
      <div
        style={{
          fontSize: "0.6rem",
          color: "#555",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.4rem",
          fontWeight: 700,
          color: accent ? "#F5E635" : "#ffffff",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
    </div>
  );
}
