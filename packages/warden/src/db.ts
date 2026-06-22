import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");
const DB_PATH = path.join(DATA_DIR, "nanostakes.db");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

export const db: Database.Database = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS ledger_agents (
    address TEXT PRIMARY KEY,
    temperament TEXT,
    matchesPlayed INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    ties INTEGER NOT NULL DEFAULT 0,
    totalStaked REAL NOT NULL DEFAULT 0,
    totalReturned REAL NOT NULL DEFAULT 0,
    netPnl REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS owned_agents (
    id TEXT PRIMARY KEY,
    ownerWallet TEXT NOT NULL,
    name TEXT NOT NULL,
    temperament TEXT NOT NULL,
    sessionAddress TEXT NOT NULL,
    sessionPrivateKey TEXT NOT NULL,
    walletProvider TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS owned_agents_owner_idx ON owned_agents (ownerWallet);

  CREATE TABLE IF NOT EXISTS mcp_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT NOT NULL,
    payer TEXT NOT NULL,
    amountUsd REAL NOT NULL,
    txn TEXT NOT NULL,
    at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS matches (
    matchId TEXT PRIMARY KEY,
    gameId TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_memory (
    selfAddress TEXT NOT NULL,
    opponentAddress TEXT NOT NULL,
    matchesPlayed INTEGER NOT NULL DEFAULT 0,
    rounds INTEGER NOT NULL DEFAULT 0,
    claimSum REAL NOT NULL DEFAULT 0,
    concessionSum REAL NOT NULL DEFAULT 0,
    escalationCount INTEGER NOT NULL DEFAULT 0,
    lastUpdated TEXT NOT NULL,
    PRIMARY KEY (selfAddress, opponentAddress)
  );
`);

/**
 * Behavior-stat columns (Feature 1: derived reasoning-quality stats) were
 * added after ledger_agents already existed in production. better-sqlite3's
 * bundled SQLite reports 3.49.2 but its parser doesn't actually accept
 * `ADD COLUMN IF NOT EXISTS` (confirmed empirically, not just a version
 * check), so migrate by inspecting existing columns instead and only adding
 * the ones missing — this lets a redeploy migrate an existing DB file in
 * place rather than needing a destructive migration step.
 */
function ensureColumn(table: string, column: string, columnDef: string): void {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!existing.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

ensureColumn("ledger_agents", "behaviorRounds", "behaviorRounds INTEGER NOT NULL DEFAULT 0");
ensureColumn("ledger_agents", "claimSum", "claimSum REAL NOT NULL DEFAULT 0");
ensureColumn("ledger_agents", "concessionSum", "concessionSum REAL NOT NULL DEFAULT 0");
ensureColumn("ledger_agents", "escalationCount", "escalationCount INTEGER NOT NULL DEFAULT 0");
ensureColumn("ledger_agents", "fairShareGapSum", "fairShareGapSum REAL NOT NULL DEFAULT 0");
