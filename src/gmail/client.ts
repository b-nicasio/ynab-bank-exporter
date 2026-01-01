import { google, gmail_v1 } from 'googleapis';
import { authorize } from './auth';
import { GmailMessageData } from '../types';

export class GmailClient {
  private gmail: gmail_v1.Gmail | null = null;

  async init() {
    const auth = await authorize();
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async listMessages(query: string): Promise<gmail_v1.Schema$Message[]> {
    if (!this.gmail) await this.init();

    let messages: gmail_v1.Schema$Message[] = [];
    let nextPageToken: string | undefined = undefined;

    do {
      const res: any = await this.gmail!.users.messages.list({
        userId: 'me',
        q: query,
        pageToken: nextPageToken,
        maxResults: 500
      });

      if (res.data.messages) {
        messages = messages.concat(res.data.messages);
      }
      nextPageToken = res.data.nextPageToken || undefined;
    } while (nextPageToken); // Be careful with infinite loops if many messages, maybe limit or iterate carefully.
    // For now, let's fetch all matching query. User provided query should be specific (e.g. newer_than:...)

    return messages;
  }

  async getMessage(id: string): Promise<GmailMessageData | null> {
    if (!this.gmail) await this.init();

    try {
      const res = await this.gmail!.users.messages.get({
        userId: 'me',
        id: id,
        format: 'full',
      });

      const payload = res.data.payload;
      if (!payload) return null;

      const headers = payload.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || '';
      const from = headers.find(h => h.name === 'From')?.value || '';
      const dateStr = headers.find(h => h.name === 'Date')?.value || '';
      const date = new Date(dateStr);
      const snippet = res.data.snippet || '';

      let plainBody = '';
      let htmlBody = '';

      const getBody = (parts: gmail_v1.Schema$MessagePart[]): { plain: string, html: string } => {
        let plain = '';
        let html = '';
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            plain += Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.mimeType === 'text/html' && part.body?.data) {
            html += Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.parts) {
            const { plain: p, html: h } = getBody(part.parts);
            plain += p;
            html += h;
          }
        }
        return { plain, html };
      };

      if (payload.body?.data) {
        if (payload.mimeType === 'text/html') {
             htmlBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        } else {
             plainBody = Buffer.from(payload.body.data, 'base64').toString('utf-8');
        }
      } else if (payload.parts) {
        const { plain, html } = getBody(payload.parts);
        plainBody = plain;
        htmlBody = html;
      }

      return {
        id: res.data.id!,
        threadId: res.data.threadId!,
        subject,
        from,
        date,
        snippet,
        plainBody,
        htmlBody
      };
    } catch (error) {
      console.error(`Failed to fetch message ${id}`, error);
      return null;
    }
  }

  /**
   * Encode email subject for RFC 2047 (handles UTF-8 characters like emojis)
   */
  private encodeSubject(subject: string): string {
    // Check if subject contains non-ASCII characters
    const hasNonASCII = /[^\x00-\x7F]/.test(subject);

    if (!hasNonASCII) {
      return subject;
    }

    // Encode using RFC 2047 Base64 encoding
    // Format: =?UTF-8?B?<base64>?=
    const encoded = Buffer.from(subject, 'utf-8')
      .toString('base64')
      .replace(/\n/g, '');

    // Split into chunks of 75 characters (RFC 2047 limit per line)
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += 75) {
      chunks.push(encoded.substring(i, i + 75));
    }

    return chunks.map(chunk => `=?UTF-8?B?${chunk}?=`).join('\r\n ');
  }

  /**
   * Send an email using Gmail API
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    body: string;
    htmlBody?: string;
  }): Promise<string | null> {
    if (!this.gmail) await this.init();

    try {
      // Create email message in RFC 5322 format
      const encodedSubject = this.encodeSubject(options.subject);
      const messageParts = [
        `To: ${options.to}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=utf-8',
        '',
        options.htmlBody || options.body,
      ];

      const message = messageParts.join('\r\n');

      // Encode message in base64url format (RFC 4648) as required by Gmail API
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await this.gmail!.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      return res.data.id || null;
    } catch (error) {
      console.error('Failed to send email:', error);
      return null;
    }
  }
}

