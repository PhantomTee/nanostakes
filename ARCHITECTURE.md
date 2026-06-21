# ARCHITECTURE.md — Nanostakes Arena

> Clean-room design. No code, files, license text, or names are reused from any researched repository. All component names below are original.

## 1. Concept Summary

Nanostakes Arena is a platform where autonomous LLM agents compete head-to-head in a turn-based bargaining game with real USDC stakes, settled entirely through Circle's x402 Gateway on Arc Testnet. Every match action — entry stake, in-round side-payment, payout — is a real on-chain micropayment, not a simulated score. What makes it novel for RFB03 is that the game itself is designed to *produce* a nanopayment network rather than merely *use* one: agents can side-pay each other mid-match to buy information, bribe an opponent to fold, or pay a third "Broker" agent to mediate a dispute, so service discovery, reputation-based pricing, escrow, and emergent broker/cartel behavior all arise from gameplay incentives instead of being bolted on as separate demo features. The product is simultaneously a hackathon submission and a live, replayable economic experiment: same model, different system-prompt "temperament," measurably different real USDC outcomes.

## 2. Core Mechanic Table

| Source repo | Mechanic taken | Adaptation into Nanostakes Arena |
|---|---|---|
| `a2a-x402-arena` | Hub-and-spoke: authoritative state-holder gates every paid action behind an HTTP 402 challenge, decoupled from the agent-to-agent messaging channel | The **Warden** service is sole source of truth for match state and exposes payment-gated endpoints (`stake`, `offer`, `resolve`) using Circle's x402 Gateway facilitator instead of a hand-rolled middleware; game messaging runs over a separate JSON-RPC channel to **Contender** agents |
| `lf-game-theory` | One-paragraph behavioral primer injected into agent system prompt, measured against real settled balances | Each Contender is assigned a **Temperament** (Strategic / Competitive / Cooperative / Neutral) at registration; identical model, different primer, tracked against real Arc Testnet USDC P&L as the core "agent personality has economic weight" demo |
| `synthesis-agent` | ERC-8004-style persistent on-chain identity + escrow-release-on-attestation for job payouts | Persistent **agent identity record** keyed to wallet address (not a custom token) with win/loss/payout history; stake escrow releases only after the Warden signs a result attestation, mirroring the release-on-attestation pattern without needing Solidity escrow contracts |
| `ClawNexus` | Tiered reputation ladder + commission on settled escrow | **Standing** tiers (Bronze→Diamond) computed from settled-match history, gating which stake tiers an agent can enter; the Warden takes a small rake on settled pots, mirrored from ClawNexus's escrow commission |
| `narrativearena_backend` | Named archetype-as-prompt-persona + typed Event log of all agent/economic activity | Combined with Temperament above; every action (bid, side-payment, payout, taunt) is written as a typed **Event** row and streamed live, turning settlement into spectator content |
| `state-of-x402` | Hard data on real x402 transaction sizes (median $0.01, avg $0.12) and market concentration (HHI 168.5) | Justifies designing **per-action micro-stakes** (cents, not lump sums) as consistent with real-world x402 usage, and frames the arena as entering a genuinely open, non-monopolized service market |
| `cowboy` | MCP-server-as-game-interface so any agent framework can plug into a turn-based game without custom integration | Match state and legal actions are exposed via an MCP-compatible interface in addition to JSON-RPC, lowering the bar for third-party agents to enter the arena |
| `ai-agent-games` | Self-contained game module + manifest, auto-discovered by a generic framework | The **Bracket** registry: each game ships as `manifest.json` + a pure `engine` module (`initState`, `applyMove`, `getLegalMoves`, `isTerminal`, `getResult`); the framework never special-cases a game, enabling post-v1 games to be added without touching settlement code |
| `multi-agent-social-deduction` | Hidden private information + public claims + a resolution mechanic that tests whether bluffs survive scrutiny | v1 game (Brinkmanship, see §5) gives each agent a private valuation and a public negotiation phase before a binding sealed decision, so deception and theory-of-mind reasoning are structurally required, not incidental |
| `awesome-LLM-game-agent-papers` | LLMs deceive readily in hidden-role games but track reputation/trust across repeated rounds, and negotiate/ally/betray at near-human level in Diplomacy-style settings | v1 design uses **repeated rounds with persistent per-pair history** and a direct messaging channel between agents specifically because the literature shows this is what elicits visible negotiation, betrayal, and alliance formation rather than degenerate play |

## 3. System Architecture

```
                          ┌─────────────────────────┐
                          │      Concourse (UI)      │
                          │  spectator dashboard,    │
                          │  live event feed, odds   │
                          └────────────▲─────────────┘
                                       │ SSE (Events)
                                       │
┌──────────────┐   JSON-RPC / MCP   ┌──┴───────────────────────┐   x402 / HTTP 402   ┌─────────────────────┐
│  Contender A │◄──────────────────►│          Warden           │◄───────────────────►│  Circle x402 Gateway │
│ (LLM agent)  │   game moves       │  - authoritative state    │   verify + settle    │  (Arc Testnet)       │
└──────────────┘                    │  - Bracket (game registry)│                      │  GatewayWallet,      │
┌──────────────┐   JSON-RPC / MCP   │  - Ledger (identity/rep)  │                      │  USDC token contract │
│  Contender B │◄──────────────────►│  - Event log → Concourse  │                      └─────────────────────┘
└──────────────┘                    └────────────────────────────┘
┌──────────────┐   JSON-RPC / MCP            ▲
│  Broker (opt)│◄────────────────────────────┘
└──────────────┘
```

- **Warden**: stateless-per-match-instance Node/TS service. Holds the authoritative `MatchState`, exposes `POST /match/:id/stake`, `POST /match/:id/offer`, `POST /match/:id/resolve` — every one of these is wrapped behind x402 payment middleware pointed at Circle's Gateway facilitator. Game logic itself is delegated to the active game's `engine` module from the Bracket registry.
- **Contender**: an LLM-driven agent runtime (system prompt = base ruleset + Temperament primer). Talks to the Warden over JSON-RPC for moves/negotiation messages, and over x402-aware HTTP for anything that requires payment (entry stake, side-payment, bribe). Also exposed via a thin MCP wrapper so external agent frameworks can plug in directly.
- **Ledger**: identity/reputation subsystem. Append-only record per wallet address of settled matches, payout outcomes, and "deal-keeping" score (did the agent honor a negotiated side-payment it promised). Read by the Warden for matchmaking and stake-tier gating; read by Contenders (for a fee) as a reputation lookup service.
- **Concourse**: spectator frontend. Subscribes to the Warden's Event stream over Server-Sent Events; renders live match state, USDC flows, and Temperament/Standing badges. Read-only, no write path back to the Warden.
- **Transport choices**: SSE for one-way live event broadcast (simple, no spectator-side write needs); JSON-RPC for agent↔Warden game moves (matches the structured, request/response nature of turns); plain REST + x402 challenge/response for anything monetary (this is the contract x402 itself imposes).

## 4. Payment & Settlement Design

**Onboarding (must happen before any match):**
1. Each Contender's wallet (Circle Developer-Controlled Wallet or self-custodied EOA) holds Arc Testnet USDC (`0x3600000000000000000000000000000000000000`).
2. Wallet calls `approve` on the USDC contract for the GatewayWallet contract (`0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, chain ID `5042002`).
3. Wallet calls `deposit` into GatewayWallet. **No agent can stake, side-pay, or be paid out until this deposit has landed** — this is enforced at registration time by the Warden refusing to admit a Contender to the Bracket until the Ledger shows a confirmed GatewayWallet balance for that address. This is designed into onboarding from day one, not bolted on later.
4. Server-side, the Warden runs a `BatchFacilitatorClient` configured against `https://gateway-api-testnet.circle.com` (explicitly **not** the mainnet default) for all verification and settlement calls.
5. Client-side, Contenders use the `BatchEvmScheme` client to sign and submit x402 payments when challenged.

**Match lifecycle:**
1. Two (or more) Contenders request to join a Bracket match. Warden responds `402 Payment Required` with the entry-stake terms.
2. Each Contender signs and submits its stake via `BatchEvmScheme`; the Warden's `BatchFacilitatorClient` verifies the payment server-side before admitting the Contender into `MatchState`. Stakes accumulate into a match-scoped pot held in the Warden's GatewayWallet sub-balance.
3. During play, any in-game side-payment (bribe, information purchase, broker fee) follows the same 402 challenge/response pattern, scoped to that match and recorded as a typed Event.
4. On match end, the active game's `engine.getResult(state)` returns a deterministic payout split. The Warden signs a result attestation and only then triggers settlement — payouts move out of the pot to winner(s) via Gateway, mirroring the escrow-release-on-attestation pattern from `synthesis-agent` without needing a custom Solidity escrow contract.
5. The Warden takes a small fixed rake from the settled pot (mirrors ClawNexus's commission model) to model a self-sustaining arena economy.
6. Every step above — stake received, offer made, offer settled, payout sent — is written to the Ledger and broadcast as an Event to Concourse, in real USDC, in real time.

## 5. Game Design — v1: Brinkmanship

**The game:** a repeated sealed-offer bargaining game over a contested pot. Each round, every Contender receives a **private valuation** of the round's pot (how much it's actually worth to them, known to no one else) and can: (a) make a public claim about its valuation (true or false), (b) send a private negotiation message to one or more opponents, (c) submit a sealed monetary offer to split or claim the pot, or (d) escalate the stake before the reveal. Offers are revealed simultaneously; mismatched/unreciprocated claims are punished by the resolution rule (a Contender who over-claims and is called on it forfeits a stake penalty). Play continues over several rounds against the *same* opponent(s), so reputation and grudges compound within a match, and per-pair history persists across matches via the Ledger.

**Why this game, specifically:**
- It runs with exactly **two** Contenders for phase 1 (a 2-player sealed-offer round is well-defined) and scales cleanly to N players for phase 2/3 without changing the core engine — satisfying both the "ship something working" constraint and the "maximize emergent economy" goal.
- Per the social-deduction research (`multi-agent-social-deduction`), strategic depth comes from private partial information + public claims with real consequence + a resolution step that tests bluffs. Brinkmanship has all three (private valuation, public claim, simultaneous reveal) without needing Clocktower-level role complexity, which would be unimplementable and unwatchable in a hackathon timeframe.
- Per the survey findings (`awesome-LLM-game-agent-papers`), repeated rounds + a direct messaging channel + persistent per-pair memory are specifically what the literature shows elicits visible negotiation, betrayal, and alliance behavior in LLM agents (Diplomacy-style results) rather than degenerate single-shot play — Brinkmanship is structured around exactly those three levers.
- The negotiation message channel is the natural slot for a **Broker** agent (a third Contender who isn't a party to the pot but is paid by one or both sides to relay/verify offers) — this is the seam where RFB03's "does a broker/market-maker role emerge" question gets a real chance to manifest, since the game gives a broker an actual job (trusted message relay) rather than asking judges to imagine one.

## 6. Agent Identity & Reputation

- **Identity**: each Contender is identified solely by its wallet address (no separate NFT/token needed for v1 — informed by `synthesis-agent`'s self-custodied identity pattern, simplified to avoid Solidity dependencies). The Ledger is the canonical store mapping address → history.
- **Reputation has two layers**, informed by `ClawNexus` and `narrativearena_backend`:
  - **Standing** (Bronze→Diamond): an aggregate tier from win rate and total settled volume, gating which stake tiers a Contender may enter and giving higher tiers preferential matchmaking.
  - **Deal-keeping score**: did the agent honor negotiated side-payments it agreed to mid-match? This is tracked per-pair (not just in aggregate) — a persistent rival/ally ledger keyed by address-pair, recording head-to-head history. This pairwise memory is what lets specific rivalries, grudges, and alliances persist and visibly compound across matches, rather than reputation being a single faceless number.
- Reputation is *readable for a fee*: any Contender can pay a small x402 micropayment to query another agent's Ledger history before negotiating — this is the "service discovery with live pricing" lever from RFB03, made literal: reputation lookups are themselves a priced service inside the arena.

## 7. Emergent Economy Questions (RFB03 observables)

This design is built so the following are directly observable, not assumed:
- **Pricing wars**: do reputation-lookup fees or broker-relay fees trend toward zero as multiple agents compete to offer the same lookup/relay service?
- **Cooperative structures**: do specific address-pairs with high deal-keeping scores start pre-committing to non-aggression (consistently low escalation) across repeated matches — visible directly in the per-pair Ledger?
- **Broker/market-maker emergence**: does any Contender start specializing in the relay/verification role rather than competing directly for pots, and does its income from relay fees rival or exceed direct-competition income?
- **Temperament economics**: does the Strategic primer reliably outperform Cooperative/Neutral in real settled USDC, replicating `lf-game-theory`'s finding in a Circle/Arc-native setting?
- **Reputation-based pricing**: do higher-Standing agents command better terms (lower stake requirements, better split offers accepted) from counterparties, i.e. does reputation actually move price?

## 8. Build Phases

**Phase 1 — Core loop, no polish.**
Warden + Bracket with Brinkmanship's `engine` only. Two Contenders, fixed Neutral temperament, manual GatewayWallet onboarding (approve+deposit scripted, not UI'd). Full stake→play→attest→settle cycle working end-to-end on Arc Testnet with real (testnet) USDC. No Ledger persistence beyond in-memory match state, no Concourse.

**Phase 2 — Reputation, matchmaking, more players.**
Ledger persistence (Standing tiers, per-pair deal-keeping history), Temperament assignment at registration, N-player Brinkmanship (3+ agents) to allow Broker behavior to surface, reputation-lookup-as-a-service micropayment, matchmaking that respects Standing tiers.

**Phase 3 — Spectator UI + stretch mechanics.**
Concourse live dashboard (SSE event feed, Temperament/Standing badges, live USDC flow visualization), MCP-compatible interface for third-party agent frameworks, additional Bracket games via the manifest+engine plugin pattern, leaderboard.

## 9. Decisions (resolved from prior Open Questions)

1. **LLM provider — Groq primary, single fixed model, OpenRouter as same-family failover, Heurist out of the core loop.**
   All Contenders run on one Groq-hosted model (`llama-3.3-70b-versatile`), held constant across every agent so the only variable between agents is the Temperament primer — this is what makes the "personality moves real money" result legible rather than confounded by model differences. Groq was chosen over OpenRouter as primary because, at near-zero spend on all three providers, the deciding factor is free-tier throughput/latency, not cost: Groq's LPU-backed free tier handles the concurrent, multi-turn calls Brinkmanship needs (negotiate → claim → offer → reveal, ×5 rounds, ×N agents) without stalling live in front of judges, whereas OpenRouter's `:free`-tier models sit behind a heavily shared, throttled pool. OpenRouter is kept configured as a manual failover using the same model family, only to cover a Groq rate-limit during the demo, never as a way to diversify models. Heurist is reserved as an optional, non-critical flavor/Broker-agent provider (thematically fitting — a decentralized, pay-per-inference network mirrors the nanopayment narrative) but is not on the path of any required gameplay, since its reliability under live demo conditions is unproven.

2. **Wallet funding — hybrid: one live `approve`+`deposit` on camera, rest pre-funded.**
   Onboarding is the part of the stack that most directly demonstrates real Gateway integration (vs. a mocked transfer), so at least one Contender's GatewayWallet approve+deposit flow runs live during the demo to prove it's real. All other Contenders are pre-funded ahead of time so a flaky testnet RPC during the live segment can't take down the whole demo. Pure-live was rejected as too high-variance for a judged time slot; pure-pre-funded was rejected because it would hide the exact integration depth (GatewayWallet, testnet facilitator URL) that RFB03 judges are evaluating.

3. **Brinkmanship v1 parameters — fixed $0.50–$1 testnet USDC pot per round, 5 rounds per match, linear escalation (+25% stake cap per round).**
   Multiple small rounds beat one large winner-take-all round because repeated interaction is what produces a visible, watchable reputation/trust trend rather than a single data point. Five rounds is enough for a strategy (cooperation, betrayal, escalation) to visibly develop and conclude inside a demo-length window without dragging on or ballooning LLM call cost. Linear escalation beats exponential because exponential escalation tends to force an all-in within round 2–3 and ends the match early, killing the visible-bargaining-arc value that's the point of the game.

4. **Broker mechanic — phase-2-only, but the phase-1 engine interface is already N-player-shaped.**
   A working 2-agent stake→play→settle loop is a complete, demoable artifact on its own; a half-built 3-agent Broker system bolted onto an unproven core risks shipping neither. Broker behavior structurally needs 3+ live agents and a working reputation/relay-fee market to have a real chance of emerging, so it stays in phase 2. The phase-1 negotiation-message interface is built N-player-capable from the start specifically so that turning on the Broker in phase 2 is a config/registration change, not a rewrite of the Warden or engine.

## 10. What's actually shipped, beyond this original design

This section tracks where the live system diverged from (and went beyond) the phases above.

**Matchmaking, fully autonomous.** `packages/warden/src/matchmaking.ts` runs a blind queue: any
agent's driver loop (`driveAgentForever`) calls `/queue/join`, and as soon as enough agents are
waiting the Warden pairs them and creates the match — no human triggers a match. A multi-tenant
scheduler (`runtime.ts`) keeps exactly one driver running per `ACTIVE` owned agent, so N owners' agents
all play concurrently inside one Warden process. This is the actual answer to "matchmaking" from §8 —
it shipped earlier and more completely than originally phased.

**Targeted challenges layered on top of the blind queue** (`packages/warden/src/challenges.ts`). An
owner can target a specific opponent from a public online roster (`GET /agents/online`) instead of
only taking whoever the queue draws. The challenged agent's own driver decides accept/decline via a
deterministic, temperament-based policy (`packages/contender/src/challengePolicy.ts`) — no LLM call
involved in the decision, so it never stalls a match waiting on inference and costs nothing to
evaluate. An accepted challenge reuses the blind queue's own assignment-delivery channel, so no
second polling loop was needed in the driver.

**Cross-chain settlement (CCTP).** Circle's Gateway is itself built on CCTP V2 (burn on source,
attest, mint on destination) for any cross-chain leg. `POST /agents/:id/withdraw` exposes this
directly: an owner can cash an agent's winnings out to Base Sepolia, Ethereum Sepolia, or Avalanche
Fuji instead of only Arc Testnet. Verified live — the burn+attestation leg debits the Arc Gateway
balance correctly; the mint leg needs the destination wallet to already hold native gas there
(Circle's documented requirement, not a bug here).

**EURC as a second asset, not a second stake currency.** `packages/warden/src/eurc.ts` adds a real
EURC balance/withdraw path (Arc Testnet contract `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`,
confirmed against Circle's docs). This is a plain ERC20 transfer, *not* routed through Gateway's x402
batching — `@circle-fin/x402-batching`'s `BatchEvmScheme`/`GatewayWalletBatched` scheme only knows
USDC at the protocol level in the installed SDK version. Match stakes therefore still settle in USDC
only; EURC is something an agent can hold and cash out, not (yet) bet.

**Session key encryption, not Developer-Controlled Wallets.** Agent session private keys are
encrypted at rest (AES-256-GCM, `packages/warden/src/crypto.ts`) rather than stored as plaintext.
This is interim hardening, not the real fix. Circle Developer-Controlled Wallets is the correct
long-term answer (Circle custodies the key; the Warden only ever requests a signature over the API,
never holds raw key material) — Arc Testnet is a supported chain for that product, and the env vars
for it (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_SET_ID`) are already plumbed through
`wallets.ts`'s `provisionSessionWallet()` with a fallback to a local EOA when they're unset (which is
why every agent today gets a local EOA). The blocker: `GatewayClient` in the installed
`@circle-fin/x402-batching` version is hardcoded to sign with a `privateKeyToAccount`-derived local
account — there's no constructor path for a remote signer. Developer-Controlled Wallets sign via a
`signTypedData` API call instead of local key material, which is fundamentally incompatible with how
`GatewayClient` is built today. Using Developer-Controlled Wallets for the parts that actually move
money (stakes, payouts, MCP nanopayments) would mean bypassing `GatewayClient` entirely and
hand-rolling `deposit`/`pay`/`withdraw` against the lower-level `BatchEvmScheme` with a custom signer
that proxies to Circle's API — a real, multi-day rebuild, not a config change. Setup is also gated on
a one-time manual step only the project owner can do: generating and registering a Circle entity
secret against their own Circle Developer account (downloads a recovery file that must be kept as
carefully as the secret itself).
