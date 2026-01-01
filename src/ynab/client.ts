import { API, SaveTransactionWithOptionalFields, TransactionClearedStatus, BudgetSummary, Account } from 'ynab';
import { Transaction } from '../types';
import { YNABConfig } from '../config/ynab';

export class YNABClient {
  private api: API;
  private budgetId: string;
  private accountMappings: Record<string, string>;

  constructor(config: YNABConfig) {
    this.api = new API(config.accessToken);
    this.budgetId = config.budgetId;
    this.accountMappings = config.accountMappings;
  }

  /**
   * Convert amount to YNAB milliunits format (amount * 1000)
   * YNAB uses milliunits where 1,000 milliunits = 1 currency unit
   */
  private toMilliunits(amount: number): number {
    return Math.round(amount * 1000);
  }

  /**
   * Get YNAB account ID for a bank account number
   */
  private getYNABAccountId(bankAccount: string): string | null {
    return this.accountMappings[bankAccount] || null;
  }

  /**
   * Create a transaction in YNAB
   */
  async createTransaction(transaction: Transaction): Promise<string | null> {
    const accountId = this.getYNABAccountId(transaction.account || '');

    if (!accountId) {
      console.warn(`No YNAB account mapping found for bank account: ${transaction.account}`);
      return null;
    }

    const amount = this.toMilliunits(transaction.amount);
    const milliunitAmount = transaction.direction === 'outflow' ? -amount : amount;

    const ynabTransaction: SaveTransactionWithOptionalFields = {
      account_id: accountId,
      date: transaction.date, // YYYY-MM-DD format
      amount: milliunitAmount,
      payee_name: transaction.payee,
      memo: transaction.memo || undefined,
      cleared: TransactionClearedStatus.Cleared,
      approved: true,
    };

    try {
      const response = await this.api.transactions.createTransaction(
        this.budgetId,
        { transaction: ynabTransaction }
      );

      if (response.data.transaction) {
        return response.data.transaction.id;
      }

      return null;
    } catch (error: any) {
      console.error(`Failed to create YNAB transaction for ${transaction.payee}:`, error.message);
      if (error.response?.data) {
        console.error('YNAB API Error:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Create multiple transactions in YNAB (batch)
   */
  async createTransactions(transactions: Transaction[]): Promise<Map<string, string>> {
    const results = new Map<string, string>(); // transaction.id -> ynab_transaction_id

    // Group transactions by account for batch creation
    const byAccount = transactions.reduce((acc, t) => {
      const accountId = this.getYNABAccountId(t.account || '');
      if (!accountId) return acc;

      if (!acc[accountId]) acc[accountId] = [];
      acc[accountId].push(t);
      return acc;
    }, {} as Record<string, Transaction[]>);

    // Create transactions in batches per account
    for (const [accountId, accountTransactions] of Object.entries(byAccount)) {
      const ynabTransactions: SaveTransactionWithOptionalFields[] = accountTransactions.map(t => ({
        account_id: accountId,
        date: t.date,
        amount: t.direction === 'outflow' ? -this.toMilliunits(t.amount) : this.toMilliunits(t.amount),
        payee_name: t.payee,
        memo: t.memo || undefined,
        cleared: TransactionClearedStatus.Cleared,
        approved: true,
      }));

      try {
        const response = await this.api.transactions.createTransactions(
          this.budgetId,
          { transactions: ynabTransactions }
        );

        if (response.data.transactions) {
          response.data.transactions.forEach((ynabTx, index) => {
            if (ynabTx.id && accountTransactions[index]) {
              results.set(accountTransactions[index].id, ynabTx.id);
            }
          });
        }

        // Handle duplicates (transactions that already exist)
        if (response.data.duplicate_import_ids) {
          console.log(`Skipped ${response.data.duplicate_import_ids.length} duplicate transactions`);
        }
      } catch (error: any) {
        console.error(`Failed to create batch transactions for account ${accountId}:`, error.message);
        if (error.response?.data) {
          console.error('YNAB API Error:', JSON.stringify(error.response.data, null, 2));
        }
        // Continue with other accounts even if one fails
      }
    }

    return results;
  }

  /**
   * Get all budgets for the user
   */
  async getBudgets(): Promise<BudgetSummary[]> {
    try {
      const response = await this.api.budgets.getBudgets();
      return response.data.budgets;
    } catch (error: any) {
      console.error('Failed to fetch budgets:', error.message);
      throw error;
    }
  }

  /**
   * Get all accounts for the budget
   */
  async getAccounts(): Promise<Account[]> {
    try {
      const response = await this.api.accounts.getAccounts(this.budgetId);
      return response.data.accounts;
    } catch (error: any) {
      console.error('Failed to fetch accounts:', error.message);
      throw error;
    }
  }
}

