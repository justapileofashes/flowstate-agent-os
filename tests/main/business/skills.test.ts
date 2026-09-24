import { describe, it, expect, afterEach } from 'vitest';
import { assertPublicUrl, digestHtml, isPrivateAddress, safeFetchPage } from '@main/business/skills/web';
import { detectAnomalies, summarizeCharges } from '@main/business/skills/stripe';
import { parseRepo, safeRepoPath } from '@main/business/skills/code';
import { withOptOut } from '@main/business/skills/comms';
import { brandViolations, literalDonts } from '@main/business/memory/brand';
import { createCompany, json, makeServiceEnv, type ServiceEnv } from './helpers';

let env: ServiceEnv;
afterEach(() => env?.cleanup());

const pub = async () => ['93.184.216.34'];

describe('web.browse SSRF guard', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:4700::1111')).toBe(false);
  });

  it('rejects bad schemes, local hosts, credentials in URLs, and private DNS answers', async () => {
    const opts = { allow: [], block: [], resolve: pub };
    await expect(assertPublicUrl('file:///etc/passwd', opts)).rejects.toThrow(/http/);
    await expect(assertPublicUrl('http://localhost:11434/api/tags', opts)).rejects.toThrow(/local/);
    await expect(assertPublicUrl('http://user:pw@example.com', opts)).rejects.toThrow(/credentials/);
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data', opts)).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://sneaky.example', { ...opts, resolve: async () => ['10.0.0.5'] })).rejects.toThrow(/private/);
    await expect(assertPublicUrl('https://example.com/x', opts)).resolves.toBeInstanceOf(URL);
  });

  it('honours company allow/block lists (subdomains included)', async () => {
    await expect(assertPublicUrl('https://www.rival.com', { allow: [], block: ['rival.com'], resolve: pub })).rejects.toThrow(/blocklist/);
    await expect(assertPublicUrl('https://other.com', { allow: ['docs.example.com'], block: [], resolve: pub })).rejects.toThrow(/allowlist/);
    await expect(assertPublicUrl('https://docs.example.com/a', { allow: ['example.com'], block: [], resolve: pub })).resolves.toBeInstanceOf(URL);
  });

  it('re-checks every redirect hop (no redirect-to-internal bypass)', async () => {
    const fetchFn = async (url: string) =>
      url.startsWith('https://example.com') ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } }) : new Response('secret');
    await expect(safeFetchPage('https://example.com/r', { allow: [], block: [], fetchFn, resolve: pub })).rejects.toThrow(/local|private/);
  });

  it('digests HTML into title, headings, text, links and prices', () => {
    const d = digestHtml(
      '<html><head><title>Pricing — Rival</title><meta name="description" content="Simple plans"></head><body><nav>menu</nav><main><h1>Plans</h1><p>Starter $9/mo. Pro $19/month.</p><a href="/signup">Sign up</a></main><footer>©</footer></body></html>',
      'https://rival.com/pricing',
    );
    expect(d.title).toBe('Pricing — Rival');
    expect(d.description).toBe('Simple plans');
    expect(d.headings).toEqual(['Plans']);
    expect(d.text).not.toContain('menu');
    expect(d.prices).toEqual(['$9/mo', '$19/month']);
    expect(d.links).toEqual([{ text: 'Sign up', href: 'https://rival.com/signup' }]);
  });

  it('web.browse extracts structured JSON with the cheap model and enforces the daily page cap', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { limits: { crawlPagesPerDay: 1 } });
    env.http.on('https://rival.com/', () => new Response('<html><body><main><h1>Pricing</h1><p>Pro $19/mo</p></main></body></html>', { headers: { 'content-type': 'text/html' } }));
    const ctx = env.service.makeContext({ companyId: co.id, role: 'researcher', runId: 'r1', cycleId: null, taskId: null });
    const skill = env.service.registry.get('web.browse')!;
    const first = await env.service.gate.invoke(ctx, skill, { url: 'https://rival.com/pricing', extract: 'pricing tiers' }, { remainingCredits: 10 });
    expect(first.kind).toBe('executed');
    if (first.kind === 'executed') {
      expect(first.result.content).toContain('"extracted"');
      expect(first.result.content).toContain('untrusted data');
    }
    const second = await env.service.gate.invoke(ctx, skill, { url: 'https://rival.com/about' }, { remainingCredits: 10 });
    expect(second.kind).toBe('precondition_failed');
  });
});

describe('stripe.reconcile math', () => {
  const c = (amount: number, over: Record<string, unknown> = {}) => ({ id: 'ch', amount, amount_refunded: 0, currency: 'usd', paid: true, status: 'succeeded', refunded: false, created: 0, ...over });

  it('sums gross, refunds, net and failures in the dominant currency', () => {
    const s = summarizeCharges(
      [c(10_000), c(5_000, { amount_refunded: 1_000 }), c(2_000, { status: 'failed', paid: false }), c(9_999, { currency: 'eur' })],
      { available: [{ amount: 50_000, currency: 'usd' }], pending: [{ amount: 1_000, currency: 'usd' }] },
      30,
    );
    expect(s).toMatchObject({ currency: 'USD', grossRevenue: 150, refunds: 10, netRevenue: 140, charges: 2, failed: 1, balanceAvailable: 500, balancePending: 10 });
  });

  it('flags revenue drops, refund spikes and failed-payment spikes', () => {
    const base = { days: 30, currency: 'USD', grossRevenue: 100, refunds: 20, netRevenue: 80, charges: 5, failed: 2, balanceAvailable: 0, balancePending: 0 };
    const a = detectAnomalies(base, 200);
    expect(a).toHaveLength(3);
    expect(a[0]).toContain('fell 60%');
    expect(detectAnomalies({ ...base, refunds: 0, netRevenue: 100, failed: 0 }, 100)).toEqual([]);
  });
});

describe('code + comms helpers', () => {
  it('parses repos and refuses unsafe paths (incl. CI workflows)', () => {
    expect(parseRepo('https://github.com/acme/app.git')).toEqual({ owner: 'acme', repo: 'app' });
    expect(parseRepo('acme/app')).toEqual({ owner: 'acme', repo: 'app' });
    expect(safeRepoPath('src/pricing.tsx')).toBe(true);
    for (const bad of ['/etc/passwd', '../x', 'a/../../b', '.github/workflows/leak.yml', '.git/config', 'a//b']) expect(safeRepoPath(bad), bad).toBe(false);
  });

  it('appends an opt-out footer only when missing', () => {
    expect(withOptOut('Hi', 'Reply unsubscribe to stop.')).toBe('Hi\n\n--\nReply unsubscribe to stop.');
    expect(withOptOut('Hi — reply "unsubscribe" to opt out', 'x')).toBe('Hi — reply "unsubscribe" to opt out');
  });

  it('brand checks match short "don\'t" phrases as whole words', () => {
    expect(literalDonts(["Don't say revolutionary", 'avoid "game-changer"', 'never compare ourselves to large enterprise vendors in public'])).toEqual(['revolutionary', 'game-changer']);
    expect(brandViolations('A revolutionary tool', ['revolutionary'])).toEqual(['revolutionary']);
    expect(brandViolations('evolutionary steps', ['revolutionary'])).toEqual([]);
  });
});

describe('REST skills against fake providers', () => {
  it('github.open_pr: branch + commit + PR, deterministic branch name, never .github/', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { channels: { code: true }, validation: { required: false }, autonomy: 'assisted' });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'github', secret: 'github_pat_abcdefghijklmnop', meta: { repo: 'acme/site' } });
    const agent = env.db.companies.agentConfig(co.id, 'coder')!;
    env.db.companies.updateAgentConfig(co.id, agent.id, { autoApproveUpTo: 'medium' });
    const gh = 'https://api.github.com/repos/acme/site';
    env.http
      .on(`${gh}/git/ref/heads/main`, () => json({ object: { sha: 'base-sha' } }))
      .on(`${gh}/git/commits/base-sha`, () => json({ tree: { sha: 'tree-0' } }))
      .on(`${gh}/git/trees`, () => json({ sha: 'tree-1' }))
      .on(`${gh}/git/commits`, () => json({ sha: 'commit-1' }))
      .on(`${gh}/git/refs`, () => json({ ref: 'x' }, 201))
      .on(`${gh}/pulls`, () => json({ html_url: 'https://github.com/acme/site/pull/7', number: 7 }, 201))
      .on(gh, () => json({ default_branch: 'main' }));
    const ctx = env.service.makeContext({ companyId: co.id, role: 'coder', runId: 'r', cycleId: null, taskId: null });
    const skill = env.service.registry.get('github.open_pr')!;
    const bad = await env.service.gate.invoke(ctx, skill, { title: 'Add CI', body: 'workflow change', files: [{ path: '.github/workflows/x.yml', content: 'on: push' }] }, { remainingCredits: 10 });
    expect(bad.kind).toBe('precondition_failed');
    const out = await env.service.gate.invoke(ctx, skill, { title: 'Add pricing page', body: 'New page, verified locally.', files: [{ path: 'src/pricing.md', content: '# Pricing' }] }, { remainingCredits: 10 });
    expect(out.kind).toBe('executed');
    if (out.kind === 'executed') expect(out.result.content).toContain('pull/7');
    const refBody = JSON.parse(env.http.to(`${gh}/git/refs`)[0]!.body) as { ref: string };
    expect(refBody.ref).toMatch(/^refs\/heads\/flowstate\/add-pricing-page-[0-9a-f]{7}$/);
    expect(JSON.parse(env.http.to(`${gh}/pulls`)[0]!.body).base).toBe('main');
  });

  it('ads.update_budget: the gate uses the REAL current budget, not the model\'s claim', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { channels: { ads: true }, validation: { required: false }, autonomy: 'assisted', limits: { adBudgetChangePct: 10, adDailyCapUsd: 100 } });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'meta_ads', secret: 'EAAB-token-abcdefghijk', meta: { ad_account_id: '123' } });
    const agent = env.db.companies.agentConfig(co.id, 'ads')!;
    env.db.companies.updateAgentConfig(co.id, agent.id, { autoApproveUpTo: 'medium' });
    env.http.on('https://graph.facebook.com/v21.0/12345678', (c) => (c.method === 'GET' ? json({ daily_budget: '2000' }) : json({ success: true })));
    const ctx = env.service.makeContext({ companyId: co.id, role: 'ads', runId: 'r', cycleId: null, taskId: null });
    const skill = env.service.registry.get('ads.update_budget')!;
    const small = await env.service.gate.invoke(ctx, skill, { adset_id: '12345678', new_daily_budget_usd: 21.5, reason: 'CTR up 30% week over week' }, { remainingCredits: 10 });
    expect(small.kind).toBe('executed'); // +7.5% within ±10%
    const big = await env.service.gate.invoke(ctx, skill, { adset_id: '12345678', new_daily_budget_usd: 40, reason: 'Scale the winner aggressively' }, { remainingCredits: 10 });
    expect(big.kind).toBe('queued'); // +100% → owner
    const over = await env.service.gate.invoke(ctx, skill, { adset_id: '12345678', new_daily_budget_usd: 150, reason: 'All in on this campaign' }, { remainingCredits: 10 });
    expect(over.kind).toBe('denied'); // above the hard daily cap
    const posts = env.http.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toBe('daily_budget=2150');
  });

  it('crm.upsert_lead: requires a locally-qualified lead; falls back to PATCH on conflict', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { channels: { crm: true }, autonomy: 'assisted' });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'hubspot', secret: 'pat-na1-abcdefghijklmnop' });
    const agent = env.db.companies.agentConfig(co.id, 'sdr')!;
    env.db.companies.updateAgentConfig(co.id, agent.id, { autoApproveUpTo: 'medium' });
    env.http.on('https://api.hubapi.com/crm/v3/objects/contacts', (c) => (c.method === 'POST' ? json({ message: 'exists' }, 409) : json({ id: '901' })));
    const ctx = env.service.makeContext({ companyId: co.id, role: 'sdr', runId: 'r', cycleId: null, taskId: null });
    const skill = env.service.registry.get('crm.upsert_lead')!;
    const unqualified = await env.service.gate.invoke(ctx, skill, { email: 'x@y.co' }, { remainingCredits: 10 });
    expect(unqualified.kind).toBe('precondition_failed');
    env.db.work.upsertLead({ companyId: co.id, email: 'x@y.co', signal: 'Hiring a data analyst', icpReason: 'Indie SaaS' });
    const ok = await env.service.gate.invoke(ctx, skill, { email: 'x@y.co', firstname: 'Xu' }, { remainingCredits: 10 });
    expect(ok.kind).toBe('executed');
    expect(env.http.calls.map((c) => c.method)).toEqual(['POST', 'PATCH']);
  });

  it('social.publish: only saved drafts, brand-checked, marked published, counted toward clean publishes', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { channels: { social: true } });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'x', secret: 'x-user-token-abcdefghijk' });
    env.http.on('https://api.twitter.com/2/tweets', () => json({ data: { id: '99' } }, 201));
    const good = env.db.work.createDraft({ companyId: co.id, kind: 'post', title: 'Cookies', body: 'No cookie banners. Ever.' });
    const bad = env.db.work.createDraft({ companyId: co.id, kind: 'post', title: 'Hype', body: 'A revolutionary tool!' });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'copywriter', runId: 'r', cycleId: null, taskId: null });
    const skill = env.service.registry.get('social.publish')!;
    expect((await env.service.gate.invoke(ctx, skill, { draft_id: bad.id }, { remainingCredits: 10 })).kind).toBe('precondition_failed');
    const q = await env.service.gate.invoke(ctx, skill, { draft_id: good.id }, { remainingCredits: 10 });
    expect(q.kind).toBe('queued');
    if (q.kind !== 'queued') return;
    await env.service.handle('approvals.approve', { companyId: co.id, actionId: q.actionId });
    expect(env.db.work.getDraft(co.id, good.id)!.status).toBe('published');
    expect(env.db.work.countPublished(co.id)).toBe(1);
    expect(JSON.parse(env.http.to('https://api.twitter.com/2/tweets')[0]!.body)).toEqual({ text: 'No cookie banners. Ever.' });
  });
});
