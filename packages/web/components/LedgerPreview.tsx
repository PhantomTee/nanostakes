"use client";

import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

export default function LedgerPreview() {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadLedgerPreview() {
      const el = elRef.current;
      if (!el) return;
      try {
        const res = await fetch(apiUrl("/ledger"));
        const { leaderboard } = await res.json();
        if (cancelled) return;
        if (!leaderboard.length) {
          el.innerHTML =
            '<p style="color:var(--text-on-paper-muted)">No settled matches yet — the first row is waiting to be written.</p>';
          return;
        }
        const rows = leaderboard
          .slice(0, 5)
          .map(
            (a: any, i: number) => `<tr>
              <td>${i + 1}</td>
              <td><a class="addr-link" href="https://testnet.arcscan.app/address/${a.address}" target="_blank" rel="noopener">${a.address.slice(0, 10)}&hellip;</a></td>
              <td>${a.temperament ?? "—"}</td>
              <td><span class="seal seal--${a.standing}">${a.standing}</span></td>
              <td>${a.wins}/${a.losses}/${a.ties}</td>
              <td class="${a.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}">${a.netPnl >= 0 ? "+" : ""}${a.netPnl.toFixed(4)}</td>
            </tr>`,
          )
          .join("");
        el.innerHTML = `<table class="ledger">
          <thead><tr><th>Rank</th><th>Agent</th><th>Temperament</th><th>Standing</th><th>W/L/T</th><th>Net (USDC)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      } catch {
        if (!cancelled && el) {
          el.innerHTML =
            '<p style="color:var(--text-on-paper-muted)">Couldn\'t reach the Warden — the live ledger lives at /ledger.</p>';
        }
      }
    }

    loadLedgerPreview();
    return () => {
      cancelled = true;
    };
  }, []);

  return <div ref={elRef} id="ledgerPreview">Loading recent standings&hellip;</div>;
}
