import { GmailClient } from '../gmail/client';
import { format } from 'date-fns';

export interface SyncSummary {
  processed: number;
  newTransactions: number;
  errors: number;
  syncedToYNAB: number;
  ynabErrors: number;
  errorBreakdown?: Record<string, number>;
}

/**
 * Send email notification after sync completion
 */
export async function sendSyncNotification(
  summary: SyncSummary,
  recipientEmail: string
): Promise<boolean> {
  try {
    const gmail = new GmailClient();
    await gmail.init();

    const date = format(new Date(), 'yyyy-MM-dd HH:mm:ss');

    const subject = `✅ Bank Sync Complete - ${summary.newTransactions} new transactions`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4CAF50; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
    .summary { background-color: white; padding: 15px; margin: 10px 0; border-radius: 5px; }
    .success { color: #4CAF50; font-weight: bold; }
    .error { color: #f44336; font-weight: bold; }
    .info { color: #2196F3; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f2f2f2; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>✅ Bank Sync Complete</h2>
      <p style="margin: 0;">${date}</p>
    </div>
    <div class="content">
      <div class="summary">
        <h3>Sync Summary</h3>
        <table>
          <tr>
            <th>Metric</th>
            <th>Count</th>
          </tr>
          <tr>
            <td>Emails Processed</td>
            <td class="info">${summary.processed}</td>
          </tr>
          <tr>
            <td>New Transactions Found</td>
            <td class="success">${summary.newTransactions}</td>
          </tr>
          <tr>
            <td>Synced to YNAB</td>
            <td class="success">${summary.syncedToYNAB}</td>
          </tr>
          ${summary.errors > 0 ? `
          <tr>
            <td>Parsing Errors</td>
            <td class="error">${summary.errors}</td>
          </tr>
          ` : ''}
          ${summary.ynabErrors > 0 ? `
          <tr>
            <td>YNAB Sync Errors</td>
            <td class="error">${summary.ynabErrors}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${summary.errorBreakdown && Object.keys(summary.errorBreakdown).length > 0 ? `
      <div class="summary">
        <h3>Error Breakdown</h3>
        <table>
          <tr>
            <th>Error Type</th>
            <th>Count</th>
          </tr>
          ${Object.entries(summary.errorBreakdown).map(([type, count]) => `
          <tr>
            <td>${type}</td>
            <td class="error">${count}</td>
          </tr>
          `).join('')}
        </table>
      </div>
      ` : ''}

      ${summary.newTransactions === 0 && summary.errors === 0 ? `
      <p class="success">✨ No new transactions found. Everything is up to date!</p>
      ` : ''}

      ${summary.ynabErrors > 0 ? `
      <div class="summary" style="border-left: 4px solid #f44336;">
        <p><strong>⚠️ Some transactions failed to sync to YNAB.</strong></p>
        <p>Run <code>npm start retry-ynab</code> to retry failed transactions.</p>
      </div>
      ` : ''}
    </div>
    <div class="footer">
      <p>This is an automated notification from your Bank Sync service.</p>
      <p>Sync completed at ${date}</p>
    </div>
  </div>
</body>
</html>
    `.trim();

    const messageId = await gmail.sendEmail({
      to: recipientEmail,
      subject,
      body: summary.newTransactions > 0
        ? `Bank sync completed. Found ${summary.newTransactions} new transactions. ${summary.syncedToYNAB} synced to YNAB.`
        : 'Bank sync completed. No new transactions found.',
      htmlBody,
    });

    if (messageId) {
      console.log(`\n📧 Sync notification email sent to ${recipientEmail}`);
      return true;
    } else {
      console.warn(`\n⚠️  Failed to send notification email to ${recipientEmail}`);
      return false;
    }
  } catch (error: any) {
    console.warn(`\n⚠️  Failed to send notification email: ${error.message}`);
    return false;
  }
}

