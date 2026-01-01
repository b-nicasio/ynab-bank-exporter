# Bank Sync to YNAB (Automated)

A Node.js application that runs as a daily cronjob to automatically scan your Gmail for bank transaction notifications (Dominican Republic focus), extract transaction details, and sync them directly to YNAB via the API.

## Features

- **Automated Daily Sync**: Designed to run as a cronjob, automatically fetching new transactions daily
- **Local-First**: All data is stored in a local SQLite database (`data/bank_transactions.db`) for tracking and deduplication
- **BHD Parser**: Robust support for BHD León notifications, including:
    - Credit/Debit Card consumption notifications
    - Transfers between products (Inflows/Outflows detected automatically)
    - Transfers to third parties
- **Smart Sync**: Automatically looks back 6 months on first run, then 30 days for subsequent runs
- **Deduplication**: Avoids importing the same transaction twice
- **Rules Engine**: Normalize payees (e.g., "MCDONALDS NUNEZ DE C" -> "McDonald's") via `rules.json`
- **YNAB Integration**: Automatically creates transactions in YNAB via API
- **Error Handling**: Tracks sync failures and allows retry

## Setup

### 1. Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project.
3. Enable **Gmail API**.
4. Go to **Credentials** -> **Create Credentials** -> **OAuth client ID**.
5. Application type: **Desktop app**.
6. Download the JSON file and rename it to `credentials.json`.
7. Place `credentials.json` in the root of this project.

### 2. YNAB API Setup

1. Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer).
2. Click **"New Token"** to create a Personal Access Token.
3. Copy the token (you'll need it for the config file).

### 3. Installation

```bash
npm install
npm run build
```

### 4. First Run (Gmail Auth)

Run the sync command. It will prompt you to visit a URL to authorize the app.

```bash
npm start sync
```

Copy the code from the browser and paste it into the terminal. A `token.json` file will be created.

### 5. YNAB Configuration

#### Step 1: Create Configuration Template

```bash
npm start setup-accounts
```

This creates an `accounts.json` template file.

#### Step 2: Get Your Budget ID

List your available budgets:

```bash
npm start list-budgets
```

Copy the Budget ID you want to use (or use `"default"` if you've set a default budget in YNAB).

#### Step 3: Get Your Account IDs

List accounts in your budget:

```bash
npm start list-accounts
```

Copy the Account IDs for each of your bank accounts.

#### Step 4: Update Configuration

Edit `accounts.json` with your values:

```json
{
  "ynab": {
    "accessToken": "YOUR_YNAB_PERSONAL_ACCESS_TOKEN",
    "budgetId": "your-budget-id-here"
  },
  "accountMappings": {
    "1610": {
      "ynabAccountId": "ynab-account-id-for-1610",
      "ynabAccountName": "Visa Mi País",
      "description": "Visa Mi País credit card"
    },
    "3709": {
      "ynabAccountId": "ynab-account-id-for-3709",
      "ynabAccountName": "Visa Débito Oro",
      "description": "Visa Débito Oro debit card"
    }
  }
}
```

**Account Mappings**: Map your bank account numbers (last 4 digits) to YNAB account IDs. The app uses these mappings to determine which YNAB account to create transactions in.

**Note**: Environment variables (`.env`) are also supported as an alternative, but `accounts.json` is the recommended method for easier management. See `.env.example` for environment variable format.

## Usage

### Daily Sync (Recommended for Cronjob)

Fetch emails, parse them, store locally, and sync to YNAB:

```bash
npm start sync
```

The sync command will:
1. Fetch new emails from Gmail
2. Parse transactions
3. Store them in the local database
4. Automatically sync new transactions to YNAB

### Retry Failed Syncs

If some transactions failed to sync to YNAB, retry them:

```bash
npm start retry-ynab
```

### Dry Run

See what would be parsed without saving to the database:

```bash
npm start dry-run
```

## Setting Up as a Cronjob

### macOS / Linux

Add to your crontab (`crontab -e`):

```bash
# Run daily at 6:00 AM
0 6 * * * cd /path/to/bank-csv-generator && npm start sync >> /path/to/bank-csv-generator/logs/sync.log 2>&1
```

Or use a more user-friendly approach with a shell script:

Create `sync.sh`:

```bash
#!/bin/bash
cd /path/to/bank-csv-generator
npm start sync >> logs/sync.log 2>&1
```

Make it executable:

```bash
chmod +x sync.sh
```

Then add to crontab:

```bash
0 6 * * * /path/to/bank-csv-generator/sync.sh
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Set trigger: Daily at 6:00 AM
4. Action: Start a program
5. Program: `node`
6. Arguments: `dist/cli/index.js sync`
7. Start in: `C:\path\to\bank-csv-generator`

## Configuration

### Rules Engine

Edit `rules.json` to normalize payees. The app supports regex matching.

```json
{
  "merchant_normalization": [
    {
      "match": "MCDONALDS",
      "payee": "McDonald's",
      "category": "Dining Out"
    },
    {
      "match": "UBER.*EATS",
      "payee": "Uber Eats",
      "category": "Dining Out"
    }
  ]
}
```

**Note**: The `category` field in rules is currently informational only. YNAB transactions are created without categories (you can categorize them manually in YNAB or extend the code to support category mapping).

### Supported Accounts (BHD)

The BHD parser currently identifies:
- **1610**: Visa Mi País
- **3709**: Visa Débito Oro
- **0014**: Savings (Linked to 3709)
- **9508**: Visa Mi País (Other)

## Database

Data is stored in `data/bank_transactions.db`. You can open this with any SQLite viewer to inspect raw data.

The database tracks:
- All parsed transactions
- YNAB sync status (`ynab_transaction_id`, `ynab_synced_at`, `ynab_sync_error`)
- Processed email messages (for deduplication)
- Unparsed messages (for debugging)

## Troubleshooting

### Transactions Not Syncing to YNAB

1. Check your `ynab-config.json` is correct
2. Verify account mappings match your bank account numbers
3. Run `npm start retry-ynab` to retry failed syncs
4. Check the database for `ynab_sync_error` messages

### Authentication Issues

- **Gmail**: Delete `token.json` and run `npm start sync` again to re-authenticate
- **YNAB**: Verify your Personal Access Token is valid in YNAB settings

## Privacy & Security

- **Never commit** `token.json`, `credentials.json`, `ynab-config.json`, or `data/` to version control
- All data stays local on your machine
- Gmail OAuth tokens are stored locally
- YNAB API tokens are stored in `ynab-config.json` (add to `.gitignore`)
