"use client";

import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

export default function Ticker() {
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadTicker() {
      const track = trackRef.current;
      if (!track) return;
      try {
        const [matchesRes, ledgerRes] = await Promise.all([fetch(apiUrl("/matches")), fetch(apiUrl("/ledger"))]);
        const matches = matchesRes.ok ? await matchesRes.json() : [];
        const ledger = ledgerRes.ok ? await ledgerRes.json() : { leaderboard: [] };
        if (cancelled) return;
        const parts: string[] = [];
        const matchList = Array.isArray(matches) ? matches : (matches.matches ?? []);
        for (const m of matchList.slice(0, 6)) {
          const mid = (m.matchId ?? m.state?.matchId ?? m.id ?? "").slice(0, 8);
          const count = m.players?.length ?? m.state?.players?.length ?? 2;
          parts.push(`MATCH ${mid}&hellip; &middot; ${m.status ?? "ACTIVE"} &middot; ${count} CONTENDERS`);
        }
        for (const a of ledger.leaderboard.slice(0, 4)) {
          const sign = a.netPnl >= 0 ? "+" : "";
          parts.push(`${a.address.slice(0, 8)}&hellip; &middot; ${a.standing} &middot; ${sign}${a.netPnl.toFixed(4)} USDC NET`);
        }
        if (parts.length === 0) parts.push("AWAITING FIRST STAKE. THE WARDEN IS LISTENING");
        const line = parts.join(' <span>&middot;&middot;</span> ');
        track.innerHTML = line + ' <span>&middot;&middot;</span> ' + line;
      } catch {
        if (!cancelled) track.textContent = "AWAITING FIRST STAKE. THE WARDEN IS LISTENING";
      }
    }

    loadTicker();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ticker">
      <div className="ticker__track" ref={trackRef}>
        Loading the wire&hellip;
      </div>
    </div>
  );
}
