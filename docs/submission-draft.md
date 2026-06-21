# Hackathon submission draft (RFB03)

## Demo video script (~3 minutes)

**0:00–0:20 — Hook**
Screen: live site homepage.
VO: "These two agents are about to negotiate over a real pot of testnet USDC. Same model,
same prompt template, one difference: temperament. Watch what that one variable does to
the outcome."

**0:20–0:50 — The mechanic**
Screen: start a live Brinkmanship match (`npm run match` or trigger from the UI), show the
round-by-round claims/offers/messages streaming in.
VO: "Each agent gets a private valuation of the pot — what it's actually worth to them,
hidden from the other side. They can lie about it, make offers, send messages, escalate.
Every claim, offer, and side-payment is a real on-chain transfer through Circle's Gateway
on Arc Testnet, not a logged number — watch the balances move."

**0:50–1:20 — Settlement, on camera**
Screen: match resolves, show the settlement transaction hashes and both wallets' resulting
Gateway balances.
VO: "That's a real settled transfer, both directions, sub-second, no invoice, no card. The
Warden — our authoritative match server — signs the result and Gateway moves the money."

**1:20–1:50 — The economics, not just the demo**
Screen: cut to `/ledger`, lead with the podium, then scroll to the temperament-grouped table.
VO: "We're not just running one match, we're running an experiment: same underlying model,
four temperaments, tracked against real USDC P&L over many matches. [Name the temperament
currently winning] is currently ahead — that's a measurable claim, not a vibe."

**1:50–2:30 — The part that makes this a nanopayment story, not just a game**
Screen: run `scripts/scout-agent.ts` live in a terminal, show it paying for `/mcp/ledger`
and `/mcp/matches` and printing its decision.
VO: "Here's a third kind of agent — not a player, a scout. It has no relationship with us,
no API key, no account. It pays $0.000001 per call, agent to agent, to read the ledger and
decide what to watch next. That's the actual product: priced machine-to-machine data access,
metered in nanopayments, with the price tied to how decision-relevant the data is — global
reads are cheap, match-specific reads an agent needs to act on are 10x more."

**2:30–2:50 — How to plug in**
Screen: README "Bring your own agent (MCP)" section.
VO: "Any MCP-aware framework can do the same thing — point it at our live Warden, give it
a funded wallet, and it can read match state and the ledger autonomously. That's in the
README, live right now."

**2:50–3:00 — Close**
Screen: site URL.
VO: "Nanostakes Arena. Negotiation, settled on-chain."

## Submission form answers

**Project name:** Nanostakes Arena

**One-line tagline:** Autonomous agents bargain over a real on-chain pot, and a metered MCP
interface lets any other agent pay sub-cent nanopayments to read the results.

**Problem:** Most "agent economy" demos either fake the money (a leaderboard score) or fake
the agent-to-agent part (a human-facing API with a signup flow). Neither demonstrates what
machine-to-machine payment actually changes about how agents behave or what data is worth.

**Solution:** Two LLM agents with private valuations and fixed personalities negotiate over
a real testnet USDC pot, settled end-to-end through Circle's x402 Gateway — every stake and
payout is an actual transfer. The same Warden server that runs the game also exposes its
match data over a metered MCP interface: any agent with a funded wallet, no signup, can pay
sub-cent nanopayments to read match state or the cross-match reputation ledger. Pricing is
two-tiered and tied to decision relevance, not arbitrary: $0.000001 for global discovery
reads, $0.00001 for match-specific reads an agent needs to act on.

**Tech stack:** TypeScript/Node (Warden, Contender, MCP server), Circle x402 Gateway +
BatchEvmScheme on Arc Testnet, Circle's Gateway-as-CCTP for cross-chain withdraw (Base Sepolia,
Ethereum Sepolia, Avalanche Fuji), a plain ERC20 path for EURC as a second held/withdrawable
asset, Groq-hosted LLMs (OpenRouter failover), SQLite (better-sqlite3) for ledger/agent/payment
persistence with AES-256-GCM-encrypted session wallet keys at rest, a fully autonomous blind
matchmaking queue plus targeted challenges with a deterministic temperament-based accept/decline
policy, a multi-tenant runtime that drives every owner's active agents concurrently in one
process, Next.js frontend, Railway + Vercel deploys.

**What's next:** Circle Developer-Controlled Wallets, so the Warden never holds raw key
material at all (blocked today because the installed `@circle-fin/x402-batching` SDK's
`GatewayClient` only signs with a local private key — see ARCHITECTURE.md §10 for the full
constraint); EURC-denominated match stakes, once that SDK supports a non-USDC asset at the
protocol level; real external MCP callers beyond our own demo scout agent (we just shipped
the quickstart — see README); wiring the dormant Standoff game into the autonomous driver, not
just manual API calls; an N-player Bracket extension and a Broker role that gets paid to
mediate disputes, both designed for in ARCHITECTURE.md but not yet built.

**Live demo URL:** https://nanostakes.vercel.app
**Repo:** https://github.com/PhantomTee/nanostakes
