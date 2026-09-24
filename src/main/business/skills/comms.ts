// Outbound communication: email (Resend / SendGrid) and publishing a saved
// draft (X API v2, or any publish webhook — Buffer/Zapier/Make/n8n).
// Category outbound/publish: gated by the approval matrix; dedupe, daily
// caps, unsubscribes and opt-out footers are enforced here, server-side.

import { z } from 'zod';
import { brandViolations } from '../memory/brand';
import { readJson, skillToolName, type Skill, type SkillContext } from './types';

const DAY = 24 * 60 * 60_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OPT_OUT_RE = /unsubscribe|opt[\s-]?out|don't want (these|more) emails/i;

const emailArgs = z.object({
  to: z.string().max(200).regex(EMAIL_RE, 'must be an email address'),
  subject: z.string().min(2).max(200),
  body: z.string().min(10).max(20_000),
  kind: z.enum(['outreach', 'support_reply']),
  ticket_id: z.string().max(64).optional(),
});
type EmailArgs = z.infer<typeof emailArgs>;

export function withOptOut(body: string, footer: string): string {
  return OPT_OUT_RE.test(body) ? body : `${body.trimEnd()}\n\n--\n${footer}`;
}

async function sendViaResend(ctx: SkillContext, key: string, a: EmailArgs, text: string, idem: string): Promise<string> {
  const { fromAddress, fromName } = ctx.company.config.email;
  const res = await ctx.fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'Idempotency-Key': idem.slice(0, 64),
    },
    body: JSON.stringify({
      from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
      to: [a.to],
      subject: a.subject,
      text,
    }),
  });
  const body = (await readJson(res, 'Resend')) as { id?: string };
  return body.id ?? 'sent';
}

async function sendViaSendgrid(ctx: SkillContext, key: string, a: EmailArgs, text: string): Promise<string> {
  const { fromAddress, fromName } = ctx.company.config.email;
  const res = await ctx.fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: a.to }] }],
      from: { email: fromAddress, ...(fromName ? { name: fromName } : {}) },
      subject: a.subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });
  if (!res.ok) await readJson(res, 'SendGrid');
  return res.headers.get('x-message-id') ?? 'accepted';
}

export const emailSend: Skill<EmailArgs> = {
  key: 'email.send',
  toolName: skillToolName('email.send'),
  name: 'Send an email',
  description:
    'Send one plain-text email (outreach to a qualified lead, or a support reply). It is queued for the owner unless policy allows it; dedupe, daily caps, unsubscribes and the opt-out footer are enforced automatically.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string' },
      subject: { type: 'string' },
      body: { type: 'string' },
      kind: { type: 'string', enum: ['outreach', 'support_reply'] },
      ticket_id: { type: 'string' },
    },
    required: ['to', 'subject', 'body', 'kind'],
  },
  schema: emailArgs,
  category: 'outbound',
  risk: 'medium',
  costCredits: 2,
  channel: 'email',
  providers: ['resend', 'sendgrid'],
  rubric: [
    "Recipient matches the company's ICP as defined in config",
    'At least one genuinely personalized line (references a real signal)',
    'Unsubscribe/opt-out mechanism included',
    'No recipient emailed twice within 7 days',
    'Daily send volume within the configured limit',
    'Sender account warmed appropriately for this volume',
  ],
  failureConditions: ['Recipient unsubscribed', 'Contacted in the last 7 days', 'No sender address configured', 'Provider rejected the message'],
  precondition(ctx, a) {
    if (!ctx.company.config.email.fromAddress) {
      return { ok: false, reason: 'no sender address configured (Business → Settings → Email)' };
    }
    const lead = ctx.db.work.getLeadByEmail(ctx.companyId, a.to);
    if (lead?.status === 'unsubscribed') return { ok: false, reason: `${a.to} unsubscribed` };
    if (a.kind === 'outreach') {
      if (!lead) return { ok: false, reason: `${a.to} is not a saved lead — qualify them with leads_save first` };
      const last = ctx.db.work.lastContacted(ctx.companyId, a.to);
      if (last && ctx.now() - last < 7 * DAY) {
        return { ok: false, reason: `${a.to} was emailed ${Math.round((ctx.now() - last) / DAY)} day(s) ago (7-day rule)` };
      }
    }
    const violations = brandViolations(`${a.subject}\n${a.body}`, ctx.company.config.brandDonts);
    if (violations.length) return { ok: false, reason: `contains brand "don't" phrases: ${violations.join(', ')}` };
    return { ok: true };
  },
  preview: (a) => ({ title: `Email ${a.to}: ${a.subject}`, summary: a.body }),
  async execute(ctx, a, exec) {
    const text = a.kind === 'outreach' ? withOptOut(a.body, ctx.company.config.email.optOutFooter) : a.body;
    const resend = ctx.credentials.resolve('resend');
    const id = resend
      ? await sendViaResend(ctx, resend.secret.reveal(), a, text, exec.idempotencyKey)
      : await (async () => {
          const sg = ctx.credentials.resolve('sendgrid');
          if (!sg) throw new Error('no email provider connected');
          return sendViaSendgrid(ctx, sg.secret.reveal(), a, text);
        })();
    ctx.db.work.logOutbound(ctx.companyId, 'email', a.to, id, ctx.now());
    ctx.db.work.markLeadContacted(ctx.companyId, a.to, ctx.now());
    if (a.ticket_id && ctx.db.work.getTicket(ctx.companyId, a.ticket_id)) {
      ctx.db.work.updateTicket(ctx.companyId, a.ticket_id, { status: 'pending' }, ctx.now());
    }
    return { ok: true, content: `Email sent to ${a.to} (provider id ${id}).`, stateChange: true };
  },
  postRunLearn(_ctx, a, result) {
    if (result.ok || !/bounce|invalid|does not exist|rejected/i.test(result.content)) return [];
    return [
      {
        condition: `sending ${a.kind} email to an address like ${a.to.replace(/^[^@]+/, '*')}`,
        action: 'verify the address from a primary source before emailing; do not guess patterns',
        rationale: `Provider rejected the message: ${result.content.slice(0, 160)}`,
        polarity: 'avoid',
        confidence: 0.6,
      },
    ];
  },
};

// ── publish a saved draft ───────────────────────────────────────────────────

const publishArgs = z.object({
  draft_id: z.string().min(1).max(64),
  channel: z.enum(['x', 'webhook']).optional(),
});

export const socialPublish: Skill<z.infer<typeof publishArgs>> = {
  key: 'social.publish',
  toolName: skillToolName('social.publish'),
  name: 'Publish a saved draft',
  description:
    'Publish a draft you saved earlier (by draft_id) to X or the configured publishing webhook (Buffer/Zapier/Make). Queued for the owner until the company has enough clean publishes.',
  parameters: {
    type: 'object',
    properties: { draft_id: { type: 'string' }, channel: { type: 'string', enum: ['x', 'webhook'] } },
    required: ['draft_id'],
  },
  schema: publishArgs,
  category: 'publish',
  risk: 'medium',
  costCredits: 1,
  channel: 'social',
  providers: ['x', 'publish_webhook'],
  rubric: ['Draft matches brand voice', 'No unsupported claims', 'Within the daily post limit'],
  failureConditions: ['Draft missing or already published', 'Over 280 characters for X', 'Brand violation'],
  precondition(ctx, a) {
    const d = ctx.db.work.getDraft(ctx.companyId, a.draft_id);
    if (!d) return { ok: false, reason: `draft ${a.draft_id} not found` };
    if (d.status === 'published') return { ok: false, reason: 'draft is already published' };
    if (d.status === 'discarded') return { ok: false, reason: 'the owner discarded this draft' };
    const channel = a.channel ?? (ctx.credentials.has('x') ? 'x' : 'webhook');
    if (channel === 'x' && d.body.length > 280) return { ok: false, reason: `too long for X (${d.body.length}/280)` };
    const v = brandViolations(`${d.title}\n${d.body}`, ctx.company.config.brandDonts);
    if (v.length) return { ok: false, reason: `contains brand "don't" phrases: ${v.join(', ')}` };
    return { ok: true };
  },
  preview: (a) => ({ title: `Publish draft ${a.draft_id}${a.channel ? ` to ${a.channel}` : ''}`, summary: `draft ${a.draft_id}` }),
  async execute(ctx, a, exec) {
    const d = ctx.db.work.getDraft(ctx.companyId, a.draft_id);
    if (!d) return { ok: false, content: `ERROR: draft ${a.draft_id} not found` };
    const channel = a.channel ?? (ctx.credentials.has('x') ? 'x' : 'webhook');
    let ref: string;
    if (channel === 'x') {
      const cred = ctx.credentials.resolve('x');
      if (!cred) throw new Error('X is not connected');
      const res = await ctx.fetch('https://api.twitter.com/2/tweets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cred.secret.reveal()}` },
        body: JSON.stringify({ text: d.body }),
      });
      const body = (await readJson(res, 'X')) as { data?: { id?: string } };
      ref = body.data?.id ? `https://x.com/i/web/status/${body.data.id}` : 'posted';
    } else {
      const cred = ctx.credentials.resolve('publish_webhook');
      if (!cred) throw new Error('no publishing webhook connected');
      const url = cred.secret.reveal();
      if (!url.startsWith('https://')) throw new Error('publishing webhook must be https');
      const res = await ctx.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': exec.idempotencyKey.slice(0, 64) },
        body: JSON.stringify({
          draftId: d.id,
          kind: d.kind,
          channel: d.channel || cred.meta['channel'] || 'social',
          title: d.title,
          text: d.body,
          company: ctx.company.config.name,
        }),
      });
      if (!res.ok) await readJson(res, 'Publish webhook');
      ref = `webhook ${res.status}`;
    }
    ctx.db.work.updateDraft(ctx.companyId, d.id, { status: 'published', meta: { ...d.meta, publishedRef: ref, publishedAt: ctx.now() } }, ctx.now());
    ctx.db.work.logOutbound(ctx.companyId, 'social', channel, d.id, ctx.now());
    return { ok: true, content: `Published "${d.title}" (${ref}).`, stateChange: true };
  },
};

export const COMMS_SKILLS: Skill[] = [emailSend, socialPublish];
