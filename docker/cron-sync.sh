#!/bin/bash

# Sync script that runs daily
# This script is called by cron at 12 PM every day

LOG_FILE="/app/logs/sync.log"
DATE=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$DATE] Starting daily sync..." >> "$LOG_FILE"

# Run the sync command
# Only sync transactions from January 2026 onwards
cd /app && node dist/cli/index.js sync --min-date 2026-01-01 >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$DATE] Sync completed successfully" >> "$LOG_FILE"
else
    echo "[$DATE] Sync failed with exit code $EXIT_CODE" >> "$LOG_FILE"
fi

echo "[$DATE] Sync finished" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

exit $EXIT_CODE
