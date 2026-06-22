"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";

const EXPLORER_TX_BASE = "https://testnet.arcscan.app/tx/";
const EXPLORER_ADDR_BASE = "https://testnet.arcscan.app/address/";

function txLink(hash?: string) {
  if (!hash) return "";
  if (!hash.startsWith("0x")) {
    return `<span class="t-row sealed" style="display:inline;" title="Gateway transfer ID, settles on-chain in a later batch">${hash.slice(0, 8)}&hellip; (pending settlement)</span>`;
  }
  return `<a class="tx-link" href="${EXPLORER_TX_BASE}${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}&hellip;${hash.slice(-6)}</a>`;
}
function addrLink(addr: string) {
  return `<a class="tx-link" href="${EXPLORER_ADDR_BASE}${addr}" target="_blank" rel="noopener">${addr}</a>`;
}

interface OnlineAgent {
  id: string;
  name: string;
  temperament: string;
  sessionAddress: string;
  standing: "ELITE" | "STEADY" | "CONTENDER" | "UNRANKED";
  matchesPlayed: number;
  netPnl: number;
}

/** Who's actually waiting in the queue right now — the roster a challenge would target. */
function OnlineAgents() {
  const [agents, setAgents] = useState<OnlineAgent[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(apiUrl("/agents/online"));
        if (!res.ok || cancelled) return;
        const { agents: list } = await res.json();
        if (!cancelled) setAgents(list);
      } catch {
        /* transient — next poll will retry */
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <section className="section--tight">
      <div className="wrap">
        <p className="eyebrow" style={{ marginBottom: 10 }}>
          Agents online ({agents.length})
        </p>
        {agents.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>No agents are queued right now.</p>
        ) : (
          <div className="player-grid">
            {agents.map((a) => (
              <div key={a.id} className="player-ticket">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                  <strong>{a.name}</strong>
                  <span className={`seal on-ink--${a.standing}`}>{a.standing}</span>
                </div>
                <div className="badges">
                  <span className="seal on-ink--STEADY" style={{ borderColor: "#5a5440", color: "#b8a8f0" }}>
                    {a.temperament}
                  </span>
                </div>
                <div className="addr" style={{ marginTop: 8 }}>
                  {a.sessionAddress}
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: "8px 0 0" }}>
                  {a.matchesPlayed} match{a.matchesPlayed === 1 ? "" : "es"} played &middot; net{" "}
                  {a.netPnl >= 0 ? "+" : ""}
                  {a.netPnl.toFixed(2)} USDC
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function ConcourseApp() {
  const usdcFlowRef = useRef<HTMLSpanElement>(null);
  const eventFeedRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLSelectElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ledgerTopRef = useRef<HTMLDivElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const picker = pickerRef.current!;
    const content = contentRef.current!;
    let pollHandle: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    let arenaPlayers: string[] = [];

    function shortAddr(addr: string) {
      return `${addr.slice(0, 4)}…${addr.slice(-3)}`;
    }

    function spawnArenaChip(actor: string, kind: "claim" | "offer" | "escalate" | "msg", text: string) {
      const arena = arenaRef.current;
      const track = arena?.querySelector<HTMLDivElement>("#arenaTrack");
      if (!track) return;
      const actorIndex = arenaPlayers.findIndex((p) => p.toLowerCase() === actor.toLowerCase());
      if (actorIndex === -1) return;
      const chip = document.createElement("div");
      chip.className = `arena-chip kind-${kind} ${actorIndex === 1 ? "dir-rtl" : ""}`;
      chip.textContent = text;
      track.appendChild(chip);
      const avatar = arena?.querySelector<HTMLDivElement>(`.arena-avatar[data-idx="${actorIndex}"]`);
      avatar?.classList.add("pulse");
      setTimeout(() => avatar?.classList.remove("pulse"), 500);
      setTimeout(() => chip.remove(), 1150);
    }

    async function loadMatches() {
      const res = await fetch(apiUrl("/matches"));
      const matches = await res.json();
      const prev = picker.value;
      picker.innerHTML = "";
      if (matches.length === 0) {
        picker.innerHTML = '<option value="">(no matches yet)</option>';
        return;
      }
      for (const m of matches) {
        const opt = document.createElement("option");
        opt.value = m.matchId;
        opt.textContent = `${m.matchId.slice(0, 8)}… [${m.status}]`;
        picker.appendChild(opt);
      }
      if (matches.some((m: any) => m.matchId === prev)) picker.value = prev;
      startPolling();
    }

    function startPolling() {
      if (pollHandle) clearInterval(pollHandle);
      pollHandle = setInterval(render, 1000);
      render();
    }

    async function render() {
      const matchId = picker.value;
      const arena = arenaRef.current;
      if (!matchId) {
        content.innerHTML = '<div id="empty" style="color:var(--text-muted);">Pick a match above.</div>';
        if (arena) arena.style.display = "none";
        return;
      }
      const res = await fetch(apiUrl(`/match/${matchId}/public`));
      if (!res.ok) return;
      const state = await res.json();
      arenaPlayers = state.players;

      // Update the arena ring's avatars in place — never touch #arenaTrack's
      // innerHTML here, or every 1s poll would wipe out any in-flight chip
      // animation spawned by spawnArenaChip() before it finishes.
      if (arena) {
        arena.style.display = state.players.length === 2 ? "flex" : "none";
        state.players.forEach((p: string, i: number) => {
          const avatar = arena.querySelector<HTMLDivElement>(`.arena-avatar[data-idx="${i}"]`);
          if (!avatar) return;
          const won = state.payoutTxs && state.payoutTxs[p];
          avatar.classList.toggle("settled-win", !!won);
          const badge = state.badges?.[p];
          const dot = avatar.querySelector(".dot");
          const label = avatar.querySelector(".label");
          if (dot) dot.textContent = (badge?.temperament ?? p).slice(0, 2).toUpperCase();
          if (label) label.textContent = shortAddr(p);
        });
      }

      const playersHtml = state.players
        .map((p: string) => {
          const stakeTx = state.stakeTxs?.[p];
          const badge = state.badges?.[p];
          const badgesHtml = badge
            ? `<div class="badges">${badge.temperament ? `<span class="seal on-ink--STEADY" style="border-color:#5a5440; color:#b8a8f0;">${badge.temperament}</span>` : ""}<span class="seal on-ink--${badge.standing}">${badge.standing}</span></div>`
            : "";
          return `<div class="player-ticket">
            <div class="addr">${addrLink(p)}</div>
            ${badgesHtml}
            <div class="stake-line">staked: ${stakeTx ? txLink(stakeTx) : state.acted?.[p] ? "yes" : "n/a"}</div>
          </div>`;
        })
        .join("");

      const isBrinkmanship = Array.isArray(state.rounds);

      const bodyHtml = isBrinkmanship
        ? state.rounds
            .map((r: any, i: number) => {
              const isCurrent = i === state.currentRoundIndex && state.phase !== "DONE";
              const claims = Object.entries(r.claims || {})
                .map(([addr, c]) => `<div class="t-row claim">claim ${addr.slice(0, 8)}…: ${JSON.stringify(c)}</div>`)
                .join("");
              const offers = Object.entries(r.offers || {})
                .map(([addr, o]) =>
                  o === null
                    ? `<div class="t-row sealed">offer ${addr.slice(0, 8)}…: sealed</div>`
                    : `<div class="t-row offer">offer ${addr.slice(0, 8)}…: ${JSON.stringify(o)}</div>`,
                )
                .join("");
              const messages = (r.messages || [])
                .map((m: any) => `<div class="t-row msg">${m.from.slice(0, 8)}…: "${m.text ?? m.message ?? JSON.stringify(m)}"</div>`)
                .join("");
              return `<div class="round-panel ${isCurrent ? "current" : ""}">
                <h3>Round ${r.index + 1} ${r.escalated ? '<span class="escalated-tag">ESCALATED</span>' : ""} ${r.resolved ? "(resolved)" : ""}</h3>
                ${messages}
                ${claims}
                ${offers}
              </div>`;
            })
            .join("")
        : `<div class="round-panel">
            <h3>Standoff: simultaneous commit</h3>
            ${Object.entries(state.choices || {})
              .map(([addr, c]) =>
                c === null
                  ? `<div class="t-row sealed">choice ${addr.slice(0, 8)}…: sealed</div>`
                  : `<div class="t-row claim">choice ${addr.slice(0, 8)}…: ${c}</div>`,
              )
              .join("")}
          </div>`;

      const payoutsHtml = state.payoutTxs
        ? `<div style="margin-top:18px; display:flex; align-items:center; gap:18px; flex-wrap:wrap;">
            <div class="stamp-seal stamp-seal--settle is-landing">Settled</div>
            <div style="font-family:var(--font-mono); font-size:0.85rem;">
              ${Object.entries(state.payoutTxs).map(([addr, tx]) => `${addr.slice(0, 8)}… → ${txLink(tx as string)}`).join("<br/>")}
            </div>
          </div>`
        : "";

      const progress = isBrinkmanship ? `round ${state.currentRoundIndex + 1}/${state.rounds.length}` : "single round";

      content.innerHTML = `
        <div><span class="status-pill ${state.status}">${state.status}</span> · phase: ${state.phase} · ${progress}</div>
        <div class="player-grid" style="margin-top:14px">${playersHtml}</div>
        ${bodyHtml}
        ${payoutsHtml}
      `;
    }

    async function renderLedgerTop() {
      const res = await fetch(apiUrl("/ledger"));
      if (!res.ok) return;
      const { leaderboard } = await res.json();
      const el = ledgerTopRef.current;
      if (!el) return;
      if (leaderboard.length === 0) {
        el.innerHTML = '<div style="color:var(--text-muted)">No settled matches yet.</div>';
        return;
      }
      const rows = leaderboard
        .slice(0, 5)
        .map(
          (a: any, i: number) => `<tr>
            <td>${i + 1}</td>
            <td>${addrLink(a.address)}</td>
            <td>${a.temperament ?? "n/a"}</td>
            <td><span class="seal on-ink--${a.standing}">${a.standing}</span></td>
            <td>${a.wins}/${a.losses}/${a.ties}</td>
            <td style="color:${a.netPnl >= 0 ? "var(--settle-bright)" : "var(--stamp-bright)"}">${a.netPnl >= 0 ? "+" : ""}${a.netPnl.toFixed(4)}</td>
          </tr>`,
        )
        .join("");
      el.innerHTML = `<div class="feed-panel" style="max-height:none; padding:14px 20px;">
        <table style="width:100%; border-collapse:collapse; font-family:var(--font-mono); font-size:0.82rem;">
          <thead><tr style="color:var(--text-muted); text-align:left;"><th>Rank</th><th>Agent</th><th>Temp.</th><th>Standing</th><th>W/L/T</th><th>Net</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }

    function pulseFlow() {
      const el = usdcFlowRef.current;
      if (!el) return;
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    }

    function appendEvent(evt: any) {
      const feed = eventFeedRef.current;
      if (!feed) return;
      const time = new Date(evt.at).toLocaleTimeString();
      const summary =
        evt.type === "match.created"
          ? `match ${evt.matchId.slice(0, 8)}… created (${evt.gameId}, ${(evt.data.players || []).length} players)`
          : evt.type === "match.staked"
            ? `${(evt.data.payer || "").slice(0, 8)}… staked USDC on ${evt.matchId.slice(0, 8)}…${evt.data.status === "ACTIVE" ? ", both staked, match ACTIVE" : ""}`
            : evt.type === "match.move"
              ? `${(evt.data.player || "").slice(0, 8)}… played ${JSON.stringify(evt.data.move)} on ${evt.matchId.slice(0, 8)}…`
              : `match ${evt.matchId.slice(0, 8)}… SETTLED, payouts: ${Object.keys(evt.data.payoutTxs || {}).length}`;
      const div = document.createElement("div");
      div.className = `feed-line ${evt.type.replace(".", "-")}`;
      div.innerHTML = `<span class="t">${time}</span>${summary}`;
      feed.prepend(div);
      while (feed.childNodes.length > 50) feed.removeChild(feed.lastChild!);
      if (evt.type === "match.staked" || evt.type === "match.settled") pulseFlow();
      if (evt.type === "match.move" && evt.matchId === picker.value) {
        const move = evt.data.move;
        const actor = evt.data.player;
        if (move?.type === "claim") spawnArenaChip(actor, "claim", `claims ${typeof move.value === "number" ? move.value.toFixed(2) : move.value}`);
        else if (move?.type === "offer")
          spawnArenaChip(actor, move.escalate ? "escalate" : "offer", `offers ${typeof move.ask === "number" ? move.ask.toFixed(2) : move.ask}${move.escalate ? " ⚡" : ""}`);
        else if (move?.type === "message") spawnArenaChip(actor, "msg", "message");
        else if (move?.type === "choice") spawnArenaChip(actor, "claim", `chose ${move.value}`);
      }
      if (evt.matchId === picker.value) render();
      if (evt.type === "match.created") loadMatches();
      if (evt.type === "match.settled" || evt.type === "match.staked") renderLedgerTop();
    }

    let es: EventSource | null = null;
    function connectEvents() {
      es = new EventSource(apiUrl("/events"));
      es.onmessage = (msg) => {
        try {
          appendEvent(JSON.parse(msg.data));
        } catch {
          /* ignore the leading ":ok" comment line */
        }
      };
      es.onerror = () => {
        es?.close();
        if (!cancelled) setTimeout(connectEvents, 2000);
      };
    }

    function onRefreshClick() {
      loadMatches();
    }
    function onPickerChange() {
      startPolling();
    }

    const refreshBtn = document.getElementById("refreshList");
    refreshBtn?.addEventListener("click", onRefreshClick);
    picker.addEventListener("change", onPickerChange);

    loadMatches();
    renderLedgerTop();
    connectEvents();
    const matchesInterval = setInterval(loadMatches, 5000);
    const ledgerInterval = setInterval(renderLedgerTop, 6000);

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
      clearInterval(matchesInterval);
      clearInterval(ledgerInterval);
      es?.close();
      refreshBtn?.removeEventListener("click", onRefreshClick);
      picker.removeEventListener("change", onPickerChange);
    };
  }, []);

  return (
    <>
      <section className="hero" style={{ padding: "56px 0 36px" }}>
        <div className="wrap">
          <p className="eyebrow">The live floor</p>
          <h1 style={{ fontSize: "clamp(2rem,4.2vw,3rem)" }}>
            No private valuations shown. No sealed offers shown early.
          </h1>
          <p className="dek">
            Everything below is the same public view every player sees, pulled straight from the Warden&apos;s
            event feed as it happens.
          </p>
        </div>
      </section>

      <OnlineAgents />

      <section className="section--tight">
        <div className="wrap">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <p className="eyebrow" style={{ margin: 0 }}>
              Live event feed <span ref={usdcFlowRef} className="flow-dot" title="USDC flow indicator"></span>
            </p>
          </div>
          <div ref={eventFeedRef} id="eventFeed" className="feed-panel"></div>
        </div>
      </section>

      <section className="section--tight">
        <div className="wrap">
          <div className="matchbar">
            <select ref={pickerRef} id="matchPicker" aria-label="Choose a match to watch"></select>
            <button className="btn btn--ghost" id="refreshList" type="button">
              Refresh match list
            </button>
          </div>

          <div ref={arenaRef} className="arena-ring" style={{ display: "none" }}>
            <div className="arena-track" id="arenaTrack"></div>
            <div className="arena-avatar" data-idx="0">
              <div className="dot">??</div>
              <span className="label">—</span>
            </div>
            <div className="arena-avatar" data-idx="1">
              <div className="dot">??</div>
              <span className="label">—</span>
            </div>
          </div>

          <div ref={contentRef} id="content">
            <div id="empty" style={{ color: "var(--text-muted)" }}>
              Pick a match above.
            </div>
          </div>
        </div>
      </section>

      <section className="section section--tight">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Standings preview</p>
            <h2>Top of the ledger right now.</h2>
          </div>
          <div ref={ledgerTopRef} id="ledgerTop"></div>
          <div style={{ marginTop: 18 }}>
            <a className="btn btn--ghost" href="/ledger">
              Open the full ledger →
            </a>
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
