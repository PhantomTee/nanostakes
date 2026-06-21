"use client";

import { useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";

interface LeaderboardEntry {
  address: string;
  temperament?: string;
  standing: "UNRANKED" | "CONTENDER" | "STEADY" | "ELITE";
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  netPnl: number;
}

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const SPOT_ORDER = [1, 0, 2]; // render 2nd, 1st, 3rd, podium-style

function Spot({ entry, rank }: { entry: LeaderboardEntry | undefined; rank: number }) {
  if (!entry) {
    return (
      <div className={`podium-spot podium-spot--${rank}`}>
        <div className="podium-rank">#{rank}</div>
        <div className="podium-spot__empty">Open seat</div>
      </div>
    );
  }
  return (
    <div className={`podium-spot podium-spot--${rank}`}>
      <div className="podium-rank">#{rank}</div>
      <a
        className="podium-addr"
        href={`https://testnet.arcscan.app/address/${entry.address}`}
        target="_blank"
        rel="noopener"
        title={entry.address}
      >
        {short(entry.address)}
      </a>
      <div className="podium-temperament">{entry.temperament ?? "n/a"}</div>
      <span className={`seal seal--${entry.standing}`}>{entry.standing}</span>
      <div className={`podium-pnl ${entry.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}`}>
        {entry.netPnl >= 0 ? "+" : ""}
        {entry.netPnl.toFixed(4)}
      </div>
      <div className="podium-record">
        {entry.wins}W&ndash;{entry.losses}L&ndash;{entry.ties}T &middot; {entry.matchesPlayed} matches
      </div>
    </div>
  );
}

export default function Podium() {
  const [top, setTop] = useState<LeaderboardEntry[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(apiUrl("/ledger"));
        const { leaderboard } = await res.json();
        if (cancelled) return;
        setTop(leaderboard.slice(0, 3));
        setErrored(false);
      } catch {
        if (!cancelled) setErrored(true);
      }
    }

    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (errored) {
    return <p style={{ color: "var(--stamp)" }}>Couldn&apos;t reach the Warden. Is it running?</p>;
  }

  if (top === null) {
    return <p style={{ color: "var(--text-on-paper-muted)" }}>Loading podium&hellip;</p>;
  }

  if (top.length === 0) {
    return (
      <p style={{ color: "var(--text-on-paper-muted)" }}>
        No settled matches yet. The podium fills in as soon as the first match settles.
      </p>
    );
  }

  return (
    <div className="podium">
      {SPOT_ORDER.map((i) => (
        <Spot key={i} entry={top[i]} rank={i + 1} />
      ))}
    </div>
  );
}
