// Registers every skill with its description, and describes the BYOK
// integrations that unlock them (label, purpose, non-secret fields, docs).

import type { McpManager } from '@main/services/mcp-manager';
import { SkillRegistry } from './registry';
import { CORE_SKILLS } from './core';
import { webSearch, makeWebBrowse, type Resolver } from './web';
import { COMMS_SKILLS } from './comms';
import { STRIPE_SKILLS } from './stripe';
import { ADS_SKILLS } from './ads';
import { CODE_SKILLS } from './code';
import { CRM_SKILLS } from './crm';

export function buildRegistry(opts: { mcp?: Pick<McpManager, 'toolSpecs' | 'callTool'>; resolve?: Resolver } = {}): SkillRegistry {
  const reg = new SkillRegistry(opts.mcp);
  for (const s of [
    ...CORE_SKILLS,
    webSearch,
    makeWebBrowse(opts.resolve),
    ...COMMS_SKILLS,
    ...STRIPE_SKILLS,
    ...ADS_SKILLS,
    ...CODE_SKILLS,
    ...CRM_SKILLS,
  ]) {
    reg.register(s);
  }
  return reg;
}

export interface IntegrationSpec {
  provider: string;
  label: string;
  purpose: string;
  secretLabel: string;
  metaFields: Array<{ key: string; label: string; placeholder: string }>;
  docsUrl: string;
}

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    provider: 'stripe',
    label: 'Stripe',
    purpose: 'Read revenue (restricted read key is enough); approval-gated refunds need write access.',
    secretLabel: 'Secret or restricted key (rk_… / sk_…)',
    metaFields: [],
    docsUrl: 'https://dashboard.stripe.com/apikeys',
  },
  {
    provider: 'resend',
    label: 'Resend (email)',
    purpose: 'Send approved outreach and support replies. Set the sender address in Settings → Email.',
    secretLabel: 'API key (re_…)',
    metaFields: [],
    docsUrl: 'https://resend.com/api-keys',
  },
  {
    provider: 'sendgrid',
    label: 'SendGrid (email)',
    purpose: 'Alternative email provider.',
    secretLabel: 'API key (SG.…)',
    metaFields: [],
    docsUrl: 'https://app.sendgrid.com/settings/api_keys',
  },
  {
    provider: 'tavily',
    label: 'Tavily (search)',
    purpose: 'Better web search for the researcher (keyless search is used otherwise).',
    secretLabel: 'API key (tvly-…)',
    metaFields: [],
    docsUrl: 'https://app.tavily.com',
  },
  {
    provider: 'firecrawl',
    label: 'Firecrawl (browse)',
    purpose: 'Render JS-heavy pages to clean markdown for web browsing.',
    secretLabel: 'API key (fc-…)',
    metaFields: [],
    docsUrl: 'https://www.firecrawl.dev/app/api-keys',
  },
  {
    provider: 'x',
    label: 'X (Twitter)',
    purpose: 'Publish approved posts. Needs an OAuth 2.0 user access token with tweet.write.',
    secretLabel: 'User access token',
    metaFields: [],
    docsUrl: 'https://developer.x.com/en/portal/dashboard',
  },
  {
    provider: 'publish_webhook',
    label: 'Publishing webhook',
    purpose: 'Send approved posts to Buffer / Zapier / Make / n8n (JSON: title, text, channel).',
    secretLabel: 'Webhook URL (https://…)',
    metaFields: [{ key: 'channel', label: 'Default channel', placeholder: 'linkedin' }],
    docsUrl: 'https://zapier.com/apps/webhook/integrations',
  },
  {
    provider: 'meta_ads',
    label: 'Meta Ads',
    purpose: 'Read ad performance; propose budget changes within caps.',
    secretLabel: 'System-user access token',
    metaFields: [{ key: 'ad_account_id', label: 'Ad account id', placeholder: 'act_1234567890' }],
    docsUrl: 'https://business.facebook.com/settings/system-users',
  },
  {
    provider: 'github',
    label: 'GitHub',
    purpose: 'Open pull requests on your repository (fine-grained PAT: contents + pull requests write).',
    secretLabel: 'Fine-grained personal access token',
    metaFields: [{ key: 'repo', label: 'Repository', placeholder: 'owner/name' }],
    docsUrl: 'https://github.com/settings/personal-access-tokens/new',
  },
  {
    provider: 'deploy_hook',
    label: 'Deploy hook',
    purpose: 'Vercel / Netlify / Render deploy hook URL — every deploy needs your approval.',
    secretLabel: 'Deploy hook URL (https://…)',
    metaFields: [],
    docsUrl: 'https://vercel.com/docs/deploy-hooks',
  },
  {
    provider: 'hubspot',
    label: 'HubSpot CRM',
    purpose: 'Push qualified leads to your CRM (private app token with contacts write).',
    secretLabel: 'Private app token (pat-…)',
    metaFields: [],
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
  },
  {
    provider: 'slack_webhook',
    label: 'Slack alerts',
    purpose: 'Post cycle digests and alerts to a Slack channel (incoming webhook).',
    secretLabel: 'Incoming webhook URL',
    metaFields: [],
    docsUrl: 'https://api.slack.com/messaging/webhooks',
  },
];
