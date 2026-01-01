import { Parser, GmailMessageData, Transaction } from '../types';
import crypto from 'crypto';
import { parse, format, isValid } from 'date-fns';
import * as cheerio from 'cheerio';

export class QIKParser implements Parser {
  name = 'QIK';

  getSearchTerms(): string[] {
    return ['from:notificaciones@qik.do'];
  }

  canParse(message: GmailMessageData): boolean {
    return (
      message.from.includes('notificaciones@qik.do') &&
      message.subject.includes('Usaste tu tarjeta de crédito Qik')
    );
  }

  parse(message: GmailMessageData): Transaction | null {
    if (!message.htmlBody) return null;

    const $ = cheerio.load(message.htmlBody);
    const text = $.root().text();

    // Normalize whitespace
    const cleanText = text.replace(/\s+/g, ' ');

    // Extract card ending (last 4 digits)
    // Format: "Tarjeta 53*************5550" or "termina en 53*************5550"
    const cardMatch = cleanText.match(/Tarjeta\s+\d+\*+(\d{4})|termina\s+en\s+\d+\*+(\d{4})/i);
    const account = cardMatch ? (cardMatch[1] || cardMatch[2]) : undefined;

    if (!account) {
      console.warn('QIK: Could not extract card ending');
      return null;
    }

    // Extract amount
    // Format: "RD$ 1.00" or "RD$1.00"
    const amountMatch = cleanText.match(/RD\$\s*([\d,]+\.?\d*)/i);
    if (!amountMatch) {
      console.warn('QIK: Could not extract amount');
      return null;
    }
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Extract payee (Localidad)
    // Format: "Localidad: RD VIAL APP" or "en RD VIAL APP"
    let payee = '';
    const localidadMatch = cleanText.match(/Localidad:\s*([^\n\r]+)/i) ||
                          cleanText.match(/en\s+([A-Z][A-Z\s]+(?:APP|STORE|MARKET|SUPER|GAS|RESTAURANT|CAFE|HOTEL|MALL|CENTER|PLAZA|SHOP|TIENDA|FARMACIA|BANCO|BANK)[^\n\r]*)/i) ||
                          cleanText.match(/Se hizo una transacción.*?en\s+([A-Z][A-Z\s]+?)\s+con/i);

    if (localidadMatch) {
      payee = localidadMatch[1].trim();
    } else {
      // Fallback: try to extract from the main transaction text
      const transactionMatch = cleanText.match(/transacción.*?en\s+([A-Z][A-Z\s]+?)\s+con/i);
      if (transactionMatch) {
        payee = transactionMatch[1].trim();
      } else {
        payee = 'QIK Transaction';
      }
    }

    // Extract date
    // Format: "12-30-2025 08:49 AM (AST)" or "Fecha y hora: 12-30-2025 08:49 AM"
    let txDate: Date;
    const dateMatch = cleanText.match(/(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i) ||
                      cleanText.match(/Fecha y hora[:\s]+(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);

    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const day = parseInt(dateMatch[2]);
      const year = parseInt(dateMatch[3]);
      let hour = parseInt(dateMatch[4]);
      const minute = parseInt(dateMatch[5]);
      const ampm = dateMatch[6].toUpperCase();

      if (ampm === 'PM' && hour !== 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;

      txDate = new Date(year, month - 1, day, hour, minute);
    } else {
      // Fallback to email date
      txDate = message.date;
    }

    if (!isValid(txDate)) {
      console.warn('QIK: Invalid date, using email date');
      txDate = message.date;
    }

    // Create transaction ID fingerprint
    const dateStr = format(txDate, 'yyyy-MM-dd');
    const id = crypto
      .createHash('md5')
      .update(`QIK:${account}:${dateStr}:${amount}:${payee}:outflow`)
      .digest('hex');

    const transaction: Transaction = {
      id,
      bank: 'QIK',
      account,
      date: dateStr,
      payee: payee.trim(),
      memo: `QIK Credit Card ending in ${account}`,
      amount,
      currency: 'DOP',
      direction: 'outflow', // Credit card spending is always outflow
      rawMessageId: message.id,
      rawThreadId: message.threadId,
    };

    return transaction;
  }
}

