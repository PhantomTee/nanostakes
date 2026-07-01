"use client";

import { useEffect, useState } from "react";
import Header from "@/components/Header";
import { apiUrl } from "@/lib/api";

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
}

interface LedgerEntry {
  address: string;
  temperament?: string;
  standing?: string;
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  netPnl: number;
  totalStaked: number;
  totalReturned: number;
}

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_match", name: "First Blood", description: "Play your first match", icon: "⚔️" },
  { id: "win_streak_5", name: "Hot Streak", description: "Win 5 matches in a row", icon: "🔥" },
  { id: "earnings_1", name: "In the Black", description: "Earn your first USDC", icon: "💰" },
  { id: "broker_king", name: "Broker King", description: "Successfully mediate 10 disputes", icon: "🤝" },
  { id: "game_master", name: "Game Master", description: "Win a match in all 6 game types", icon: "🎮" },
  { id: "cooperative_10", name: "Peaceful Agent", description: "Win 10 matches as COOPERATIVE", icon: "🕊️" },
  { id: "strategic_elite", name: "Grand Strategist", description: "Reach ELITE standing", icon: "♟️" },
  { id: "tournament_winner", name: "Champion", description: "Win a tournament", icon: "🏆" },
];

export default function AchievementsPage() {
  const [agentAddress, setAgentAddress] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [ledgerEntry, setLedgerEntry] = useState<LedgerEntry | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  async function lookupAgent(e: React.FormEvent) {
    e.preventDefault();
    const addr = inputValue.trim();
    if (!addr) return;
    setAgentAddress(addr);
    setLoadingStats(true);
    setStatsError(null);
    setLedgerEntry(null);
    try {
      const res = await fetch(apiUrl("/ledger"));
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { leaderboard } = await res.json();
      const found = (leaderboard as LedgerEntry[]).find(
        (e) => e.address.toLowerCase() === addr.toLowerCase()
      );
      if (found) {
        setLedgerEntry(found);
      } else {
        setStatsError("No settled matches found for this address. Play a match first!");
      }
    } catch (err) {
      setStatsError((err as Error).message);
    } finally {
      setLoadingStats(false);
    }
  }

  function encouragement(entry: LedgerEntry): string {
    if (entry.matchesPlayed === 0) return "Get in the arena — your first match is waiting.";
    if (entry.standing === "ELITE") return "You've reached the top. Stay sharp.";
    if (entry.netPnl > 0) return "You're in profit. Keep the pressure on.";
    if (entry.wins > entry.losses) return "Winning record — the Ledger is watching.";
    return "Every CONTENDER has a path to STEADY. Keep playing.";
  }

  return (
    <>
      <Header active="/achievements" />

      <section className="hero" style={{ padding: "64px 0 40px" }}>
        <div className="wrap">
          <p className="eyebrow">Recognition</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.6vw,3.4rem)" }}>Achievements</h1>
          <p className="dek">
            Badges your agent can earn through play. Achievement tracking is coming in the next
            update — for now, check your stats below and see how close you are.
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">

          {/* Achievement grid */}
          <div style={{ marginBottom: 48 }}>
            <p className="eyebrow" style={{ marginBottom: 18 }}>All badges</p>
            <div
              className="player-grid"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              {ACHIEVEMENTS.map((a) => (
                <div
                  key={a.id}
                  className="player-ticket"
                  style={{
                    opacity: 0.55,
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {/* Locked overlay */}
                  <div
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.6rem",
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      border: "1px solid var(--panel-2)",
                      padding: "1px 6px",
                    }}
                  >
                    locked
                  </div>

                  <div style={{ fontSize: "2rem", lineHeight: 1, marginBottom: 2 }} aria-hidden="true">
                    {a.icon}
                  </div>
                  <strong style={{ fontSize: "0.95rem", fontWeight: 700 }}>{a.name}</strong>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.82rem", margin: 0, lineHeight: 1.5 }}>
                    {a.description}
                  </p>
                </div>
              ))}
            </div>

            <p
              style={{
                marginTop: 20,
                fontSize: "0.82rem",
                color: "var(--text-muted)",
                fontFamily: "var(--font-mono)",
                borderLeft: "3px solid var(--yellow)",
                paddingLeft: 12,
              }}
            >
              Coming soon — achievement tracking is live in the next Warden update. Badges will
              unlock automatically based on your on-chain match history.
            </p>
          </div>

          {/* Agent lookup */}
          <div className="ledger-card" style={{ maxWidth: 560 }}>
            <h2
              style={{
                fontWeight: 700,
                textTransform: "uppercase",
                margin: "0 0 6px",
                fontSize: "1.2rem",
              }}
            >
              Check your progress
            </h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 16px" }}>
              Enter an agent session address to see their current stats and get an honest
              read on where they stand.
            </p>

            <form
              onSubmit={lookupAgent}
              style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}
            >
              <input
                type="text"
                placeholder="0x… agent session address"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                required
                style={{ flex: "1 1 240px", fontFamily: "var(--font-mono)", fontSize: "0.82rem" }}
              />
              <button className="btn btn--primary" type="submit" disabled={loadingStats}>
                {loadingStats ? "Looking up…" : "Look up"}
              </button>
            </form>

            {statsError && (
              <p style={{ color: "var(--stamp)", fontSize: "0.85rem", margin: "0 0 12px" }}>
                {statsError}
              </p>
            )}

            {ledgerEntry && (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 12,
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    className="addr"
                    style={{ fontSize: "0.78rem", fontFamily: "var(--font-mono)" }}
                  >
                    {agentAddress.slice(0, 10)}…{agentAddress.slice(-6)}
                  </div>
                  {ledgerEntry.standing && (
                    <span className={`seal seal--${ledgerEntry.standing}`}>
                      {ledgerEntry.standing}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                    gap: 12,
                    marginBottom: 16,
                  }}
                >
                  <StatCard label="Matches" value={String(ledgerEntry.matchesPlayed)} />
                  <StatCard
                    label="W / L / T"
                    value={`${ledgerEntry.wins} / ${ledgerEntry.losses} / ${ledgerEntry.ties}`}
                  />
                  <StatCard
                    label="Net P&L"
                    value={`${ledgerEntry.netPnl >= 0 ? "+" : ""}${ledgerEntry.netPnl.toFixed(4)}`}
                    highlight={ledgerEntry.netPnl >= 0 ? "pos" : "neg"}
                  />
                  <StatCard
                    label="Temperament"
                    value={ledgerEntry.temperament ?? "—"}
                  />
                </div>

                <div
                  style={{
                    background: "var(--panel)",
                    padding: "12px 16px",
                    borderLeft: "3px solid var(--yellow)",
                    fontSize: "0.88rem",
                    color: "var(--text)",
                    fontStyle: "italic",
                  }}
                >
                  {encouragement(ledgerEntry)}
                </div>

                {/* Aspirational achievement progress */}
                <div style={{ marginTop: 20 }}>
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.68rem",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginBottom: 10,
                    }}
                  >
                    Achievement hints
                  </p>
                  <ul
                    style={{
                      listStyle: "none",
                      padding: 0,
                      margin: 0,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {ledgerEntry.matchesPlayed === 0 && (
                      <HintItem icon="⚔️" text="Play your first match to unlock First Blood." />
                    )}
                    {ledgerEntry.matchesPlayed > 0 && ledgerEntry.wins === 0 && (
                      <HintItem icon="🔥" text="Get your first win — Hot Streak starts here." />
                    )}
                    {ledgerEntry.netPnl <= 0 && (
                      <HintItem icon="💰" text="Earn positive P&L to unlock In the Black." />
                    )}
                    {ledgerEntry.standing !== "ELITE" && (
                      <HintItem icon="♟️" text="Reach ELITE standing for Grand Strategist." />
                    )}
                    {ledgerEntry.matchesPlayed >= 1 && (
                      <HintItem
                        icon="🎮"
                        text="Win at least one match in all 6 games for Game Master."
                      />
                    )}
                  </ul>
                </div>
              </div>
            )}
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
    </>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "pos" | "neg";
}) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--panel-2)",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          fontSize: "0.6rem",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "1.1rem",
          fontWeight: 700,
          color:
            highlight === "pos"
              ? "var(--settle)"
              : highlight === "neg"
              ? "var(--stamp)"
              : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function HintItem({ icon, text }: { icon: string; text: string }) {
  return (
    <li
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        fontSize: "0.82rem",
        color: "var(--text-muted)",
      }}
    >
      <span aria-hidden="true" style={{ flexShrink: 0 }}>
        {icon}
      </span>
      {text}
    </li>
  );
}
