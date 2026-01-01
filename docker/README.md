# Docker Setup for Bank Sync

This directory contains Docker configuration files for running the bank sync application in a container with automated daily syncing.

## Files

- `Dockerfile` - Container image definition
- `docker-compose.yml` - Docker Compose configuration
- `cron-sync.sh` - Script that runs the sync (called by cron)
- `crontab` - Cron schedule configuration (runs at 12 PM daily)

## Setup

### 1. Build the Docker image

```bash
docker-compose build
```

Or using Docker directly:

```bash
docker build -t bank-sync .
```

### 2. Ensure required files exist

Make sure you have these files in the project root:
- `credentials.json` - Gmail API credentials
- `token.json` - Gmail OAuth token (will be created on first auth)
- `accounts.json` - YNAB configuration and account mappings
- `rules.json` - Payee normalization rules

### 3. Run the container

```bash
docker-compose up -d
```

This will:
- Start the container
- Set up cron to run sync at 12 PM daily
- Mount volumes for persistent data (database, logs, config files)

### 4. Check logs

View sync logs:

```bash
docker-compose logs -f bank-sync
```

Or check the log file directly:

```bash
docker-compose exec bank-sync tail -f /app/logs/sync.log
```

### 5. Manual sync (optional)

Run a manual sync inside the container:

```bash
docker-compose exec bank-sync node dist/cli/index.js sync --min-date 2026-01-01
```

## Configuration

### Cron Schedule

The sync runs at **12:00 PM (noon) every day**. To change this, edit `docker/crontab`:

```
# Format: minute hour day month weekday command
0 12 * * * /app/docker/cron-sync.sh
```

### Minimum Date Filter

Transactions are filtered to only process those from **January 1, 2026** onwards. This is configured in `docker/cron-sync.sh`:

```bash
node dist/cli/index.js sync --min-date 2026-01-01
```

To change the minimum date, edit the `--min-date` parameter in `docker/cron-sync.sh`.

## Volumes

The following directories are mounted as volumes:
- `./data` - SQLite database (persistent)
- `./credentials.json` - Gmail credentials (read-only)
- `./token.json` - Gmail OAuth token (read-write)
- `./accounts.json` - YNAB configuration (read-only)
- `./rules.json` - Payee rules (read-only)
- `./logs` - Sync logs (read-write)

## Timezone

The container uses `America/Santo_Domingo` timezone by default. You can change this in `docker-compose.yml`:

```yaml
environment:
  - TZ=America/Santo_Domingo
```

## Troubleshooting

### Check if cron is running

```bash
docker-compose exec bank-sync ps aux | grep cron
```

### View cron logs

```bash
docker-compose exec bank-sync tail -f /var/log/cron.log
```

### Run sync manually for testing

```bash
docker-compose exec bank-sync node dist/cli/index.js sync --min-date 2026-01-01
```

### Rebuild container after code changes

```bash
docker-compose build --no-cache
docker-compose up -d
```

