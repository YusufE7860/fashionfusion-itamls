import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;
  readonly enabled: boolean;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.SMTP_FROM ?? 'ITAMLS <no-reply@fashionfusion.local>';
    this.enabled = !!host;
    if (!this.enabled) {
      this.logger.warn('SMTP not configured — emails will be logged but not sent. Set SMTP_HOST/PORT/USER/PASS in .env.');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
      auth: user ? { user, pass } : undefined,
    });
    this.logger.log(`SMTP configured: ${host}:${process.env.SMTP_PORT ?? 587}`);
  }

  async send(to: string | string[], subject: string, html: string, text?: string) {
    const recipients = Array.isArray(to) ? to : [to];
    if (recipients.length === 0) return;
    if (!this.enabled || !this.transporter) {
      this.logger.log(`[email-dry-run] to=${recipients.join(',')} subject="${subject}"`);
      return;
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.from, to: recipients.join(','), subject, html, text: text ?? stripHtml(html),
      });
      this.logger.log(`Mail sent: ${info.messageId} → ${recipients.join(',')}`);
    } catch (e: any) {
      this.logger.error(`Mail send failed: ${e.message}`);
    }
  }

  /** Branded HTML template wrap. */
  wrap(title: string, bodyHtml: string) {
    return `
<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#050810;font-family:Inter,system-ui,sans-serif;color:#e8eef9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 16px;background:#050810;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#141c30;border:1px solid #293659;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#0f1626;padding:18px 24px;border-bottom:3px solid #fe6620;">
          <div style="font-size:10px;letter-spacing:4px;color:#fe6620;font-weight:700;">FASHION FUSION</div>
          <div style="font-size:18px;color:#fff;font-weight:700;margin-top:4px;">${escapeHtml(title)}</div>
        </td></tr>
        <tr><td style="padding:24px;color:#c8d3e6;font-size:14px;line-height:1.5;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #293659;font-size:11px;color:#7a8aa8;">
          ITAMLS · IT Asset Management &amp; Logistics System
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  }
}

function stripHtml(s: string) { return s.replace(/<[^>]+>/g, ''); }
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}
