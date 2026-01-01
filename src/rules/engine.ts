import fs from 'fs-extra';
import path from 'path';
import { Transaction } from '../types';

interface Rule {
  match: string; // Regex or exact match string
  payee?: string; // New payee name
  memo?: string; // Append to memo
  category?: string; // Suggestion (for future YNAB category mapping)
}

interface RulesConfig {
  merchant_normalization: Rule[];
}

const RULES_PATH = path.join(process.cwd(), 'rules.json');

export class RulesEngine {
  private rules: RulesConfig = { merchant_normalization: [] };

  constructor() {
    this.load();
  }

  load() {
    if (fs.existsSync(RULES_PATH)) {
      this.rules = fs.readJsonSync(RULES_PATH);
    } else {
      // Create default
      this.rules = { merchant_normalization: [] };
      fs.writeJsonSync(RULES_PATH, this.rules, { spaces: 2 });
    }
  }

  apply(transaction: Transaction): Transaction {
    let t = { ...transaction };

    for (const rule of this.rules.merchant_normalization) {
      const regex = new RegExp(rule.match, 'i');
      if (regex.test(t.payee)) {
        if (rule.payee) t.payee = rule.payee;
        if (rule.memo) t.memo = (t.memo ? t.memo + ' ' : '') + rule.memo;
      }
    }

    return t;
  }
}

export const rulesEngine = new RulesEngine();

