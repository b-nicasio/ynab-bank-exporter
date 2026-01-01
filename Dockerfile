FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Install cron
RUN apt-get update && apt-get install -y cron && rm -rf /var/lib/apt/lists/*

# Copy cron script
COPY docker/cron-sync.sh /app/docker/cron-sync.sh
RUN chmod +x /app/docker/cron-sync.sh

# Copy crontab file
COPY docker/crontab /etc/cron.d/bank-sync
RUN chmod 0644 /etc/cron.d/bank-sync && \
    crontab /etc/cron.d/bank-sync

# Create log directory
RUN mkdir -p /app/logs

# Expose any ports if needed (not required for this app)
# EXPOSE 3000

# Start cron in foreground and keep container running
CMD ["sh", "-c", "cron && tail -f /dev/null"]

