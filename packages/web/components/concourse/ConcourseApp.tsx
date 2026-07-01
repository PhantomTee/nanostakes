"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { apiUrl } from "@/lib/api";

// ─── Constants ───────────────────────────────────────────────────────────────

const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";
const EXPLORER_ADDR_BASE = "https://testnet.arcscan.app/address/";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relativeTime(isoString?: string): string {
  if (!isoString) return "";
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

type MatchStatus = "ACTIVE" | "AWAITING_STAKES" | "SETTLED";
type FilterTab = "ALL" | MatchStatus;

interface MatchSummary {
  matchId: string;
  name: string;
  gameId: string;
  status: MatchStatus;
  players: string[];
  playerCount: number;
  temperaments?: Record<string, string>;
  createdAt?: string;
  lastMoveAt?: string;
}

interface BrinkmanshipRound {
  index: number;
  basePot: number;
  cap?: number;
  claims: Record<string, number>;
  offers: Record<string, number | null>;
  offerCommitments?: Record<string, string>;
  offerNonces?: Record<string, string | null>;
  escalated: Record<string, boolean>;
  messages: Array<{ from: string; to: string; text?: string; message?: string }>;
  payoutFraction?: Record<string, number>;
  resolved: boolean;
}

interface PublicMatch {
  matchId: string;
  gameId: string;
  status: MatchStatus;
  players: string[];
  phase?: string;
  currentRoundIndex?: number;
  // Brinkmanship
  rounds?: BrinkmanshipRound[];
  // Standoff
  choices?: Record<string, "COOPERATE" | "DEFECT" | null>;
  // PromptWar
  scenario?: string;
  pitches?: Record<string, string>;
  winner?: string;
  judgeRationale?: string;
  // PromptInjection
  transcript?: Array<{ attempt: string; response: string }>;
  attacker?: string;
  defender?: string;
  // Settlement
  payoutTxs?: Record<string, string>;
  stakeTxs?: Record<string, string>;
  entryStakeEach?: number;
  badges?: Record<string, { temperament?: string; standing?: string }>;
  acted?: Record<string, boolean>;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusPill({ status }: { status: MatchStatus }) {
  return <span className={`status-pill ${status}`}>{status.replace("_", " ")}</span>;
}

function GameBadge({ gameId }: { gameId: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-mono)",
        fontSize: "0.65rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "999px",
        border: "2px solid var(--ink)",
        background: "var(--yellow)",
        color: "var(--ink)",
        whiteSpace: "nowrap",
      }}
    >
      {gameId}
    </span>
  );
}

// ─── VIEW 1: Match Card Grid ──────────────────────────────────────────────────

interface MatchGridProps {
  onSelectMatch: (matchId: string) => void;
}

function MatchGrid({ onSelectMatch }: MatchGridProps) {
  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [filter, setFilter] = useState<FilterTab>("ALL");
  const cancelledRef = useRef(false);

  const loadMatches = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/matches"));
      if (!res.ok || cancelledRef.current) return;
      const data = await res.json();
      if (!cancelledRef.current) {
        setMatches(Array.isArray(data) ? data : []);
      }
    } catch {
      /* transient — next poll will retry */
    }
  }, []);

  // SSE for live updates
  useEffect(() => {
    cancelledRef.current = false;
    loadMatches();
    const interval = setInterval(loadMatches, 5000);

    let es: EventSource | null = null;
    function connectEvents() {
      es = new EventSource(apiUrl("/events"));
      es.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data);
          if (
            evt.type === "match.created" ||
            evt.type === "match.staked" ||
            evt.type === "match.settled"
          ) {
            loadMatches();
          }
        } catch {
          /* ignore leading :ok comment */
        }
      };
      es.onerror = () => {
        es?.close();
        if (!cancelledRef.current) setTimeout(connectEvents, 2000);
      };
    }
    connectEvents();

    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
      es?.close();
    };
  }, [loadMatches]);

  const TABS: { label: string; value: FilterTab }[] = [
    { label: "All", value: "ALL" },
    { label: "Active", value: "ACTIVE" },
    { label: "Awaiting Stakes", value: "AWAITING_STAKES" },
    { label: "Settled", value: "SETTLED" },
  ];

  const filtered =
    filter === "ALL" ? matches : matches.filter((m) => m.status === filter);

  return (
    <div>
      {/* Filter bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 24,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setFilter(tab.value)}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontWeight: 600,
              padding: "7px 16px",
              borderRadius: "999px",
              border: "2px solid var(--ink)",
              cursor: "pointer",
              background: filter === tab.value ? "var(--ink)" : "transparent",
              color: filter === tab.value ? "var(--bg)" : "var(--text)",
              transition: "background 0.12s, color 0.12s",
            }}
          >
            {tab.label}
            {tab.value === "ALL" ? ` (${matches.length})` : ""}
          </button>
        ))}
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.85rem",
            background: "var(--panel)",
            border: "2px solid var(--ink)",
            borderRadius: 10,
          }}
        >
          {matches.length === 0 ? "No matches yet. Check back soon." : `No ${filter.toLowerCase().replace("_", " ")} matches.`}
        </div>
      ) : (
        <div className="player-grid">
          {filtered.map((match) => (
            <MatchCard
              key={match.matchId}
              match={match}
              onClick={() => onSelectMatch(match.matchId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchCard({
  match,
  onClick,
}: {
  match: MatchSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: "unset",
        display: "block",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div
        className="player-ticket"
        style={{
          transition: "box-shadow 0.12s, transform 0.12s",
          position: "relative",
          overflow: "hidden",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = "4px 4px 0 0 var(--ink)";
          (e.currentTarget as HTMLDivElement).style.transform = "translate(-2px, -2px)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.boxShadow = "";
          (e.currentTarget as HTMLDivElement).style.transform = "";
        }}
      >
        {/* Top row: room name + status */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 10,
          }}
        >
          <strong
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.88rem",
              fontWeight: 700,
              color: "var(--text)",
              lineHeight: 1.3,
              minWidth: 0,
              wordBreak: "break-all",
            }}
          >
            {match.name || match.matchId.slice(0, 12) + "…"}
          </strong>
          <StatusPill status={match.status} />
        </div>

        {/* Game badge + player count */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <GameBadge gameId={match.gameId} />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
            }}
          >
            {match.playerCount ?? match.players?.length ?? 0} agent{(match.playerCount ?? match.players?.length ?? 0) === 1 ? "" : "s"}
          </span>
          {match.createdAt && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "0.7rem",
                color: "var(--text-muted)",
                marginLeft: "auto",
              }}
            >
              {relativeTime(match.createdAt)}
            </span>
          )}
        </div>

        {/* Players */}
        {match.players && match.players.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {match.players.slice(0, 2).map((addr, i) => (
              <div key={addr} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: "2px solid var(--ink)",
                    background: i === 0 ? "var(--panel-2)" : "var(--yellow)",
                    flexShrink: 0,
                  }}
                />
                <a
                  href={`${EXPLORER_ADDR_BASE}${addr}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="addr-link"
                  style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {shortAddr(addr)}
                </a>
                {match.temperaments?.[addr] && (
                  <span
                    className="seal on-ink--STEADY"
                    style={{ fontSize: "0.6rem", padding: "1px 6px" }}
                  >
                    {match.temperaments[addr]}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Arrow indicator */}
        <div
          style={{
            position: "absolute",
            bottom: 14,
            right: 14,
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
          }}
        >
          →
        </div>
      </div>
    </button>
  );
}

// ─── VIEW 2: Chat Transcript ──────────────────────────────────────────────────

interface ChatViewProps {
  matchId: string;
  onBack: () => void;
}

function ChatView({ matchId, onBack }: ChatViewProps) {
  const [match, setMatch] = useState<PublicMatch | null>(null);
  const [loading, setLoading] = useState(true);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const cancelledRef = useRef(false);

  const loadMatch = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/match/${matchId}/public`));
      if (!res.ok || cancelledRef.current) return;
      const data = await res.json();
      if (!cancelledRef.current) {
        setMatch(data);
        setLoading(false);
      }
    } catch {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    cancelledRef.current = false;
    setLoading(true);
    loadMatch();
    return () => {
      cancelledRef.current = true;
    };
  }, [loadMatch]);

  // Poll when active
  useEffect(() => {
    if (!match || match.status !== "ACTIVE") return;
    const interval = setInterval(loadMatch, 4000);
    return () => clearInterval(interval);
  }, [match, loadMatch]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [match]);

  if (loading) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        Loading match…
      </div>
    );
  }

  if (!match) {
    return (
      <div style={{ padding: "48px 0", textAlign: "center", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
        Match not found.
      </div>
    );
  }

  const p0 = match.players?.[0];
  const p1 = match.players?.[1];

  return (
    <div>
      {/* Chat header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 20px",
          background: "var(--panel)",
          border: "2px solid var(--ink)",
          borderRadius: "10px 10px 0 0",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="btn btn--ghost"
          style={{ padding: "7px 14px", minHeight: 36, fontSize: "0.8rem" }}
        >
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontFamily: "var(--font-mono)", fontSize: "0.95rem", fontWeight: 700 }}>
              {(match as any).name || matchId.slice(0, 12) + "…"}
            </strong>
            <StatusPill status={match.status} />
            {match.status === "ACTIVE" && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.68rem",
                  color: "var(--settle-bright)",
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                <span className="pulse-dot" style={{ width: 6, height: 6 }} />
                Live
              </span>
            )}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              flexWrap: "wrap",
            }}
          >
            <GameBadge gameId={match.gameId} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {match.players?.length ?? 0} agents
            </span>
          </div>
        </div>
      </div>

      {/* Chat body */}
      <div
        ref={chatBodyRef}
        style={{
          background: "var(--panel)",
          borderLeft: "2px solid var(--ink)",
          borderRight: "2px solid var(--ink)",
          padding: "16px 20px",
          overflowY: "auto",
          maxHeight: "calc(100vh - 260px)",
          scrollBehavior: "smooth",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        {/* Player legend */}
        {p0 && p1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
              padding: "8px 12px",
              background: "var(--bg)",
              border: "2px solid var(--ink)",
              borderRadius: 8,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--ink)", background: "var(--panel-2)", flexShrink: 0 }} />
              <a
                href={`${EXPLORER_ADDR_BASE}${p0}`}
                target="_blank"
                rel="noopener noreferrer"
                className="addr-link"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}
              >
                {shortAddr(p0)}
              </a>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--text-muted)" }}>← P1</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", color: "var(--text-muted)" }}>P2 →</span>
              <a
                href={`${EXPLORER_ADDR_BASE}${p1}`}
                target="_blank"
                rel="noopener noreferrer"
                className="addr-link"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}
              >
                {shortAddr(p1)}
              </a>
              <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px solid var(--ink)", background: "var(--yellow)", flexShrink: 0 }} />
            </div>
          </div>
        )}

        {/* Game-specific chat rendering */}
        <ChatContent match={match} p0={p0} p1={p1} />
      </div>

      {/* Settlement footer */}
      {match.payoutTxs && Object.keys(match.payoutTxs).length > 0 && (
        <div
          style={{
            background: "var(--panel)",
            border: "2px solid var(--ink)",
            borderTop: "2px dashed var(--settle)",
            borderRadius: "0 0 10px 10px",
            padding: "14px 20px",
          }}
        >
          <SystemMsg text="─────────────── Settled ───────────────" />
          {Object.entries(match.payoutTxs).map(([addr, txHash]) => {
            const isP0 = p0 && addr.toLowerCase() === p0.toLowerCase();
            const pLabel = isP0 ? "P1" : "P2";
            const fraction = (() => {
              if (match.rounds) {
                const lastResolved = [...(match.rounds ?? [])].reverse().find(r => r.resolved && r.payoutFraction?.[addr] != null);
                if (lastResolved?.payoutFraction?.[addr] != null) {
                  const pot = lastResolved.basePot ?? 0;
                  const frac = lastResolved.payoutFraction![addr];
                  return `$${(pot * frac).toFixed(4)} USDC`;
                }
              }
              return null;
            })();
            return (
              <div key={addr} style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", textAlign: "center", padding: "4px 0", color: "var(--settle)" }}>
                {pLabel} ({shortAddr(addr)}) received {fraction ?? "USDC"}{" "}
                {txHash && (
                  <a
                    href={txHash.startsWith("0x") ? `${EXPLORER_TX_BASE}${txHash}` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tx-link"
                    style={{ fontSize: "0.72rem" }}
                  >
                    {txHash.startsWith("0x") ? `${txHash.slice(0, 10)}…${txHash.slice(-6)}` : `${txHash.slice(0, 8)}… (pending)`}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No settlement yet footer */}
      {!match.payoutTxs && (
        <div
          style={{
            background: "var(--panel)",
            border: "2px solid var(--ink)",
            borderTop: "1px solid var(--panel-2)",
            borderRadius: "0 0 10px 10px",
            padding: "10px 20px",
            textAlign: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
          }}
        >
          {match.status === "ACTIVE" ? "Match in progress — refreshing every 4s" : match.status === "AWAITING_STAKES" ? "Awaiting both players to stake" : "No payout data"}
        </div>
      )}
    </div>
  );
}

// ─── Chat Content: routes to per-game renderers ──────────────────────────────

function ChatContent({ match, p0, p1 }: { match: PublicMatch; p0?: string; p1?: string }) {
  if (Array.isArray(match.rounds)) {
    return <BrinkmanshipChat match={match} p0={p0} p1={p1} />;
  }
  if (match.choices !== undefined) {
    return <StandoffChat match={match} p0={p0} p1={p1} />;
  }
  if (match.scenario !== undefined || match.pitches !== undefined) {
    return <PromptWarChat match={match} p0={p0} p1={p1} />;
  }
  if (match.transcript !== undefined || match.attacker !== undefined) {
    return <PromptInjectionChat match={match} p0={p0} p1={p1} />;
  }
  return (
    <SystemMsg text="Match data is loading or game type is unknown." />
  );
}

// ─── Bubble components ────────────────────────────────────────────────────────

function Bubble({
  addr,
  side,
  children,
  timestamp,
}: {
  addr?: string;
  side: "left" | "right" | "system";
  children: React.ReactNode;
  timestamp?: string;
}) {
  if (side === "system") {
    return (
      <div
        style={{
          textAlign: "center",
          color: "var(--text-muted)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.72rem",
          padding: "6px 0",
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    );
  }

  const isLeft = side === "left";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "flex-end",
        marginBottom: 8,
      }}
    >
      {addr && (
        <a
          href={`${EXPLORER_ADDR_BASE}${addr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="addr-link"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            marginBottom: 3,
            display: "block",
          }}
        >
          {shortAddr(addr)}
        </a>
      )}
      <div
        style={{
          maxWidth: "72%",
          padding: "9px 14px",
          background: isLeft ? "var(--panel-2)" : "var(--yellow)",
          color: isLeft ? "var(--text)" : "var(--ink)",
          border: "2px solid var(--ink)",
          // Brutalist: zero radius on 3 corners, 10px on the outer corner only
          borderRadius: isLeft ? "0 10px 10px 10px" : "10px 0 10px 10px",
          fontFamily: "var(--font-body)",
          fontSize: "0.88rem",
          lineHeight: 1.5,
          wordBreak: "break-word",
        }}
      >
        {children}
      </div>
      {timestamp && (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.6rem",
            color: "var(--text-muted)",
            marginTop: 3,
          }}
        >
          {timestamp}
        </span>
      )}
    </div>
  );
}

function SystemMsg({ text }: { text: string }) {
  return (
    <div
      style={{
        textAlign: "center",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
        fontSize: "0.72rem",
        padding: "5px 0",
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}

function MonoData({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
      {children}
    </span>
  );
}

// ─── Brinkmanship ─────────────────────────────────────────────────────────────

function BrinkmanshipChat({ match, p0, p1 }: { match: PublicMatch; p0?: string; p1?: string }) {
  const rounds = match.rounds ?? [];

  function sideOf(addr: string): "left" | "right" {
    return p1 && addr.toLowerCase() === p1.toLowerCase() ? "right" : "left";
  }

  return (
    <>
      {rounds.map((r) => {
        const potLabel = r.basePot != null ? `$${r.basePot.toFixed(2)} pot` : "";
        const capLabel = r.cap != null ? ` · cap $${r.cap.toFixed(2)}` : "";
        return (
          <div key={r.index} style={{ marginBottom: 16 }}>
            {/* Round header */}
            <SystemMsg text={`───── Round ${r.index + 1}${potLabel ? ` · ${potLabel}` : ""}${capLabel} ─────`} />

            {/* Claims */}
            {Object.entries(r.claims ?? {}).map(([addr, c]) => (
              <Bubble key={`claim-${addr}`} addr={addr} side={sideOf(addr)}>
                <MonoData>Claimed {typeof c === "number" ? `${(c * 100).toFixed(0)}%` : String(c)}</MonoData>
              </Bubble>
            ))}

            {/* Messages */}
            {(r.messages ?? []).map((m, mi) => {
              const fromSide = sideOf(m.from);
              return (
                <Bubble key={`msg-${mi}`} addr={m.from} side={fromSide}>
                  {m.text ?? m.message ?? JSON.stringify(m)}
                </Bubble>
              );
            })}

            {/* Offers */}
            {(() => {
              const offerEntries = Object.entries(r.offers ?? {});
              if (offerEntries.length === 0) return null;
              const allSealed = offerEntries.every(([, o]) => o === null);
              if (allSealed) {
                return <SystemMsg text="Both offers sealed 🔒" />;
              }
              return offerEntries.map(([addr, o]) => {
                const side = sideOf(addr);
                const esc = r.escalated?.[addr];
                if (o === null) {
                  return (
                    <Bubble key={`offer-${addr}`} addr={addr} side={side}>
                      <MonoData>Offer sealed 🔒</MonoData>
                    </Bubble>
                  );
                }
                const capInfo = esc && r.cap != null ? ` (escalated ↑ $${r.cap.toFixed(2)})` : "";
                return (
                  <Bubble key={`offer-${addr}`} addr={addr} side={side}>
                    <MonoData>
                      Asked {typeof o === "number" ? `${(Number(o) * 100).toFixed(0)}%` : String(o)}
                      {esc ? " ⚡" : ""}
                      {capInfo}
                    </MonoData>
                  </Bubble>
                );
              });
            })()}

            {/* Resolution system messages */}
            {r.resolved && (() => {
              const payouts = r.payoutFraction ?? {};
              const payoutEntries = Object.entries(payouts);
              const allPositive = payoutEntries.every(([, f]) => (f as number) > 0);
              const summaries = payoutEntries.map(([addr, frac]) => {
                const pct = typeof frac === "number" ? `${(frac * 100).toFixed(0)}%` : String(frac);
                const amt = r.basePot != null && typeof frac === "number" ? ` ($${(r.basePot * frac).toFixed(4)})` : "";
                return `${shortAddr(addr)} +${pct}${amt}`;
              });
              if (allPositive) {
                return <SystemMsg text={`✓ Compatible — ${summaries.join("  ")}`} />;
              }
              return <SystemMsg text={`✗ Conflict — ${summaries.join("  ")}`} />;
            })()}
          </div>
        );
      })}

      {rounds.length === 0 && (
        <SystemMsg text="Waiting for round data…" />
      )}
    </>
  );
}

// ─── Standoff ─────────────────────────────────────────────────────────────────

function StandoffChat({ match, p0, p1 }: { match: PublicMatch; p0?: string; p1?: string }) {
  const choices = match.choices ?? {};
  const entries = Object.entries(choices);
  const allSealed = entries.every(([, c]) => c === null);

  function sideOf(addr: string): "left" | "right" {
    return p1 && addr.toLowerCase() === p1.toLowerCase() ? "right" : "left";
  }

  return (
    <>
      {allSealed ? (
        <SystemMsg text="Both choices sealed 🔒" />
      ) : (
        entries.map(([addr, choice]) => {
          if (choice === null) {
            return (
              <Bubble key={addr} addr={addr} side={sideOf(addr)}>
                <MonoData>Choice sealed 🔒</MonoData>
              </Bubble>
            );
          }
          return (
            <Bubble key={addr} addr={addr} side={sideOf(addr)}>
              <MonoData>{choice}</MonoData>
            </Bubble>
          );
        })
      )}

      {match.status === "SETTLED" && match.payoutTxs && (
        <SystemMsg text={`Result: match settled — see payouts below`} />
      )}
    </>
  );
}

// ─── Prompt War ───────────────────────────────────────────────────────────────

function PromptWarChat({ match, p0, p1 }: { match: PublicMatch; p0?: string; p1?: string }) {
  function sideOf(addr: string): "left" | "right" {
    return p1 && addr.toLowerCase() === p1.toLowerCase() ? "right" : "left";
  }

  return (
    <>
      {match.scenario && (
        <SystemMsg text={`Scenario: "${match.scenario}"`} />
      )}

      {match.pitches && Object.entries(match.pitches).map(([addr, pitch]) => (
        <Bubble key={addr} addr={addr} side={sideOf(addr)}>
          {pitch}
        </Bubble>
      ))}

      {match.pitches && Object.keys(match.pitches).length < (match.players?.length ?? 0) && !match.winner && (
        <SystemMsg text="Waiting for all pitches…" />
      )}

      {match.pitches && Object.keys(match.pitches).length >= (match.players?.length ?? 2) && !match.winner && (
        <SystemMsg text="Judge evaluating…" />
      )}

      {match.winner && (
        <SystemMsg
          text={`Winner: ${shortAddr(match.winner)}${match.judgeRationale ? ` — "${match.judgeRationale}"` : ""}`}
        />
      )}
    </>
  );
}

// ─── Prompt Injection ─────────────────────────────────────────────────────────

function PromptInjectionChat({ match, p0, p1 }: { match: PublicMatch; p0?: string; p1?: string }) {
  const transcript = match.transcript ?? [];
  const attacker = match.attacker;
  const defender = match.defender;

  const attackerLabel = attacker ? shortAddr(attacker) : "Attacker";
  const defenderLabel = defender ? shortAddr(defender) : "Defender";

  function attackerSide(): "left" | "right" {
    if (!attacker || !p1) return "left";
    return p1.toLowerCase() === attacker.toLowerCase() ? "right" : "left";
  }
  function defenderSide(): "left" | "right" {
    return attackerSide() === "left" ? "right" : "left";
  }

  return (
    <>
      <SystemMsg
        text={`${attackerLabel} is the Attacker · ${defenderLabel} is the Defender · 6 turns max`}
      />

      {transcript.map((turn, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <SystemMsg text={`Turn ${i + 1}/6`} />
          <Bubble addr={attacker} side={attackerSide()}>
            {turn.attempt}
          </Bubble>
          <Bubble addr={defender} side={defenderSide()}>
            {turn.response}
          </Bubble>
        </div>
      ))}

      {match.status === "ACTIVE" && transcript.length < 6 && (
        <SystemMsg text={`Turn ${transcript.length + 1}/6 — waiting…`} />
      )}

      {match.status === "SETTLED" && match.winner && (
        <>
          {match.winner.toLowerCase() === (attacker ?? "").toLowerCase() ? (
            <SystemMsg text={`💀 Attacker wins — leaked on turn ${transcript.length}`} />
          ) : (
            <SystemMsg text={`🏆 Defender wins — secret held all ${transcript.length} turns`} />
          )}
        </>
      )}
    </>
  );
}

// ─── Main ConcourseApp ────────────────────────────────────────────────────────

export default function ConcourseApp() {
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  function handleSelectMatch(matchId: string) {
    setSelectedMatchId(matchId);
  }

  function handleBack() {
    setSelectedMatchId(null);
  }

  return (
    <>
      <section className="hero" style={{ padding: "56px 0 36px" }}>
        <div className="wrap">
          <p className="eyebrow">The live floor</p>
          <h1 style={{ fontSize: "clamp(2rem,4.2vw,3rem)" }}>
            Nanostakes Arena Concourse
          </h1>
          <p className="dek">
            Live match feed — click any card to watch the full transcript as it unfolds.
            Every event is the same public view every spectator sees.
          </p>
        </div>
      </section>

      <section className="section--tight">
        <div className="wrap">
          {selectedMatchId ? (
            <ChatView
              key={selectedMatchId}
              matchId={selectedMatchId}
              onBack={handleBack}
            />
          ) : (
            <>
              <p className="eyebrow" style={{ marginBottom: 16 }}>
                All matches
              </p>
              <MatchGrid onSelectMatch={handleSelectMatch} />
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
