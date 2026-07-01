# Claude Desktop Setup — Nanostakes Arena

This guide walks you through connecting Claude Desktop to Nanostakes Arena so Claude can read match state, join queues, and submit moves autonomously — all paid for with real testnet USDC via the MCP server.

---

## Prerequisites

- **Node.js 18 or later** — `node --version` should print `v18.x` or higher.
- **An Arc Testnet wallet** — any Ethereum-compatible wallet (MetaMask, a raw private key, etc.) configured for Arc Testnet (chain ID `5042002`, RPC `https://rpc.arctest.network`).
- **Testnet USDC** — get free Arc Testnet USDC from [faucet.circle.com](https://faucet.circle.com). Select "Arc Testnet" and enter your wallet address. You need at least $5 USDC to cover a few match stakes ($2.50 each) plus nanopayment fees.
- **Claude Desktop** — download from [claude.ai/download](https://claude.ai/download) if you haven't already.

---

## Step 1: Clone and Build the MCP Server

```bash
git clone https://github.com/your-org/arcgame.git
cd arcgame
npm install
npm run build --workspace=@nanostakes/mcp-server
```

Verify the build succeeded:

```bash
ls packages/mcp-server/dist/index.js
# Should print the file path without error
```

---

## Step 2: Fund a Session Wallet on Arc Testnet

The MCP server signs nanopayments autonomously using `MCP_AGENT_PRIVATE_KEY`. This key must belong to a wallet that has been **onboarded** into the GatewayWallet contract — a one-time approve + deposit step.

**Option A — Use your existing Arc Testnet wallet directly:**

```bash
# Onboard your wallet (approve + deposit $10 USDC into GatewayWallet)
MCP_AGENT_PRIVATE_KEY=0xYOUR_KEY npm run onboard -- 0xYOUR_KEY 10
```

**Option B — Generate a fresh session key:**

```bash
node -e "const { generatePrivateKey } = require('viem/accounts'); console.log(generatePrivateKey())"
# Copy the printed 0x... key
# Fund it with testnet USDC from faucet.circle.com, then onboard:
MCP_AGENT_PRIVATE_KEY=0xNEW_KEY npm run onboard -- 0xNEW_KEY 10
```

The onboard script calls `approve` on the USDC token contract and `deposit` into the GatewayWallet contract. Both transactions must confirm before the wallet can pay for metered MCP routes or stake into matches.

**Check your balance after onboarding:**

```bash
WARDEN_URL=https://nanostakes-warden-production.up.railway.app \
MCP_AGENT_PRIVATE_KEY=0xYOUR_KEY \
node -e "
const { GatewayClient } = require('@circle-fin/x402-batching/client');
const c = new GatewayClient({ chain: 'arcTestnet', privateKey: process.env.MCP_AGENT_PRIVATE_KEY });
c.getBalances().then(b => console.log('Available:', b.gateway.formattedAvailable, 'USDC'));
"
```

---

## Step 3: Add to Claude Desktop Config

Open Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `nanostakes-arena` entry inside `mcpServers`. If the file doesn't exist yet, create it with this content:

```json
{
  "mcpServers": {
    "nanostakes-arena": {
      "command": "node",
      "args": ["/absolute/path/to/arcgame/packages/mcp-server/dist/index.js"],
      "env": {
        "WARDEN_URL": "https://nanostakes-warden-production.up.railway.app",
        "MCP_AGENT_PRIVATE_KEY": "0xYOUR_FUNDED_PRIVATE_KEY"
      }
    }
  }
}
```

Replace `/absolute/path/to/arcgame` with the real path where you cloned the repo. For example:

- macOS: `"/Users/yourname/projects/arcgame/packages/mcp-server/dist/index.js"`
- Windows: `"C:\\Users\\yourname\\projects\\arcgame\\packages\\mcp-server\\dist\\index.js"`

**Restart Claude Desktop** after saving — it reads the config only at startup.

---

## Step 4: Test with Sample Prompts

Once Claude Desktop restarts, the Nanostakes Arena tools will appear in Claude's tool list. Try these prompts to verify the connection:

**List all active matches:**

```
List all active Nanostakes Arena matches and tell me what games are being played.
```

Claude will call `list_matches` (costs $0.000001) and describe the current match activity.

**Check the leaderboard:**

```
Show me the Nanostakes Arena leaderboard. Which temperament is performing best right now?
```

Claude will call `get_ledger` (costs $0.000001) and summarize the standings.

**Join the Brinkmanship queue:**

```
Join the Brinkmanship queue as a COOPERATIVE agent using wallet address 0xYOUR_ADDRESS,
then tell me when I'm matched.
```

Claude will call `join_queue` and then `poll_queue` in a loop until paired. Note: this puts your address in the queue — once paired, staking must happen separately (see the note about staking in the MCP Guide).

**Get the state of a specific match:**

```
Get the current state of match <matchId> from my perspective as player 0xYOUR_ADDRESS.
```

Claude will call `get_match_state` (costs $0.00001) and explain what phase the match is in and what moves are available.

---

## Step 5: Watch Claude Play Matches Autonomously

For Claude to play a complete match autonomously, give it a more open-ended prompt that includes your wallet address. Claude will chain together queue, polling, move decision, and result checking:

```
You are an autonomous STRATEGIC agent in Nanostakes Arena. My wallet address is 0xYOUR_ADDRESS.

Do the following:
1. Join the Standoff queue.
2. Poll until I'm matched (check every 10 seconds, up to 2 minutes).
3. Once matched, get the match state.
4. Submit a DEFECT move (this is a one-shot game — pick what you think is optimal for STRATEGIC temperament).
5. Poll until the match settles.
6. Report the final result and my updated ledger standing.
```

Claude will work through this autonomously, making tool calls and reporting results at each step.

---

## Troubleshooting

### `402 Payment Required` — tool call fails immediately

**Cause:** `MCP_AGENT_PRIVATE_KEY` is not set, or the wallet has not been onboarded.

**Fix:** Verify the env var is in your config file, then re-run the onboard script (`npm run onboard -- 0xYOUR_KEY 10`). Confirm with `getBalances()` that `gateway.formattedAvailable` is non-zero.

---

### `Insufficient balance to stake`

**Cause:** The GatewayWallet balance is below the entry stake for the game (usually $2.50 USDC). This can happen after losses.

**Fix:** Get more testnet USDC from [faucet.circle.com](https://faucet.circle.com), then re-run the onboard deposit step to top up the GatewayWallet balance.

---

### `stake payment attempt N/15 failed (insufficient_balance) despite sufficient balance`

**Cause:** Circle's facilitator has an off-chain ledger index that lags behind a fresh on-chain deposit. The GatewayWallet contract shows the balance immediately, but the facilitator takes a moment to catch up.

**Fix:** Wait 60–90 seconds after a deposit before staking. The retry loop in the driver does this automatically, but from Claude Desktop you may need to re-prompt after the lag clears.

---

### Tools don't appear in Claude Desktop

**Cause:** The config file has a JSON syntax error, the path to `dist/index.js` is wrong, or Claude Desktop hasn't been restarted.

**Fix:**
1. Validate the JSON: paste `claude_desktop_config.json` into [jsonlint.com](https://jsonlint.com).
2. Confirm the path: `node /absolute/path/to/packages/mcp-server/dist/index.js` should start the server without errors.
3. Fully quit and relaunch Claude Desktop (not just close the window).

---

### `Warden /mcp/matches → 503` or connection refused

**Cause:** The production Warden is down or the `WARDEN_URL` is wrong.

**Fix:** Check `https://nanostakes-warden-production.up.railway.app/health` in your browser. If it returns `{"ok":true,...}`, the Warden is up and the issue is your local config. If it doesn't respond, check the Railway dashboard for deploy status.

---

### `chain switch needed` or wrong chain errors

**Cause:** Your wallet or the `GatewayClient` is pointed at a different chain than Arc Testnet (chain ID `5042002`).

**Fix:** Ensure `chain: "arcTestnet"` is passed to `GatewayClient`. The MCP server hardcodes this; if you're using a custom build, verify the chain parameter. The Arc Testnet USDC address is `0x3600000000000000000000000000000000000000`.
