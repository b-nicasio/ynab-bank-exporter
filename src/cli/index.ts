#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import {
  sync,
  dryRun,
  setupYNAB,
  setupAccounts,
  listYNABBudgets,
  listYNABAccounts,
  testTransaction,
  retryYNABSync
} from './commands';

const program = new Command();

program
  .name('bank-sync')
  .description('Sync Gmail bank notifications to YNAB automatically')
  .version('1.0.0');

program.command('sync')
  .description('Fetch, parse, and sync transactions from Gmail to YNAB')
  .option('-d, --days <number>', 'Number of days to look back')
  .option('--min-date <date>', 'Minimum date to process transactions (YYYY-MM-DD format, e.g., 2026-01-01)')
  .action(async (options) => {
    await sync({
      days: options.days ? parseInt(options.days) : undefined,
      minDate: options.minDate
    });
  });

program.command('dry-run')
  .description('Simulate sync without saving')
  .option('-d, --days <number>', 'Number of days to look back', '30')
  .action(async (options) => {
    await dryRun({ days: parseInt(options.days) });
  });

program.command('setup-ynab')
  .description('Create YNAB configuration template file (legacy)')
  .action(async () => {
    await setupYNAB();
  });

program.command('setup-accounts')
  .description('Create accounts.json configuration template file')
  .action(async () => {
    await setupAccounts();
  });

program.command('list-budgets')
  .description('List all available YNAB budgets')
  .action(async () => {
    await listYNABBudgets();
  });

program.command('list-accounts')
  .description('List all accounts in the configured YNAB budget')
  .action(async () => {
    await listYNABAccounts();
  });

program.command('test-transaction')
  .description('Create a test transaction in YNAB')
  .option('-a, --account <string>', 'Bank account number (e.g., 0014)', '0014')
  .option('-m, --amount <number>', 'Transaction amount', '300')
  .option('-d, --direction <string>', 'Transaction direction (inflow or outflow)', 'inflow')
  .option('-p, --payee <string>', 'Payee name', 'Test Transaction')
  .action(async (options) => {
    await testTransaction({
      account: options.account,
      amount: parseFloat(options.amount),
      direction: options.direction,
      payee: options.payee,
    });
  });

program.command('retry-ynab')
  .description('Retry syncing failed transactions to YNAB')
  .action(async () => {
    await retryYNABSync();
  });

program.parse(process.argv);

