import { Parser, GmailMessageData, Transaction } from '../types';
import crypto from 'crypto';
import { parse, format, isValid } from 'date-fns';
import * as cheerio from 'cheerio';

export class CaribeParser implements Parser {
  name = 'CARIBE';

  getSearchTerms(): string[] {
    return ['from:NOTIFICACIONES@bancocaribe.com.do'];
  }

  canParse(message: GmailMessageData): boolean {
    return (
      message.from.includes('NOTIFICACIONES@bancocaribe.com.do') &&
      (
        message.subject.includes('Notificación Caribe') ||
        message.subject.includes('Tarjeta de Crédito Caribe') ||
        message.subject.includes('transacción')
      )
    );
  }

  parse(message: GmailMessageData): Transaction | null {
    if (!message.htmlBody) return null;

    const $ = cheerio.load(message.htmlBody);
    const text = $.root().text();

    // Normalize whitespace
    const cleanText = text.replace(/\s+/g, ' ');

    // Extract card ending (last 4 digits)
    // Format: "terminada 1469" or "terminada en 1469"
    const cardMatch = cleanText.match(/terminada\s+(?:en\s+)?(\d{4})/i) ||
                     cleanText.match(/Tarjeta.*?(\d{4})/i);
    const account = cardMatch ? cardMatch[1] : undefined;

    if (!account) {
      console.warn('CARIBE: Could not extract card ending');
      return null;
    }

    // Extract amount
    // Format: "Monto: 14,920.82" or "Monto: 14920.82"
    const amountMatch = cleanText.match(/Monto:\s*([\d,]+\.?\d*)/i);
    if (!amountMatch) {
      console.warn('CARIBE: Could not extract amount');
      return null;
    }
    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));

    // Extract payee (Comercio/Merchant)
    // Format: "Comercio: DOMEX COURIER BELLA V SANTO DOMINGODO"
    let payee = '';
    const comercioMatch = cleanText.match(/Comercio:\s*([^\n\r]+?)(?:\s+Monto|\s+Moneda|$)/i) ||
                         cleanText.match(/transacción\s+en:\s*([^\n\r]+?)(?:\s+Monto|\s+Moneda|$)/i);

    if (comercioMatch) {
      payee = comercioMatch[1].trim();
    } else {
      // Fallback: try to extract from transaction text
      const transactionMatch = cleanText.match(/transacción\s+en\s+([A-Z][A-Z\s]+?)(?:\s+Monto|\s+Moneda|$)/i);
      if (transactionMatch) {
        payee = transactionMatch[1].trim();
      } else {
        payee = 'CARIBE Transaction';
      }
    }

    // Extract date
    // Format: "Fecha: 07/11/2025" and "Hora: 12:42:46"
    let txDate: Date;
    const fechaMatch = cleanText.match(/Fecha:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    const horaMatch = cleanText.match(/Hora:\s*(\d{1,2}):(\d{2}):(\d{2})/i);

    if (fechaMatch && horaMatch) {
      const day = parseInt(fechaMatch[1]);
      const month = parseInt(fechaMatch[2]);
      const year = parseInt(fechaMatch[3]);
      const hour = parseInt(horaMatch[1]);
      const minute = parseInt(horaMatch[2]);

      txDate = new Date(year, month - 1, day, hour, minute);
    } else if (fechaMatch) {
      // If only date is available, use email time
      const day = parseInt(fechaMatch[1]);
      const month = parseInt(fechaMatch[2]);
      const year = parseInt(fechaMatch[3]);
      txDate = new Date(year, month - 1, day, message.date.getHours(), message.date.getMinutes());
    } else {
      // Fallback to email date
      txDate = message.date;
    }

    if (!isValid(txDate)) {
      console.warn('CARIBE: Invalid date, using email date');
      txDate = message.date;
    }

    // Create transaction ID fingerprint
    const dateStr = format(txDate, 'yyyy-MM-dd');
    const id = crypto
      .createHash('md5')
      .update(`CARIBE:${account}:${dateStr}:${amount}:${payee}:outflow`)
      .digest('hex');

    const transaction: Transaction = {
      id,
      bank: 'CARIBE',
      account,
      date: dateStr,
      payee: payee.trim(),
      memo: `CARIBE Credit Card ending in ${account}`,
      amount,
      currency: 'DOP',
      direction: 'outflow', // Credit card spending is always outflow
      rawMessageId: message.id,
      rawThreadId: message.threadId,
    };

    return transaction;
  }
}

