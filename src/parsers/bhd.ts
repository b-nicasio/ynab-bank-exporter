import { Parser, GmailMessageData, Transaction } from '../types';
import crypto from 'crypto';
import { parse, isValid } from 'date-fns';
import * as cheerio from 'cheerio';

export class BHDParser implements Parser {
  name = 'BHD';

  getSearchTerms(): string[] {
    return ['from:Alertas@bhd.com.do'];
  }

  canParse(message: GmailMessageData): boolean {
    return (
      message.from.includes('Alertas@bhd.com.do') &&
      (
        message.subject.includes('BHD Notificación de Transacciones') ||
        message.subject.includes('Transacciones entre mis productos') ||
        message.subject.includes('Transferencias a terceros') ||
        message.subject.includes('Pago de Servicios')
      )
    );
  }

  parse(message: GmailMessageData): Transaction | null {
    if (!message.htmlBody) return null;
    const $ = cheerio.load(message.htmlBody);
    const text = $.root().text();

    if (message.subject.includes('Transacciones entre mis productos') || message.subject.includes('Transferencias')) {
        return this.parseTransfer(message, $, text);
    } else {
        return this.parseNotification(message, $, text);
    }
  }

  private parseTransfer(message: GmailMessageData, $: any, text: string): Transaction | null {
    // Strategy: Look for key-value pairs in the text or specific structure.
    // "Producto destino: XXXXXXXXXXXX1610"
    // "Monto: RD$ 26,830.95"
    // "Fecha y hora de la transacción: 20/12/2025 - 11:29 PM"

    // Normalize spaces
    const cleanText = text.replace(/\s+/g, ' ');

    const destMatch = cleanText.match(/Producto destino:.*?(\d{4})/i);
    const account = destMatch ? destMatch[1] : undefined;

    // Try to find full name for destination if possible? Usually hidden XXXXX.
    // We can just use "BHD Account" or similar.

    const amountMatch = cleanText.match(/Monto:\s*(RD|US|DO)?\$?\s?([\d,]+\.\d{2})/i);
    if (!amountMatch) return null;

    const currency = (amountMatch[1] || 'RD').replace('RD', 'DOP').trim();
    const amount = parseFloat(amountMatch[2].replace(/,/g, ''));

    const dateMatch = cleanText.match(/Fecha y hora de la transacción:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)/i);
    let date = '';
    if (dateMatch) {
        // 20/12/2025 11:29 PM
        const dateStr = `${dateMatch[1]} ${dateMatch[2]}`;
        const parsedDate = parse(dateStr, 'dd/MM/yyyy hh:mm a', new Date());
        date = isValid(parsedDate) ? parsedDate.toISOString().split('T')[0] : '';
    }

    const payeeMatch = cleanText.match(/Beneficiario:\s*(.*?)(?=\s*Número de confirmación|$)/i);
    const payee = payeeMatch ? payeeMatch[1].trim() : 'Transfer';

    // Logic: If the destination product matches one of our known products, treat as inflow.
    // Known accounts: 1610 (Visa Mi País), 3709 (Visa Débito Oro), 0014 (Savings linked to 3709)
    // If Origin is one of our products -> Outflow.
    // If Destination is one of our products -> Inflow.

    // We need to parse Origin as well to verify.
    const originMatch = cleanText.match(/Producto origen:.*?(\d{4})/i);
    const originAccount = originMatch ? originMatch[1] : undefined;

    // My Known Accounts
    const myAccounts = ['1610', '3709', '0014', '9508'];

    let direction: 'inflow' | 'outflow' = 'outflow';

    if (account && myAccounts.includes(account)) {
        direction = 'inflow';
    } else if (originAccount && myAccounts.includes(originAccount)) {
        direction = 'outflow';
    }

    // If both origin and destination are mine (Transfer between my accounts),
    // strictly speaking it's a Transfer, but for a single transaction record we need to pick a side.
    // YNAB handles transfers by matching an outflow from A and inflow to B.
    // Since we generate ONE transaction record per email, we need to decide which "side" this email represents.
    // Usually "Transacciones entre mis productos" implies a transfer.
    // If the email doesn't explicitly say which side it is notifying for, we might need to duplicate it?
    // Or just let it be an inflow to the destination (and manually handle the outflow in YNAB or hope for a second email).
    // BHD usually sends one email.
    // Let's stick to: If Dest is mine -> Inflow. (Unless I am paying someone else).

    // Wait, if I transfer from 0014 to 1610 (Payment), Dest is 1610 (Inflow to CC), Origin is 0014 (Outflow from Savings).
    // This transaction should probably be recorded for the SOURCE account if it's an expense/transfer out,
    // OR for the DEST account if it's a payment/transfer in.
    // Currently `account` variable holds the DESTINATION account digits.
    // So the transaction is currently linked to the DESTINATION.

    // The email usually highlights the "Destination" or the "Transaction".
    // If `account` (dest) is mine, it's an inflow to that account.

    // What if I transfer to a THIRD party?
    // Dest is External. Origin is Mine (0014).
    // `account` (dest) will be External digits.
    // `originAccount` will be 0014.
    // We want this to appear as Outflow for the origin account.
    // So we must swap `account` to be `originAccount` if Dest is not mine but Origin is mine.

    if (account && !myAccounts.includes(account) && originAccount && myAccounts.includes(originAccount)) {
        // Transfer to third party
        // Set the main account of this transaction to be the Origin (my account)
        // And direction is Outflow.

        const fingerprintInput = `${this.name}:${originAccount}:${date}:${amount}:${payee}:outflow`;
        const id = crypto.createHash('md5').update(fingerprintInput).digest('hex');

        return {
            id,
            bank: 'BHD',
            account: originAccount, // Use Origin as the account for this transaction
            date,
            payee,
            memo: 'Transferencia a terceros',
            amount,
            currency,
            direction: 'outflow',
            rawMessageId: message.id,
            rawThreadId: message.threadId
        };
    }

    // Case: Transfer between my accounts (0014 -> 1610)
    // Account (Dest) = 1610. Origin = 0014.
    // Currently mapping to 1610 (Inflow).
    // If we want it to show up in 0014 as Outflow too, we'd need a second transaction record.
    // For now, let's just leave it as Inflow to Dest.

    const fingerprintInput = `${this.name}:${account}:${date}:${amount}:${payee}:${direction}`;
    const id = crypto.createHash('md5').update(fingerprintInput).digest('hex');

    return {
      id,
      bank: 'BHD',
      account,
      date,
      payee,
      memo: 'Transferencia entre productos',
      amount,
      currency,
      direction,
      rawMessageId: message.id,
      rawThreadId: message.threadId
    };
  }

  private parseNotification(message: GmailMessageData, $: any, text: string): Transaction | null {
    // Extract Account: "Visa Mi País # 1610" or "Visa Débito Oro # 3709"
    // Looks for patterns like: "Visa Mi País # 1610" in the text
    const accountMatch = text.match(/(Visa\s+.*?)#\s?(\d{4})/i);
    const accountName = accountMatch ? accountMatch[1].trim() : undefined;
    const accountLast4 = accountMatch ? accountMatch[2] : undefined;
    const account = accountLast4; // Keep using last4 for the Transaction.account field

    let dateRaw: string | undefined;
    let currencyRaw: string | undefined;
    let amountRaw: string | undefined;
    let payeeRaw: string | undefined;
    let statusRaw: string | undefined;
    let typeRaw: string | undefined;

    // Find the data row
    // Strategy: Look for a TR where the first TD matches the date format dd/MM/yyyy
    $('tr').each((i: any, el: any) => {
        const tds = $(el).find('td');
        if (tds.length >= 4) {
            const firstCell = $(tds[0]).text().trim().replace(/\s+/g, ' ');
            // Check for date format: 26/12/2025 01:04 pm
            if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[ap]m$/i.test(firstCell)) {
                dateRaw = firstCell;
                currencyRaw = $(tds[1]).text().trim();
                amountRaw = $(tds[2]).text().trim();
                payeeRaw = $(tds[3]).text().trim();
                statusRaw = $(tds[4]).text().trim();
                if (tds.length >= 6) {
                    typeRaw = $(tds[5]).text().trim();
                }
                return false; // Break loop
            }
        }
    });

    if (!dateRaw || !amountRaw || !payeeRaw) return null;

    // Parse Amount: "$1,000.00" -> 1000.00
    const amount = parseFloat(amountRaw.replace(/[$,]/g, ''));

    // Parse Date
    const parsedDate = parse(dateRaw, 'dd/MM/yyyy hh:mm a', new Date());
    const date = isValid(parsedDate) ? parsedDate.toISOString().split('T')[0] : '';

    const payee = payeeRaw.replace(/\s+/g, ' ').trim();
    const currency = currencyRaw?.replace('RD', 'DOP').trim() || 'DOP';

    // Determine direction
    let direction: 'inflow' | 'outflow' = 'outflow';

    // Check keywords in Payee
    if (payee.match(/REVERSO|DEVOLUCION|CREDITO|ABONO|PAGO RECIBIDO/i)) {
        direction = 'inflow';
    }

    // Check 'Tipo' column if available (e.g. 'Crédito' vs 'Consumo')
    if (typeRaw) {
        if (typeRaw.match(/Crédito|Abono|Reverso/i)) {
            direction = 'inflow';
        }
    }

    const fingerprintInput = `${this.name}:${account}:${date}:${amount}:${payee}:${direction}`;
    const id = crypto.createHash('md5').update(fingerprintInput).digest('hex');

    const memo = accountName && accountLast4 ? `${accountName} ${accountLast4}` : 'BHD Transaction';

    return {
      id,
      bank: 'BHD',
      account,
      date,
      payee,
      memo,
      amount,
      currency,
      direction,
      rawMessageId: message.id,
      rawThreadId: message.threadId
    };
  }
}
