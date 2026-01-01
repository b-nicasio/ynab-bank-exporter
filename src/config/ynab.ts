import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

export interface AccountMapping {
  ynabAccountId: string;
  ynabAccountName?: string;
  description?: string;
}

export interface AccountsConfig {
  ynab: {
    accessToken: string;
    budgetId: string;
  };
  accountMappings: Record<string, AccountMapping>;
  notifications?: {
    email?: string; // Email address to send sync notifications to
  };
}

export interface YNABConfig {
  accessToken: string;
  budgetId: string;
  accountMappings: Record<string, string>; // Maps bank account (e.g., '1610') to YNAB account ID
}

const ACCOUNTS_CONFIG_PATH = path.join(process.cwd(), 'accounts.json');
const LEGACY_CONFIG_PATH = path.join(process.cwd(), 'ynab-config.json');

/**
 * Load full accounts configuration (includes notifications)
 */
export function loadAccountsConfig(): AccountsConfig {
  if (fs.existsSync(ACCOUNTS_CONFIG_PATH)) {
    return fs.readJsonSync(ACCOUNTS_CONFIG_PATH) as AccountsConfig;
  }
  throw new Error(`accounts.json not found at ${ACCOUNTS_CONFIG_PATH}`);
}

/**
 * Load YNAB configuration from accounts.json (preferred) or environment variables
 * Priority: accounts.json > environment variables > legacy ynab-config.json
 */
export function loadYNABConfig(): YNABConfig {
  // Try accounts.json first (preferred method)
  if (fs.existsSync(ACCOUNTS_CONFIG_PATH)) {
    const accountsConfig = fs.readJsonSync(ACCOUNTS_CONFIG_PATH) as Partial<AccountsConfig>;

    if (!accountsConfig.ynab?.accessToken) {
      throw new Error('YNAB accessToken is required in accounts.json');
    }

    if (!accountsConfig.ynab?.budgetId) {
      throw new Error('YNAB budgetId is required in accounts.json');
    }

    if (!accountsConfig.accountMappings || Object.keys(accountsConfig.accountMappings).length === 0) {
      throw new Error('accountMappings is required in accounts.json');
    }

    // Convert AccountMapping objects to simple string mappings
    const accountMappings: Record<string, string> = {};
    for (const [bankAccount, mapping] of Object.entries(accountsConfig.accountMappings)) {
      if (typeof mapping === 'string') {
        // Support legacy format where mapping is just a string
        accountMappings[bankAccount] = mapping;
      } else if (mapping.ynabAccountId) {
        accountMappings[bankAccount] = mapping.ynabAccountId;
      }
    }

    return {
      accessToken: accountsConfig.ynab.accessToken,
      budgetId: accountsConfig.ynab.budgetId,
      accountMappings,
    };
  }

  // Try environment variables
  const envAccessToken = process.env.YNAB_ACCESS_TOKEN;
  const envBudgetId = process.env.YNAB_BUDGET_ID;
  const envAccountMappings = process.env.YNAB_ACCOUNT_MAPPINGS;

  if (envAccessToken && envBudgetId && envAccountMappings) {
    try {
      const accountMappings = JSON.parse(envAccountMappings);
      if (typeof accountMappings !== 'object' || Array.isArray(accountMappings)) {
        throw new Error('YNAB_ACCOUNT_MAPPINGS must be a valid JSON object');
      }
      return {
        accessToken: envAccessToken,
        budgetId: envBudgetId,
        accountMappings,
      };
    } catch (error: any) {
      throw new Error(`Failed to parse YNAB_ACCOUNT_MAPPINGS: ${error.message}`);
    }
  }

  // Fall back to legacy ynab-config.json if it exists
  if (fs.existsSync(LEGACY_CONFIG_PATH)) {
    const config = fs.readJsonSync(LEGACY_CONFIG_PATH) as Partial<YNABConfig>;

    if (!config.accessToken) {
      throw new Error('YNAB accessToken is required in ynab-config.json');
    }

    if (!config.budgetId) {
      throw new Error('YNAB budgetId is required in ynab-config.json');
    }

    if (!config.accountMappings || Object.keys(config.accountMappings).length === 0) {
      throw new Error('YNAB accountMappings is required in ynab-config.json');
    }

    return config as YNABConfig;
  }

  // No configuration found
  throw new Error(
    `YNAB configuration not found. Please create accounts.json with your YNAB settings.\n` +
    `See accounts.json.example for the format, or run: npm start setup-accounts`
  );
}

/**
 * Create a template accounts.json config file
 */
export function createAccountsConfigTemplate(): void {
  const template: AccountsConfig = {
    ynab: {
      accessToken: 'YOUR_YNAB_PERSONAL_ACCESS_TOKEN',
      budgetId: 'YOUR_BUDGET_ID_OR_USE_default',
    },
    notifications: {
      email: 'your-email@gmail.com', // Optional: Email to receive sync notifications
    },
    accountMappings: {
      '1610': {
        ynabAccountId: 'YNAB_ACCOUNT_ID_FOR_1610',
        ynabAccountName: 'Visa Mi País',
        description: 'Visa Mi País credit card',
      },
      '3709': {
        ynabAccountId: 'YNAB_ACCOUNT_ID_FOR_3709',
        ynabAccountName: 'Visa Débito Oro',
        description: 'Visa Débito Oro debit card',
      },
      '0014': {
        ynabAccountId: 'YNAB_ACCOUNT_ID_FOR_0014',
        ynabAccountName: 'Savings',
        description: 'Savings account linked to 3709',
      },
      '9508': {
        ynabAccountId: 'YNAB_ACCOUNT_ID_FOR_9508',
        ynabAccountName: 'Visa Mi País Other',
        description: 'Visa Mi País (Other)',
      },
    },
  };

  fs.writeJsonSync(ACCOUNTS_CONFIG_PATH, template, { spaces: 2 });
  console.log(`Created template config at ${ACCOUNTS_CONFIG_PATH}`);
  console.log('Please update it with your actual YNAB credentials and account IDs.');
  console.log('Run "npm start list-accounts" to get your YNAB account IDs.');
}

/**
 * Create a template YNAB config file (legacy)
 */
export function createYNABConfigTemplate(): void {
  const template = {
    accessToken: 'YOUR_YNAB_PERSONAL_ACCESS_TOKEN',
    budgetId: 'YOUR_BUDGET_ID_OR_USE_default',
    accountMappings: {
      '1610': 'YNAB_ACCOUNT_ID_FOR_1610',
      '3709': 'YNAB_ACCOUNT_ID_FOR_3709',
      '0014': 'YNAB_ACCOUNT_ID_FOR_0014',
      '9508': 'YNAB_ACCOUNT_ID_FOR_9508',
    },
  };

  fs.writeJsonSync(LEGACY_CONFIG_PATH, template, { spaces: 2 });
  console.log(`Created template config at ${LEGACY_CONFIG_PATH}`);
  console.log('Please update it with your actual YNAB credentials and account IDs.');
  console.log('Note: Consider using accounts.json instead (run: npm start setup-accounts)');
}

