import { describe, it, expect } from 'vitest';
import { runEval, SCENARIOS } from './harness';
import { createCompany, makeServiceEnv } from '../helpers';
import { auxReply, is, roleOf, toolResults } from '../fake-llm';

describe('business-agent eval suite (Phase 10)', () => {
  it(`has ${SCENARIOS.length} seeded scenarios and passes ≥ 90%`, async () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(20);
    const { results, passRate } = await runEval();
    const failed = results.filter((r) => !r.passed);
    if (failed.length) {

      console.log(
        'Eval failures:\n' +
          failed.map((f) => `- ${f.name}: ${f.error ?? f.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`).join('\n'),
      );
    }

    console.log(`eval pass rate: ${(passRate * 100).toFixed(1)}% (${results.length - failed.length}/${results.length})`);
    expect(failed.filter((f) => f.critical).map((f) => f.name)).toEqual([]);
    expect(passRate).toBeGreaterThanOrEqual(0.9);
  }, 60_000);
});

describe('load: 50 concurrent cycles', () => {
  it('drains without deadlock; one cycle per company; costs bounded by each cap', async () => {
    const env = await makeServiceEnv({
      handler: (r) => {
        const aux = auxReply(r);
        if (aux) return aux;
        if (is.plan(r)) {
          return { text: JSON.stringify({ plan: [{ title: 'Research', role: 'researcher', estimated_cost_credits: 10 }, { title: 'Plan', role: 'planner', estimated_cost_credits: 10 }], notes: '' }) };
        }
        const role = roleOf(r);
        if (role === 'researcher' && toolResults(r).length === 0) {
          return { tools: [{ name: 'knowledge_save', args: { content: `Finding for ${Math.random().toString(36).slice(2)}`, category: 'market' } }] };
        }
        return { text: 'done' };
      },
    });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 50; i++) ids.push((await createCompany(env, { name: `Co ${i}`, validation: { required: false } })).id);
      const started = Date.now();
      const cycles = await Promise.all(ids.map((id) => env.service.runner.run(id, 'manual', 'manual')));
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(cycles.every((c) => c.status === 'done')).toBe(true);
      expect(new Set(cycles.map((c) => c.companyId)).size).toBe(50);
      for (const id of ids) expect(env.db.runs.listCycles(id)).toHaveLength(1);
      expect(cycles.every((c) => c.creditsSpent <= c.creditsCap)).toBe(true);
      for (const id of ids) expect(env.db.billing.balance(id)).toBeCloseTo(env.db.billing.sumDeltas(id), 6);
    } finally {
      env.cleanup();
    }
  }, 60_000);
});
