export interface Transaction {
  id: string; // fingerprint
  bank: string;
  account?: string; // last 4 digits
  date: string; // YYYY-MM-DD
  payee: string;
  memo: string;
  amount: number;
  currency: string;
  direction: 'inflow' | 'outflow';
  rawMessageId: string;
  rawThreadId: string;
}

export interface GmailMessageData {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: Date;
  snippet: string;
  plainBody: string;
  htmlBody: string;
}

export interface Parser {
  name: string;
  // Returns a Gmail search query fragment (e.g. 'from:alertas@bhd.com.do')
  getSearchTerms(): string[];
  canParse(message: GmailMessageData): boolean;
  parse(message: GmailMessageData): Transaction | null;
}

export interface ParseResult {
  success: boolean;
  transaction?: Transaction;
  error?: string;
  messageId: string;
}
