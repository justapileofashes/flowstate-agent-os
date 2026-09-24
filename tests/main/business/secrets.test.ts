import { describe, it, expect, afterEach } from 'vitest';
import { createCompany, json, makeServiceEnv, type ServiceEnv } from './helpers';
import { auxReply, is, roleOf, toolResults } from './fake-llm';
import { scrubJson, scrubText, scrubValue, stripHtml } from '@main/business/guardrails/scrub';

let env: ServiceEnv;
afterEach(() => env?.cleanup());

const STRIPE_KEY = 'sk_fake_51SuperSecretStripeKey000111222';
const LEAKED = 'sk-proj-LEAKEDKEY0123456789abcdefXYZ';
const BEARER = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLXNlY3JldA';
const PASSWORD = 'hunter2-correct-horse';

/** Every text column of the trace/log tables, concatenated. */
function traceDump(e: ServiceEnv): string {
  const tables = [
    'biz_run_steps',
    'biz_agent_runs',
    'biz_cycles',
    'biz_feed',
    'biz_audit',
    'biz_usage_events',
    'biz_notifications',
    'biz_skill_executions',
    'biz_pending_actions',
    'biz_credits_ledger',
  ];
  return tables.map((t) => JSON.stringify(e.raw.prepare(`SELECT * FROM ${t}`).all())).join('\n');
}

describe('no secrets in traces (grep test)', () => {
  it('a full cycle that touches secrets leaves none in run_steps, feed, audit, usage, or ledgers', async () => {
    env = await makeServiceEnv({
      handler: (r) => {
        const aux = auxReply(r);
        if (aux) return aux;
        if (is.plan(r)) {
          return {
            text: JSON.stringify({
              plan: [{ title: 'Audit the docs page', role: 'researcher', description: `Check it. password: ${PASSWORD}`, estimated_cost_credits: 20 }],
              notes: '',
            }),
          };
        }
        if (roleOf(r) === 'researcher') {
          const n = toolResults(r).length;
          if (n === 0) return { tools: [{ name: 'web_browse', args: { url: 'https://docs.example.com/setup' } }] };
          if (n === 1) {
            return {
              tools: [
                {
                  name: 'knowledge_save',
                  args: { content: 'The docs page shows an exposed key; tell the owner to rotate it.', category: 'note', source: `https://docs.example.com/setup?api_key=${LEAKED}` },
                },
              ],
            };
          }
          return { text: `Found a leaked key (${LEAKED}) and Bearer ${BEARER}; reported.` };
        }
        return { text: 'ok' };
      },
    });
    const co = await createCompany(env, { validation: { required: false } });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'stripe', secret: STRIPE_KEY });
    env.http
      .on('https://api.stripe.com/v1/balance', (c) => {
        expect(c.headers['authorization']).toBe(`Bearer ${STRIPE_KEY}`); // used only on the wire
        return json({ available: [], pending: [] });
      })
      .on('https://api.stripe.com/v1/charges', () => json({ data: [], has_more: false }))
      .on('https://docs.example.com/', () =>
        new Response(
          `<html><head><title>Setup</title></head><body><main><h1>Setup</h1><p>Use api_key=${LEAKED} and Authorization: Bearer ${BEARER}. Admin password: ${PASSWORD}</p></main></body></html>`,
          { status: 200, headers: { 'content-type': 'text/html' } },
        ),
      );

    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    expect(cycle.status).toBe('done');
    expect(env.http.to('https://docs.example.com/')).toHaveLength(1);

    const dump = traceDump(env);
    for (const secret of [STRIPE_KEY, LEAKED, BEARER, PASSWORD]) {
      expect(dump.includes(secret), `trace leaked ${secret.slice(0, 12)}…`).toBe(false);
    }
    // the credential row itself holds ciphertext only
    expect(JSON.stringify(env.raw.prepare('SELECT * FROM biz_credentials').all())).not.toContain(STRIPE_KEY);
    // and the API never echoes it back
    const listed = await env.service.handle('credentials.list', { companyId: co.id });
    expect(JSON.stringify(listed)).not.toContain(STRIPE_KEY);
  });

  it('the credentials.save audit row does not contain the secret', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'resend', secret: 're_SECRETSECRETSECRET123' });
    const audit = JSON.stringify(env.db.ops.auditLog(co.id));
    expect(audit).toContain('credentials.save');
    expect(audit).not.toContain('re_SECRETSECRETSECRET123');
  });
});

describe('scrub', () => {
  it('drops secret-named keys and masks secrets in strings', () => {
    const v = scrubValue({ api_key: 'abc', nested: { Authorization: 'Bearer x', note: `key sk-${'a'.repeat(30)}` }, to: 'pat@x.io' }) as Record<string, unknown>;
    expect(v['api_key']).toBe('<redacted>');
    expect((v['nested'] as Record<string, unknown>)['Authorization']).toBe('<redacted>');
    expect(JSON.stringify(v)).not.toContain('a'.repeat(30));
    expect(v['to']).toBe('<email>');
  });

  it('flattens HTML and clips long values', () => {
    expect(stripHtml('<p>Hello <b>there</b><script>evil()</script></p>')).toBe('Hello there');
    expect(scrubText('hello world, hello again', 10)).toBe('hello worl…[+14 chars]');
    expect(scrubJson({ a: 'y'.repeat(5_000) }, 100).length).toBeLessThanOrEqual(101);
  });
});

describe('scrub keeps record ids', () => {
  it('preserves UUIDs while masking real tokens', () => {
    const id = '3f2b8c1e-9a4d-4e7f-b2c1-0d9e8f7a6b5c';
    expect(scrubText(`Task created (${id}) with token=abcdefghijklmnopqrstuvwxyz123456`)).toBe(`Task created (${id}) with token=<secret>`);
  });
});
