// Owner notifications (spec Phase 6): desktop notification, optional Slack
// incoming webhook, and an optional end-of-day digest email to the owner's
// own address (platform-transactional, not prospecting — no approval gate).
// Every notification is recorded (also used to de-duplicate alerts).

import type { BizDb } from './db';
import type { CredentialStore } from './crypto/credentials';
import type { FetchFn } from './skills/types';
import { redactSensitive } from '@main/services/redaction';

export interface NotificationInput {
  templateKey: string;
  title: string;
  body: string;
  digest?: string;
}

export interface NotifierDeps {
  db: BizDb;
  credentials: CredentialStore;
  fetch: FetchFn;
  desktop?: (title: string, body: string) => void;
  now?: () => number;
}

export class Notifier {
  private readonly now: () => number;

  constructor(private readonly deps: NotifierDeps) {
    this.now = deps.now ?? Date.now;
  }

  notify(companyId: string, n: NotificationInput): void {
    void this.dispatch(companyId, n).catch(() => undefined);
  }

  async dispatch(companyId: string, n: NotificationInput): Promise<void> {
    const company = this.deps.db.companies.get(companyId);
    if (!company) return;
    const cfg = company.config.notifications;
    const payload = { title: n.title, body: n.body };
    let sent = false;

    if (cfg.desktop && this.deps.desktop) {
      try {
        this.deps.desktop(n.title, redactSensitive(n.body));
        this.deps.db.ops.notification({ companyId, channel: 'desktop', templateKey: n.templateKey, payload, status: 'sent', now: this.now() });
        sent = true;
      } catch {
        // desktop notifications are best-effort
      }
    }

    if (cfg.slack) {
      const hook = this.safeResolve(companyId, 'slack_webhook');
      if (hook && hook.startsWith('https://hooks.slack.com/')) {
        const text = `*${n.title}*\n${n.body}${n.digest ? `\n\n${n.digest.slice(0, 2_500)}` : ''}`;
        const res = await this.deps.fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        }).catch(() => null);
        this.deps.db.ops.notification({ companyId, channel: 'slack', templateKey: n.templateKey, payload, status: res?.ok ? 'sent' : 'failed', now: this.now() });
        sent = sent || Boolean(res?.ok);
      }
    }

    if (n.templateKey === 'evening_digest' && cfg.digestEmail && company.config.email.fromAddress) {
      const ok = await this.sendDigest(companyId, company.config.email.fromAddress, cfg.digestEmail, n);
      this.deps.db.ops.notification({ companyId, channel: 'email', templateKey: n.templateKey, payload, status: ok ? 'sent' : 'failed', now: this.now() });
      sent = sent || ok;
    }

    if (!sent) {
      this.deps.db.ops.notification({ companyId, channel: 'feed', templateKey: n.templateKey, payload, status: 'skipped', now: this.now() });
    }
  }

  private safeResolve(companyId: string, provider: string): string | null {
    try {
      return this.deps.credentials.resolve(companyId, provider)?.secret.reveal() ?? null;
    } catch {
      return null;
    }
  }

  private async sendDigest(companyId: string, from: string, to: string, n: NotificationInput): Promise<boolean> {
    const text = `${n.body}\n\n${n.digest ?? ''}\n\n— Flowstate business agent`;
    const resend = this.safeResolve(companyId, 'resend');
    try {
      if (resend) {
        const res = await this.deps.fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resend}` },
          body: JSON.stringify({ from, to: [to], subject: n.title, text }),
        });
        return res.ok;
      }
      const sendgrid = this.safeResolve(companyId, 'sendgrid');
      if (sendgrid) {
        const res = await this.deps.fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sendgrid}` },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: to }] }],
            from: { email: from },
            subject: n.title,
            content: [{ type: 'text/plain', value: text }],
          }),
        });
        return res.ok;
      }
    } catch {
      return false;
    }
    return false;
  }
}
