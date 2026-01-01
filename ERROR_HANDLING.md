# Error Handling Documentation

## Overview

The application now includes comprehensive error handling with automatic retry logic, error classification, and detailed error tracking.

## Features

### 1. Error Classification

Errors are automatically classified into types:

**Retryable Errors** (automatically retried):
- `NETWORK_ERROR` - Connection issues
- `RATE_LIMIT` - API rate limiting (429)
- `TIMEOUT` - Request timeouts
- `SERVER_ERROR` - 5xx server errors

**Non-Retryable Errors** (logged but not retried):
- `AUTHENTICATION_ERROR` - Invalid credentials (401, 403)
- `VALIDATION_ERROR` - Invalid data (400, 422)
- `NOT_FOUND` - Resource not found (404)
- `CONFIGURATION_ERROR` - Missing config or account mappings
- `PARSING_ERROR` - Email parsing failures
- `UNKNOWN_ERROR` - Unclassified errors

### 2. Automatic Retry with Exponential Backoff

- **Default**: 3 retries with exponential backoff
- **Initial delay**: 1 second
- **Max delay**: 30 seconds
- **Backoff multiplier**: 2x per attempt

Example delays:
- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 seconds delay
- Attempt 4: 4 seconds delay

### 3. Error Tracking in Database

The `transactions` table now tracks:
- `ynab_sync_error` - Error message
- `ynab_sync_error_type` - Error type (enum)
- `ynab_sync_retry_count` - Number of retry attempts
- `ynab_sync_last_retry` - Timestamp of last retry

### 4. Graceful Degradation

- **Batch failures**: If batch sync fails, automatically falls back to individual transaction syncs
- **Partial failures**: Continues processing other transactions even if some fail
- **Error reporting**: Provides detailed breakdown of error types

### 5. Enhanced Error Messages

Errors now include:
- Error type classification
- Contextual information (transaction ID, payee, amount, etc.)
- HTTP status codes (when applicable)
- Original error details

## Usage Examples

### Viewing Error Breakdown

After a sync, you'll see error breakdowns:

```
YNAB Sync complete:
  Synced: 15
  Errors: 3
  Error breakdown:
    CONFIGURATION_ERROR: 2
    VALIDATION_ERROR: 1
```

### Retrying Failed Transactions

```bash
npm start retry-ynab
```

This will:
1. Find all transactions with errors
2. Retry them with exponential backoff
3. Show detailed error breakdown

### Querying Error Types

You can query the database for specific error types:

```sql
-- Find all configuration errors
SELECT * FROM transactions
WHERE ynab_sync_error_type = 'CONFIGURATION_ERROR';

-- Find transactions that failed after multiple retries
SELECT * FROM transactions
WHERE ynab_sync_retry_count > 2;

-- Find retryable errors that might succeed later
SELECT * FROM transactions
WHERE ynab_sync_error_type IN ('NETWORK_ERROR', 'RATE_LIMIT', 'SERVER_ERROR');
```

## Error Handling Flow

1. **Error occurs** → Classified by type
2. **If retryable** → Automatic retry with backoff
3. **If retries exhausted** → Error stored in database
4. **Error details** → Logged with context
5. **Continue processing** → Other transactions proceed

## Best Practices

1. **Monitor error types**: Check error breakdowns regularly
2. **Fix configuration errors**: These won't auto-resolve
3. **Retry network errors**: These often resolve on retry
4. **Review retry counts**: High retry counts indicate persistent issues

## Error Types Reference

| Type | Retryable | Common Causes | Solution |
|------|-----------|---------------|----------|
| `NETWORK_ERROR` | ✅ Yes | Internet issues, DNS problems | Check connection, retry later |
| `RATE_LIMIT` | ✅ Yes | Too many API requests | Wait and retry (respects Retry-After header) |
| `TIMEOUT` | ✅ Yes | Slow network, server overload | Retry with backoff |
| `SERVER_ERROR` | ✅ Yes | YNAB API issues (5xx) | Retry later |
| `AUTHENTICATION_ERROR` | ❌ No | Invalid/expired token | Update credentials |
| `VALIDATION_ERROR` | ❌ No | Invalid transaction data | Fix transaction data |
| `NOT_FOUND` | ❌ No | Budget/account doesn't exist | Check account mappings |
| `CONFIGURATION_ERROR` | ❌ No | Missing account mapping | Add to accounts.json |

