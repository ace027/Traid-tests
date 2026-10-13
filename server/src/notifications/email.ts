import type { EmailSettings } from '@sonarr/shared';
import { detailLines, summary } from './payload.js';
import { sendMail } from './smtp.js';
import type { NotificationMessage, NotificationProvider, ProviderDeps } from './types.js';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class EmailProvider implements NotificationProvider {
  constructor(
    private readonly settings: EmailSettings,
    private readonly deps: ProviderDeps = {},
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    const line = summary(message);
    const details = detailLines(message);
    const text = [line, '', ...details.map(([k, v]) => `${k}: ${v}`)].join('\n');
    const html = `<p><strong>${escapeHtml(line)}</strong></p>${
      details.length > 0 ? `<ul>${details.map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(v)}</li>`).join('')}</ul>` : ''
    }`;
    const s = this.settings;
    const send = this.deps.sendMail ?? sendMail;
    await send({
      host: s.server,
      port: s.port,
      secure: s.port === 465,
      starttls: s.useEncryption,
      username: s.username,
      password: s.password,
      from: s.from,
      to: s.to,
      cc: s.cc,
      bcc: s.bcc,
      subject: `[Sonarr] ${line}`,
      text,
      html,
    });
  }

  test(): Promise<void> {
    return this.send({ eventType: 'Test' });
  }
}
