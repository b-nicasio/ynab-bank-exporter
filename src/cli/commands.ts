import { GmailClient } from '../gmail/client';
import { parserRegistry } from '../parsers/registry';
import { db } from '../db';
import { rulesEngine } from '../rules/engine';
import { Transaction } from '../types';
import { subDays, format, parse, isBefore, isAfter } from 'date-fns';
import { YNABClient } from '../ynab/client';
import { loadYNABConfig } from '../config/ynab';
import { classifyError, formatError, AppError, ErrorType } from '../utils/errors';

const gmail = new GmailClient();

function buildGmailQuery(days: number): string {
  const afterDate = format(subDays(new Date(), days), 'yyyy/MM/dd');

  // Collect all search terms from registered parsers
  const parsers = parserRegistry.getAllParsers();
  const searchTerms = parsers.flatMap(p => p.getSearchTerms());

  // Join them with OR
  // Example: after:2024/01/01 (from:bank1 OR from:bank2)
  const combinedTerms = searchTerms.length > 0
    ? `(${searchTerms.join(' OR ')})`
    : '';

  return `after:${afterDate} ${combinedTerms}`.trim();
}

export async function sync(options: { days?: number; minDate?: string } = {}) {
  try {
    await gmail.init();
  } catch (error: any) {
    console.error('Failed to initialize Gmail client:', error.message);
    process.exit(1);
  }

  const days = options.days;

  // Check for last sync date in DB
  const lastSync = db.prepare('SELECT MAX(processed_at) as last_sync FROM processed_messages').get() as { last_sync: string | null };
  console.log('Last sync check:', lastSync);

  let lookbackDays = 30; // Default

  if (days) {
      lookbackDays = days;
  } else if (!lastSync || !lastSync.last_sync) {
     console.log('First run detected (no prior sync history). Syncing last 6 months (180 days)...');
     lookbackDays = 180;
  } else {
      // If we have synced before, just look back 7 days to cover any delays or missed items,
      // deduplication will handle the rest.
      console.log(`Last sync was ${lastSync.last_sync}. Scanning last 30 days to ensure coverage...`);
      lookbackDays = 30;
  }

  const query = buildGmailQuery(lookbackDays);

  console.log(`Searching for emails with query: ${query}`);
  const messages = await gmail.listMessages(query);
  console.log(`Found ${messages.length} messages.`);

  const insertTx = db.prepare(`
    INSERT OR IGNORE INTO transactions (id, bank, account, date, payee, memo, amount, currency, direction, raw_message_id, raw_thread_id)
    VALUES (@id, @bank, @account, @date, @payee, @memo, @amount, @currency, @direction, @rawMessageId, @rawThreadId)
  `);

  const updateYNABSync = db.prepare(`
    UPDATE transactions
    SET ynab_transaction_id = @ynabId,
        ynab_synced_at = CURRENT_TIMESTAMP,
        ynab_sync_error = NULL,
        ynab_sync_error_type = NULL,
        ynab_sync_retry_count = 0
    WHERE id = @id
  `);

  const updateYNABError = db.prepare(`
    UPDATE transactions
    SET ynab_sync_error = @error,
        ynab_sync_error_type = @errorType,
        ynab_sync_retry_count = COALESCE(ynab_sync_retry_count, 0) + 1,
        ynab_sync_last_retry = CURRENT_TIMESTAMP,
        ynab_synced_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `);

  const getUnsyncedTransactions = db.prepare(`
    SELECT * FROM transactions
    WHERE ynab_synced_at IS NULL AND ynab_sync_error IS NULL
    ORDER BY date ASC, created_at ASC
  `);

  const insertProcessed = db.prepare(`INSERT OR IGNORE INTO processed_messages (message_id) VALUES (?)`);
  const checkProcessed = db.prepare(`SELECT 1 FROM processed_messages WHERE message_id = ?`);
  const insertUnparsed = db.prepare(`
    INSERT OR REPLACE INTO unparsed_messages (message_id, reason, subject, date, attempts)
    VALUES (@id, @reason, @subject, @date, COALESCE((SELECT attempts FROM unparsed_messages WHERE message_id = @id), 0) + 1)
  `);

  let newCount = 0;
  let processedCount = 0;
  let errorCount = 0;

  for (const msgSummary of messages) {
    if (checkProcessed.get(msgSummary.id)) {
      continue;
    }

    const fullMsg = await gmail.getMessage(msgSummary.id!);
    if (!fullMsg) continue;

    const parser = parserRegistry.findParser(fullMsg);
    if (parser) {
      const transaction = parser.parse(fullMsg);
      if (transaction) {
        // Filter by minimum date if specified
        if (options.minDate) {
          const minDate = parse(options.minDate, 'yyyy-MM-dd', new Date());
          const txDate = parse(transaction.date, 'yyyy-MM-dd', new Date());
          if (isBefore(txDate, minDate)) {
            // Skip transactions before the minimum date
            insertProcessed.run(fullMsg.id);
            continue;
          }
        }

        const normalized = rulesEngine.apply(transaction);
        try {
            // Check if transaction ID exists? Schema has PK on id.
            // insertTx is INSERT OR IGNORE, so duplicates are skipped.
            const info = insertTx.run(normalized);
            if (info.changes > 0) {
                newCount++;
            }
            insertProcessed.run(fullMsg.id);
            processedCount++;
        } catch (e: any) {
            const error = classifyError(e, {
              transactionId: normalized.id,
              payee: normalized.payee,
              amount: normalized.amount,
            });
            console.error(`Error saving transaction ${normalized.id}:`, formatError(error));
            errorCount++;
        }
      } else {
         insertUnparsed.run({
             id: fullMsg.id,
             reason: 'Parser returned null',
             subject: fullMsg.subject,
             date: fullMsg.date.toISOString()
         });
         errorCount++;
      }
    } else {
        // No parser found - store as unparsed? Or ignore?
        // Maybe only store if it looks like a bank email?
        // For now, assume filters in Gmail search query handle "bank-like" emails,
        // so if we fetched it but can't parse it, it's notable.
        insertUnparsed.run({
            id: fullMsg.id,
            reason: 'No parser matched',
            subject: fullMsg.subject,
            date: fullMsg.date.toISOString()
        });
        // We don't mark as processed so we retry later if we add a parser?
        // Or we mark as processed so we don't fetch again every time?
        // Let's NOT mark as processed in `processed_messages` if we want to retry.
        // But then sync matches it every time.
        // Better to mark as processed/checked.
        // But `unparsed_messages` table acts as the record.
    }
  }

  console.log(`Sync complete.`);
  console.log(`Processed: ${processedCount}`);
  console.log(`New Transactions: ${newCount}`);
  console.log(`Unparsed/Errors: ${errorCount}`);

  // Sync new transactions to YNAB
  if (newCount > 0) {
    console.log('\nSyncing transactions to YNAB...');
    try {
      const ynabConfig = loadYNABConfig();
      const ynabClient = new YNABClient(ynabConfig);

      // Filter unsynced transactions by minimum date if specified
      let unsynced = getUnsyncedTransactions.all() as Transaction[];

      if (options.minDate) {
        const minDate = parse(options.minDate, 'yyyy-MM-dd', new Date());
        unsynced = unsynced.filter(tx => {
          const txDate = parse(tx.date, 'yyyy-MM-dd', new Date());
          return !isBefore(txDate, minDate);
        });
      }

      if (unsynced.length > 0) {
        console.log(`Found ${unsynced.length} unsynced transactions. Syncing to YNAB...`);

        let syncResults: Map<string, string>;
        let syncErrors: Map<string, AppError> = new Map();

        try {
          syncResults = await ynabClient.createTransactions(unsynced);
        } catch (error: any) {
          const appError = classifyError(error, {
            transactionCount: unsynced.length,
          });

          // If it's a batch error, try individual transactions
          if (appError.retryable && unsynced.length > 1) {
            console.warn('Batch sync failed, attempting individual transactions...');
            syncResults = new Map();

            for (const transaction of unsynced) {
              try {
                const ynabId = await ynabClient.createTransaction(transaction);
                if (ynabId) {
                  syncResults.set(transaction.id, ynabId);
                }
              } catch (txError: any) {
                const txAppError = classifyError(txError, {
                  transactionId: transaction.id,
                  payee: transaction.payee,
                });
                syncErrors.set(transaction.id, txAppError);
              }
            }
          } else {
            // Non-retryable error or single transaction - mark all as failed
            unsynced.forEach(tx => {
              syncErrors.set(tx.id, appError);
            });
            syncResults = new Map();
          }
        }

        let syncedCount = 0;
        let errorCount = 0;
        const errorBreakdown: Record<string, number> = {};

        for (const transaction of unsynced) {
          const ynabId = syncResults.get(transaction.id);
          if (ynabId) {
            updateYNABSync.run({ id: transaction.id, ynabId });
            syncedCount++;
          } else {
            // Check if we have an error for this transaction
            const error = syncErrors.get(transaction.id);

            if (error) {
              updateYNABError.run({
                id: transaction.id,
                error: formatError(error),
                errorType: error.type,
              });
              errorBreakdown[error.type] = (errorBreakdown[error.type] || 0) + 1;
              errorCount++;
            } else {
              // Check if it's missing account mapping
              const accountId = ynabConfig.accountMappings[transaction.account || ''];
              if (!accountId) {
                const mappingError = classifyError(
                  new Error(`No YNAB account mapping for bank account: ${transaction.account}`),
                  { account: transaction.account }
                );
                updateYNABError.run({
                  id: transaction.id,
                  error: mappingError.message,
                  errorType: ErrorType.CONFIGURATION_ERROR,
                });
                errorBreakdown[ErrorType.CONFIGURATION_ERROR] = (errorBreakdown[ErrorType.CONFIGURATION_ERROR] || 0) + 1;
                errorCount++;
              }
            }
          }
        }

        console.log(`YNAB Sync complete:`);
        console.log(`  Synced: ${syncedCount}`);
        console.log(`  Errors: ${errorCount}`);
        if (errorCount > 0 && Object.keys(errorBreakdown).length > 0) {
          console.log(`  Error breakdown:`);
          Object.entries(errorBreakdown).forEach(([type, count]) => {
            console.log(`    ${type}: ${count}`);
          });
        }
      } else {
        console.log('No new transactions to sync to YNAB.');
      }
    } catch (error: any) {
      console.error('Failed to sync to YNAB:', error.message);
      // Don't exit - we still want to keep the local transactions
    }
  }
}

export async function dryRun(options: { days?: number }) {
  try {
    await gmail.init();
  } catch (error: any) {
    console.error('Failed to initialize Gmail client:', error.message);
    process.exit(1);
  }
  const days = options.days || 30;
  const query = buildGmailQuery(days);

  console.log(`[Dry Run] Searching for emails with query: ${query}`);
  const messages = await gmail.listMessages(query);
  console.log(`Found ${messages.length} messages.`);

  for (const msgSummary of messages) {
     const fullMsg = await gmail.getMessage(msgSummary.id!);
     if (!fullMsg) continue;

     const parser = parserRegistry.findParser(fullMsg);
     if (parser) {
         const t = parser.parse(fullMsg);
         if (t) {
             const n = rulesEngine.apply(t);
             console.log(`[MATCH] ${parser.name}: ${n.date} - ${n.payee} - ${n.currency} ${n.amount}`);
         } else {
             console.log(`[FAIL] ${parser.name} could not parse: ${fullMsg.subject}`);
             // debug
             console.log('--- Body Preview (Plain) ---');
             console.log(fullMsg.plainBody ? fullMsg.plainBody.substring(0, 500) : '[EMPTY]');
             console.log('--- Body Preview (HTML) ---');
             console.log(fullMsg.htmlBody ? fullMsg.htmlBody.substring(0, 500) : '[EMPTY]');
             console.log('--------------------');
         }
     } else {
         console.log(`[SKIP] No parser for: ${fullMsg.subject} (From: ${fullMsg.from})`);
     }
  }
}

export async function setupYNAB() {
  const { createYNABConfigTemplate } = await import('../config/ynab');
  createYNABConfigTemplate();
}

export async function setupAccounts() {
  const { createAccountsConfigTemplate } = await import('../config/ynab');
  createAccountsConfigTemplate();
}

export async function listYNABBudgets() {
  try {
    const ynabConfig = loadYNABConfig();
    const ynabClient = new YNABClient(ynabConfig);

    const budgets = await ynabClient.getBudgets();
    console.log('\nAvailable YNAB Budgets:');
    console.log('─'.repeat(60));
    budgets.forEach(budget => {
      console.log(`ID: ${budget.id}`);
      console.log(`Name: ${budget.name}`);
      console.log(`Last Modified: ${budget.last_modified_on || 'N/A'}`);
      console.log('─'.repeat(60));
    });
  } catch (error: any) {
    console.error('Failed to fetch budgets:', error.message);
    if (error.message.includes('not found')) {
      console.log('\nPlease run: npm start setup-ynab');
    }
  }
}

export async function listYNABAccounts() {
  try {
    const ynabConfig = loadYNABConfig();
    const ynabClient = new YNABClient(ynabConfig);

    const accounts = await ynabClient.getAccounts();
    console.log(`\nAvailable YNAB Accounts in Budget "${ynabConfig.budgetId}":`);
    console.log('─'.repeat(60));
    accounts.forEach(account => {
      console.log(`ID: ${account.id}`);
      console.log(`Name: ${account.name}`);
      console.log(`Type: ${account.type}`);
      console.log(`Balance: ${account.balance ? (account.balance / 1000).toFixed(2) : '0.00'}`);
      console.log('─'.repeat(60));
    });
  } catch (error: any) {
    console.error('Failed to fetch accounts:', error?.message || error);
    if (error?.message?.includes('not found')) {
      console.log('\nPlease run: npm start setup-ynab');
    } else if (error?.message?.includes('budget')) {
      console.log('\nPlease set YNAB_BUDGET_ID in your .env file or ynab-config.json');
      console.log('Run "npm start list-budgets" to see available budget IDs');
    }
  }
}

export async function testTransaction(options: { account?: string; amount?: number; direction?: 'inflow' | 'outflow'; payee?: string }) {
  try {
    const ynabConfig = loadYNABConfig();
    const ynabClient = new YNABClient(ynabConfig);

    const bankAccount = options.account || '0014';
    const amount = options.amount || 300;
    const direction = options.direction || 'inflow';
    const payee = options.payee || 'Test Transaction';

    // Get the YNAB account ID for this bank account
    const ynabAccountId = ynabConfig.accountMappings[bankAccount];

    if (!ynabAccountId) {
      console.error(`No YNAB account mapping found for bank account: ${bankAccount}`);
      console.log('\nAvailable account mappings:');
      Object.keys(ynabConfig.accountMappings).forEach(acc => {
        console.log(`  ${acc} -> ${ynabConfig.accountMappings[acc]}`);
      });
      return;
    }

    // Create a test transaction
    const testTransaction: Transaction = {
      id: `test-${Date.now()}`,
      bank: 'TEST',
      account: bankAccount,
      date: format(new Date(), 'yyyy-MM-dd'),
      payee: payee,
      memo: `Manual test transaction - ${amount} DOP ${direction}`,
      amount: amount,
      currency: 'DOP',
      direction: direction,
      rawMessageId: 'test',
      rawThreadId: 'test',
    };

    console.log(`\nCreating test transaction:`);
    console.log(`  Account: ${bankAccount} (${ynabAccountId})`);
    console.log(`  Amount: ${amount} DOP`);
    console.log(`  Direction: ${direction}`);
    console.log(`  Payee: ${payee}`);
    console.log(`  Date: ${testTransaction.date}`);

    try {
      const ynabTransactionId = await ynabClient.createTransaction(testTransaction);

      if (ynabTransactionId) {
        console.log(`\n✅ Successfully created test transaction in YNAB!`);
        console.log(`   YNAB Transaction ID: ${ynabTransactionId}`);
        console.log(`\nYou can verify this transaction in your YNAB app.`);
      } else {
        console.error('\n❌ Failed to create transaction (no transaction ID returned)');
      }
    } catch (error: any) {
      const appError = classifyError(error, {
        account: bankAccount,
        amount: amount,
        payee: payee,
      });
      console.error('\n❌ Failed to create test transaction:', formatError(appError));
      if (appError.context) {
        console.error('Context:', JSON.stringify(appError.context, null, 2));
      }
      throw appError;
    }
  } catch (error: any) {
    const appError = classifyError(error);
    console.error('\n❌ Failed to create test transaction:', formatError(appError));
    if (appError.context) {
      console.error('Context:', JSON.stringify(appError.context, null, 2));
    }
  }
}

export async function retryYNABSync() {
  try {
    const ynabConfig = loadYNABConfig();
    const ynabClient = new YNABClient(ynabConfig);

    const getFailedSyncs = db.prepare(`
      SELECT * FROM transactions
      WHERE ynab_synced_at IS NULL OR ynab_sync_error IS NOT NULL
      ORDER BY date ASC, created_at ASC
    `);

    const updateYNABSyncRetry = db.prepare(`
      UPDATE transactions
      SET ynab_transaction_id = @ynabId,
          ynab_synced_at = CURRENT_TIMESTAMP,
          ynab_sync_error = NULL,
          ynab_sync_error_type = NULL,
          ynab_sync_retry_count = 0
      WHERE id = @id
    `);

    const updateYNABErrorRetry = db.prepare(`
      UPDATE transactions
      SET ynab_sync_error = @error,
          ynab_sync_error_type = @errorType,
          ynab_sync_retry_count = COALESCE(ynab_sync_retry_count, 0) + 1,
          ynab_sync_last_retry = CURRENT_TIMESTAMP,
          ynab_synced_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `);

    const failed = getFailedSyncs.all() as Transaction[];

    if (failed.length === 0) {
      console.log('No failed transactions to retry.');
      return;
    }

    console.log(`Found ${failed.length} transactions to retry syncing to YNAB...`);

    let syncResults: Map<string, string>;
    let syncErrors: Map<string, AppError> = new Map();

    try {
      syncResults = await ynabClient.createTransactions(failed);
    } catch (error: any) {
      const appError = classifyError(error, {
        transactionCount: failed.length,
      });

      // If batch fails and error is retryable, try individual transactions
      if (appError.retryable && failed.length > 1) {
        console.warn('Batch retry failed, attempting individual transactions...');
        syncResults = new Map();

        for (const transaction of failed) {
          try {
            const ynabId = await ynabClient.createTransaction(transaction);
            if (ynabId) {
              syncResults.set(transaction.id, ynabId);
            }
          } catch (txError: any) {
            const txAppError = classifyError(txError, {
              transactionId: transaction.id,
              payee: transaction.payee,
            });
            syncErrors.set(transaction.id, txAppError);
          }
        }
      } else {
        // Non-retryable error - mark all as failed
        failed.forEach(tx => {
          syncErrors.set(tx.id, appError);
        });
        syncResults = new Map();
      }
    }

    let syncedCount = 0;
    let stillFailed = 0;
    const errorBreakdown: Record<string, number> = {};

    for (const transaction of failed) {
      const ynabId = syncResults.get(transaction.id);
      if (ynabId) {
        updateYNABSyncRetry.run({ id: transaction.id, ynabId });
        syncedCount++;
      } else {
        const error = syncErrors.get(transaction.id);

        if (error) {
          updateYNABErrorRetry.run({
            id: transaction.id,
            error: formatError(error),
            errorType: error.type,
          });
          errorBreakdown[error.type] = (errorBreakdown[error.type] || 0) + 1;
          stillFailed++;
        } else {
          // Check for missing account mapping
          const accountId = ynabConfig.accountMappings[transaction.account || ''];
          if (!accountId) {
            const mappingError = classifyError(
              new Error(`No YNAB account mapping for bank account: ${transaction.account}`),
              { account: transaction.account }
            );
            updateYNABErrorRetry.run({
              id: transaction.id,
              error: mappingError.message,
              errorType: ErrorType.CONFIGURATION_ERROR,
            });
            errorBreakdown[ErrorType.CONFIGURATION_ERROR] = (errorBreakdown[ErrorType.CONFIGURATION_ERROR] || 0) + 1;
            stillFailed++;
          }
        }
      }
    }

    console.log(`Retry complete:`);
    console.log(`  Synced: ${syncedCount}`);
    console.log(`  Still failed: ${stillFailed}`);
    if (stillFailed > 0 && Object.keys(errorBreakdown).length > 0) {
      console.log(`  Error breakdown:`);
      Object.entries(errorBreakdown).forEach(([type, count]) => {
        console.log(`    ${type}: ${count}`);
      });
    }
  } catch (error: any) {
    const appError = classifyError(error);
    console.error('Failed to retry YNAB sync:', formatError(appError));
    if (appError.context) {
      console.error('Context:', JSON.stringify(appError.context, null, 2));
    }
  }
}

