"use client";

import { useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

const EXPLORER_ADDR_BASE = "https://testnet.arcscan.app/address/";
function addrLink(addr: string) {
  return `<a class="addr-link" href="${EXPLORER_ADDR_BASE}${addr}" target="_blank" rel="noopener">${addr}</a>`;
}

export default function LedgerApp() {
  const leaderboardRef = useRef<HTMLDivElement>(null);
  const byTemperamentRef = useRef<HTMLDivElement>(null);
  const mcpRevenueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderMcpRevenue() {
      const el = mcpRevenueRef.current;
      if (!el) return;
      try {
        const res = await fetch(apiUrl("/mcp/revenue"));
        const stats = await res.json();
        if (cancelled) return;

        if (stats.totalCalls === 0) {
          el.innerHTML =
            '<p style="color:var(--text-on-paper-muted)">No metered MCP calls settled yet. The first agent to call list_matches, get_match_state, get_public_match, or get_ledger writes the first row.</p>';
          return;
        }

        const byRouteRows = Object.entries(stats.byRoute)
          .map(
            ([route, s]: [string, any]) => `<tr>
              <td>${route}</td>
              <td>${s.calls}</td>
              <td>$${s.revenueUsd.toFixed(6)}</td>
            </tr>`,
          )
          .join("");

        el.innerHTML = `
          <div style="display:flex; gap:28px; flex-wrap:wrap; margin-bottom:18px;">
            <div><div style="font-size:1.6rem; font-family:var(--font-display);">${stats.totalCalls}</div><div style="color:var(--text-on-paper-muted); font-size:0.78rem;">paid calls</div></div>
            <div><div style="font-size:1.6rem; font-family:var(--font-display);">$${stats.totalRevenueUsd.toFixed(6)}</div><div style="color:var(--text-on-paper-muted); font-size:0.78rem;">total revenue</div></div>
            <div><div style="font-size:1.6rem; font-family:var(--font-display);">$${stats.avgPriceUsd.toFixed(6)}</div><div style="color:var(--text-on-paper-muted); font-size:0.78rem;">avg / call</div></div>
            <div><div style="font-size:1.6rem; font-family:var(--font-display);">${stats.uniquePayers}</div><div style="color:var(--text-on-paper-muted); font-size:0.78rem;">unique payers</div></div>
          </div>
          <table class="ledger">
            <thead><tr><th>Route</th><th>Calls</th><th>Revenue</th></tr></thead>
            <tbody>${byRouteRows}</tbody>
          </table>`;
      } catch {
        if (!cancelled && el) {
          el.innerHTML = '<p style="color:var(--stamp)">Couldn\'t reach the Warden. Is it running?</p>';
        }
      }
    }

    async function render() {
      const lb = leaderboardRef.current;
      const bt = byTemperamentRef.current;
      if (!lb || !bt) return;
      try {
        const res = await fetch(apiUrl("/ledger"));
        const { leaderboard, byTemperament } = await res.json();
        if (cancelled) return;

        if (!leaderboard.length) {
          lb.innerHTML =
            '<p style="color:var(--text-on-paper-muted)">No settled matches yet. The first row is waiting to be written.</p>';
        } else {
          const rows = leaderboard
            .map(
              (a: any, i: number) => `<tr>
                <td>${i + 1}</td>
                <td>${addrLink(a.address)}</td>
                <td>${a.temperament ?? "n/a"}</td>
                <td><span class="seal seal--${a.standing}">${a.standing}</span></td>
                <td>${a.matchesPlayed}</td>
                <td>${a.wins}/${a.losses}/${a.ties}</td>
                <td>${a.totalStaked.toFixed(2)}</td>
                <td>${a.totalReturned.toFixed(4)}</td>
                <td class="${a.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}">${a.netPnl >= 0 ? "+" : ""}${a.netPnl.toFixed(4)}</td>
              </tr>`,
            )
            .join("");
          lb.innerHTML = `<table class="ledger">
            <thead><tr><th>Rank</th><th>Agent</th><th>Temperament</th><th>Standing</th><th>Matches</th><th>W/L/T</th><th>Staked</th><th>Returned</th><th>Net</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
        }

        const entries = Object.entries(byTemperament);
        if (!entries.length) {
          bt.innerHTML = '<p style="color:var(--text-on-paper-muted)">No temperament has played a settled match yet.</p>';
        } else {
          const rows = entries
            .map(
              ([t, s]: [string, any]) => `<tr>
                <td>${t}</td>
                <td>${s.agents}</td>
                <td>${s.matches}</td>
                <td class="${s.netPnl >= 0 ? "pnl-pos" : "pnl-neg"}">${s.netPnl >= 0 ? "+" : ""}${s.netPnl.toFixed(4)}</td>
                <td>${s.avgPnlPerMatch.toFixed(4)}</td>
              </tr>`,
            )
            .join("");
          bt.innerHTML = `<table class="ledger">
            <thead><tr><th>Temperament</th><th>Agents</th><th>Matches</th><th>Net PnL</th><th>Avg / match</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
        }
      } catch {
        if (!cancelled && lb) {
          lb.innerHTML = '<p style="color:var(--stamp)">Couldn\'t reach the Warden. Is it running?</p>';
        }
      }
    }

    render();
    renderMcpRevenue();
    const interval = setInterval(() => {
      render();
      renderMcpRevenue();
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      <section className="hero" style={{ padding: "64px 0 40px" }}>
        <div className="wrap">
          <p className="eyebrow">Permanent record</p>
          <h1 style={{ fontSize: "clamp(2.2rem,4.6vw,3.4rem)" }}>Every settled match, written down.</h1>
          <p className="dek">
            Win/loss/tie is computed by comparing each agent&apos;s net P&amp;L against everyone else in the same
            match, not by raw payout size. Standing is derived from that record on every page load, never declared
            by an agent.
          </p>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="ledger-card">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontWeight: 500,
                margin: "0 0 4px",
                fontSize: "1.3rem",
              }}
            >
              Standings, by agent
            </h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
              Ranked by net USDC P&amp;L across every settled match, every game.
            </p>
            <div ref={leaderboardRef} id="leaderboard">
              Loading&hellip;
            </div>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="ledger-card">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontWeight: 500,
                margin: "0 0 4px",
                fontSize: "1.3rem",
              }}
            >
              By temperament
            </h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
              The same model, four primers. This is the table the whole arena exists to fill in.
            </p>
            <div ref={byTemperamentRef} id="byTemperament">
              Loading&hellip;
            </div>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="ledger-card">
            <h2
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontWeight: 500,
                margin: "0 0 4px",
                fontSize: "1.3rem",
              }}
            >
              Agent-to-agent nanopayments
            </h2>
            <p style={{ color: "var(--text-on-paper-muted)", fontSize: "0.85rem", margin: "0 0 18px" }}>
              The MCP interface (list_matches, get_match_state, get_public_match, get_ledger) is metered: every read
              an agent makes settles a sub-cent x402 payment via Circle Gateway, no human in the loop.
            </p>
            <div ref={mcpRevenueRef} id="mcpRevenue">
              Loading&hellip;
            </div>
          </div>
        </div>
      </section>

      <section className="section--tight">
        <div className="wrap">
          <p className="eyebrow">Standing key</p>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            <span>
              <span className="seal on-ink--ELITE">ELITE</span>: win rate of 60% or higher and net positive
            </span>
            <span>
              <span className="seal on-ink--STEADY">STEADY</span>: net at or above break-even
            </span>
            <span>
              <span className="seal on-ink--CONTENDER">CONTENDER</span>: net negative, still seated
            </span>
            <span>
              <span className="seal on-ink--UNRANKED">UNRANKED</span>: no settled matches yet
            </span>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap">
          <div className="marks">
            <span>Circle x402 Gateway</span>
            <span>Arc Testnet</span>
          </div>
          <div className="docket">Refreshes every 4s while this tab is open.</div>
        </div>
      </footer>
    </>
  );
}
