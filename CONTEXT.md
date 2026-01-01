# Bank Sync to YNAB - Context & Rules

## Project Goal
A Node.js application that runs as a daily cronjob to automatically scan Gmail for Dominican Republic bank notifications (specifically BHD), parses them, and syncs transactions directly to YNAB via the API.

## Tech Stack
- **Language**: TypeScript / Node.js
- **Database**: SQLite (`better-sqlite3`)
- **Gmail Integration**: `googleapis` (OAuth2)
- **YNAB Integration**: `ynab` SDK
- **HTML Parsing**: `cheerio`
- **Date Handling**: `date-fns`

## Core Architecture

### 1. Sync (`src/cli/commands.ts`)
- Connects to Gmail
- Uses `ParserRegistry` to find a matching parser for each email
- Parses email into a normalized `Transaction` object
- Applies `RulesEngine` for cleanup (e.g., Payee renaming)
- Saves to SQLite (skips duplicates via unique ID fingerprint)
- **Automatically syncs to YNAB** via API
- **Smart Lookback**: First run checks 180 days; subsequent runs check 30 days

### 2. Parsers (`src/parsers/`)
- **BHDParser (`src/parsers/bhd.ts`)**:
    - Handles "Notificación de Transacciones" (HTML table parsing)
    - Handles "Transferencias entre productos" / "Transferencias a terceros"
    - **Logic**:
        - **Inflow**: If destination is one of my accounts (`1610`, `3709`, `0014`, `9508`) or payee indicates reversal/credit
        - **Outflow**: If origin is my account and destination is not
        - **Account**: Extracted from email (last 4 digits)

### 3. YNAB Integration (`src/ynab/client.ts`)
- **YNABClient**: Handles authentication and transaction creation
- **Configuration** (`src/config/ynab.ts`): Loads YNAB API token, budget ID, and account mappings from `ynab-config.json`
- **Account Mappings**: Maps bank account numbers (e.g., `1610`) to YNAB account IDs
- **Transaction Creation**: Converts amounts to milliunits (YNAB format: amount * 1000)
- **Batch Creation**: Creates multiple transactions efficiently
- **Error Tracking**: Stores YNAB transaction IDs and sync errors in database

### 4. Database Schema
- **transactions**: Stores all parsed transactions with YNAB sync status
    - `ynab_transaction_id`: YNAB transaction ID after successful sync
    - `ynab_synced_at`: Timestamp of successful sync
    - `ynab_sync_error`: Error message if sync failed
- **processed_messages**: Tracks which emails have been processed (deduplication)
- **unparsed_messages**: Stores emails that couldn't be parsed (for debugging)

## Operational Rules (for AI)

1. **Preserve Deduplication**: Do not change the ID fingerprint generation logic (`${name}:${account}:${date}:${amount}:${payee}:${direction}`) without a migration plan, or old transactions will show up as new.

2. **YNAB Sync**:
   - Transactions are automatically synced to YNAB after being parsed
   - Failed syncs are tracked in the database and can be retried with `retry-ynab` command
   - Account mappings must be configured in `ynab-config.json`

3. **Amount Format**: YNAB uses milliunits (amount * 1000). Always convert amounts before sending to YNAB API.

4. **Parsers**: When adding new banks, follow the `Parser` interface and register in `src/parsers/registry.ts`.

5. **Privacy**: Do not upload `token.json`, `credentials.json`, `ynab-config.json`, or `data/` to remote repositories.

6. **Cronjob Design**: The app is designed to run daily. It automatically handles:
   - Looking back appropriate time periods
   - Deduplication
   - Error recovery
   - YNAB sync status tracking

## Key Files

- `src/ynab/client.ts`: YNAB API client for creating transactions
- `src/config/ynab.ts`: YNAB configuration loader
- `src/parsers/bhd.ts`: Main logic for BHD parsing (HTML scraping, direction logic)
- `src/cli/commands.ts`: Sync and YNAB sync orchestration
- `rules.json`: User-defined rules for Payee normalization
- `ynab-config.json`: YNAB API credentials and account mappings (user-created)

## Current Account Mapping

- **1610**: Visa Mi País (Credit) → Maps to YNAB account ID in config
- **3709**: Visa Débito Oro (Debit) → Maps to YNAB account ID in config
- **0014**: Savings (Linked to 3709) → Maps to YNAB account ID in config
- **9508**: Visa Mi País (Old/Other) → Maps to YNAB account ID in config

## Common Commands

- `npm start sync`: Fetch, parse, and sync to YNAB (main command for cronjob)
- `npm start retry-ynab`: Retry failed YNAB syncs
- `npm start setup-ynab`: Create YNAB config template
- `npm start list-budgets`: List available YNAB budgets
- `npm start list-accounts`: List accounts in configured budget
- `npm start dry-run`: Test parsing without saving

## Workflow

The primary workflow is:

1. Daily cronjob runs `npm start sync`
2. App fetches new emails from Gmail
3. Parses transactions and stores locally
4. Automatically syncs new transactions to YNAB
5. Tracks sync status in database for error recovery
