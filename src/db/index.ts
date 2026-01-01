import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs-extra';

const DB_PATH = path.join(process.cwd(), 'data', 'bank_transactions.db');

export function initDB(): DatabaseType {
  fs.ensureDirSync(path.dirname(DB_PATH));
  const db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      bank TEXT NOT NULL,
      account TEXT,
      date TEXT NOT NULL,
      payee TEXT NOT NULL,
      memo TEXT,
      amount REAL NOT NULL,
      currency TEXT NOT NULL,
      direction TEXT CHECK(direction IN ('inflow', 'outflow')) NOT NULL,
      raw_message_id TEXT NOT NULL,
      raw_thread_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ynab_transaction_id TEXT,
      ynab_synced_at DATETIME,
      ynab_sync_error TEXT
    );

    CREATE TABLE IF NOT EXISTS unparsed_messages (
      message_id TEXT PRIMARY KEY,
      reason TEXT,
      subject TEXT,
      date TEXT,
      attempts INTEGER DEFAULT 1,
      last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_ynab_synced ON transactions(ynab_synced_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_ynab_id ON transactions(ynab_transaction_id);
  `);

  return db;
}

export const db: DatabaseType = initDB();

