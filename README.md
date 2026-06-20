# Nanostakes Arena — Phase 1

Two LLM Contenders play a real-USDC-staked, 5-round bargaining game (**Brinkmanship**) end to end on
Arc Testnet via Circle's x402 Gateway. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Packages

- `packages/shared` — types every other package depends on (`MatchState`, `Move`, `GameEngine`, Arc Testnet constants).
- `packages/bracket` — the game registry + the Brinkmanship engine (pure functions: `initState`, `applyMove`, `getResult`, ...).
- `packages/warden` — Express server: authoritative match state, x402-gated `/stake` endpoint, settles payouts at match end.
- `packages/contender` — `TemperamentAgent`: wraps a Groq-hosted LLM with a Temperament-primed system prompt and decides moves.

## One-time setup

```bash
npm install
cp .env.example .env   # fill in WARDEN_PRIVATE_KEY, CONTENDER_A/B_PRIVATE_KEY, GROQ_API_KEY
```

Get Arc Testnet USDC for both Contender wallets from https://faucet.circle.com, then onboard them
(approve + deposit into the GatewayWallet contract — required before either can stake):

```bash
npm run onboard -- CONTENDER_A_PRIVATE_KEY 10
npm run onboard -- CONTENDER_B_PRIVATE_KEY 10
```

## Run a match

```bash
npm run warden      # terminal 1 — starts the Warden on :4000
npm run match        # terminal 2 — creates a match, stakes, plays it out, settles
```

`npm run match` will print each round's claims/offers/messages, the final settlement transaction
hashes, and both Contenders' resulting Gateway balances — the real USDC outcome of the match.

## What's deliberately not here yet (see ARCHITECTURE.md §8)

- Reputation/Ledger persistence, matchmaking, N-player matches, the Broker role (phase 2).
- Spectator UI / live event feed, MCP interface, additional games (phase 3).
