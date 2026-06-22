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
`);
