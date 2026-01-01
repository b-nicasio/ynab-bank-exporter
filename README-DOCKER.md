# Docker Setup - Quick Start

## Prerequisites

- Docker and Docker Compose installed
- Gmail API credentials (`credentials.json`)
- YNAB configuration (`accounts.json`)

## Quick Start

1. **Build the Docker image:**
   ```bash
   docker-compose build
   ```

2. **Start the container:**
   ```bash
   docker-compose up -d
   ```

3. **Check logs:**
   ```bash
   docker-compose logs -f bank-sync
   ```

The container will automatically run sync at **12:00 PM every day**, processing only transactions from **January 1, 2026** onwards.

## Manual Sync

To run a manual sync inside the container:

```bash
docker-compose exec bank-sync node dist/cli/index.js sync --min-date 2026-01-01
```

## Configuration

- **Cron Schedule**: Edit `docker/crontab` to change the schedule (default: 12 PM daily)
- **Minimum Date**: Edit `docker/cron-sync.sh` to change the `--min-date` parameter
- **Timezone**: Edit `docker-compose.yml` to change the `TZ` environment variable

See `docker/README.md` for detailed documentation.

