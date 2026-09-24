// CRM write (HubSpot private-app token). Only leads already qualified
// locally (leads.save with an ICP reason) can be pushed — the ICP rubric is
// enforced before anything reaches the owner's CRM.

import { z } from 'zod';
import { readJson, skillToolName, type Skill } from './types';

const HS = 'https://api.hubapi.com/crm/v3/objects/contacts';

const upsertArgs = z.object({
  email: z.string().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/),
  firstname: z.string().max(80).optional(),
  lastname: z.string().max(80).optional(),
  company: z.string().max(160).optional(),
});

export const crmUpsertLead: Skill<z.infer<typeof upsertArgs>> = {
  key: 'crm.upsert_lead',
  toolName: skillToolName('crm.upsert_lead'),
  name: 'Add/update a CRM contact',
  description: 'Create or update a contact in the connected CRM (HubSpot) for a lead you already qualified with leads_save.',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      firstname: { type: 'string' },
      lastname: { type: 'string' },
      company: { type: 'string' },
    },
    required: ['email'],
  },
  schema: upsertArgs,
  category: 'external_write',
  risk: 'medium',
  costCredits: 1,
  channel: 'crm',
  providers: ['hubspot'],
  rubric: ['Lead matches the ICP', 'No duplicate contact created'],
  failureConditions: ['Lead not qualified locally', 'Token lacks contacts write scope'],
  precondition(ctx, a) {
    const lead = ctx.db.work.getLeadByEmail(ctx.companyId, a.email);
    if (!lead || !lead.icpReason) return { ok: false, reason: 'qualify the lead with leads_save (icp_reason) first' };
    if (lead.status === 'unsubscribed') return { ok: false, reason: 'lead unsubscribed' };
    return { ok: true };
  },
  preview: (a) => ({ title: `CRM contact ${a.email}`, summary: [a.firstname, a.lastname, a.company].filter(Boolean).join(' · ') }),
  async execute(ctx, a) {
    const cred = ctx.credentials.resolve('hubspot');
    if (!cred) return { ok: false, content: 'ERROR: HubSpot is not connected' };
    const lead = ctx.db.work.getLeadByEmail(ctx.companyId, a.email);
    const properties: Record<string, string> = {
      email: a.email,
      ...(a.firstname ? { firstname: a.firstname } : {}),
      ...(a.lastname ? { lastname: a.lastname } : {}),
      ...(a.company || lead?.companyName ? { company: a.company ?? lead?.companyName ?? '' } : {}),
    };
    const headers = { Authorization: `Bearer ${cred.secret.reveal()}`, 'Content-Type': 'application/json' };
    let res = await ctx.fetch(HS, { method: 'POST', headers, body: JSON.stringify({ properties }) });
    let verb = 'created';
    if (res.status === 409) {
      res = await ctx.fetch(`${HS}/${encodeURIComponent(a.email)}?idProperty=email`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ properties }),
      });
      verb = 'updated';
    }
    const body = (await readJson(res, 'HubSpot')) as { id?: string };
    return { ok: true, content: `CRM contact ${verb} (${body.id ?? a.email}).`, stateChange: true };
  },
};

export const CRM_SKILLS: Skill[] = [crmUpsertLead];
