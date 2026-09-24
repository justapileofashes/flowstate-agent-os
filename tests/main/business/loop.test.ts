import { describe, it, expect, afterEach } from 'vitest';
import { runLoop, compactHistory, type LoopInput } from '@main/business/agent/loop';
import type { NewStep } from '@main/business/db/runs';
import type { GatewayChatRequest, GatewayChatResult } from '@main/business/providers/gateway';
import type { InvokeOutcome } from '@main/business/guardrails/approval';
import type { Skill, SkillContext } from '@main/business/skills/types';
import { z } from 'zod';
import { createCompany, makeServiceEnv, type ServiceEnv } from './helpers';

type Scripted = { text?: string; calls?: Array<{ name: string; args: unknown }>; credits?: number; usd?: number };

function fakeGateway(script: (req: GatewayChatRequest, n: number) => Scripted) {
  let n = 0;
  const reqs: GatewayChatRequest[] = [];
  return {
    reqs,
    async chat(req: GatewayChatRequest): Promise<GatewayChatResult> {
      reqs.push(req);
      const s = script(req, n++);
      return {
        text: s.text ?? '',
        toolCalls: (s.calls ?? []).map((c, i) => ({ id: `c${n}-${i}`, name: c.name, args: c.args })),
        model: 'fake',
        provider: 'ollama',
        usage: { inputTokens: 100, outputTokens: 20, costUsd: s.usd ?? 0, credits: s.credits ?? 1, estimated: false },
        latencyMs: 1,
        attempts: 1,
        failovers: [],
        textProtocol: false,
      };
    },
  };
}

const skill = (key: string): Skill => ({
  key,
  toolName: key.replace('.', '_'),
  name: key,
  description: key,
  parameters: { type: 'object' },
  schema: z.object({ q: z.string().optional() }),
  category: 'read',
  risk: 'low',
  costCredits: 0,
  rubric: [],
  failureConditions: [],
  preview: () => ({ title: key, summary: '' }),
  execute: async () => ({ ok: true, content: 'r' }),
});

function fakeGate(fn: (skill: Skill, args: unknown) => InvokeOutcome) {
  const calls: Array<{ skill: string; args: unknown }> = [];
  return {
    calls,
    async invoke(_ctx: SkillContext, s: Skill, args: unknown): Promise<InvokeOutcome> {
      calls.push({ skill: s.key, args });
      return fn(s, args);
    },
  };
}

function baseInput(over: Partial<LoopInput> = {}): LoopInput {
  return {
    companyId: 'co',
    cycleId: null,
    runId: 'run',
    taskId: null,
    role: 'researcher',
    alias: 'cheap',
    systemPrompt: 'sys',
    userPrompt: 'do the thing',
    goal: 'find competitors',
    skills: [skill('web.search'), skill('knowledge.save')],
    ctx: {} as SkillContext,
    limits: { maxIterations: 6, creditCap: 100, usdCap: 0, wallClockMs: 60_000, noProgressWindow: 3 },
    ...over,
  };
}

describe('runLoop — stopping conditions (server-side)', () => {
  it('act → observe → goal check achieved', async () => {
    const gw = fakeGateway((req, n) => {
      if (req.alias === 'cheap' && req.messages[0]?.content.includes('strict reviewer')) return { text: '{"achieved": true, "reason": "saved"}' };
      return n === 0 ? { calls: [{ name: 'web_search', args: { q: 'x' } }] } : { text: 'Done: found 3 competitors.' };
    });
    const steps: NewStep[] = [];
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: 'hits' }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: (s) => steps.push(s) }, baseInput());
    expect(out.stopReason).toBe('goal_achieved');
    expect(out.output).toBe('Done: found 3 competitors.');
    expect(gate.calls).toEqual([{ skill: 'web.search', args: { q: 'x' } }]);
    expect(steps.map((s) => s.phase)).toEqual(['perceive', 'reason', 'act', 'observe', 'reason', 'observe', 'stop']);
    expect(steps.find((s) => s.stepKind === 'goal_check')?.content).toContain('achieved');
  });

  it('stops at max_iterations', async () => {
    const gw = fakeGateway((_r, n) => ({ calls: [{ name: 'web_search', args: { q: `q${n}` } }] }));
    let i = 0;
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: `new ${i++}` }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput({ limits: { maxIterations: 4, creditCap: 100, usdCap: 0, wallClockMs: 60_000, noProgressWindow: 3 } }));
    expect(out.stopReason).toBe('max_iterations');
    expect(out.iterations).toBe(4);
  });

  it('stops when the credit cap is exhausted', async () => {
    const gw = fakeGateway((_r, n) => ({ calls: [{ name: 'web_search', args: { q: `q${n}` } }], credits: 4 }));
    let i = 0;
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: `new ${i++}` }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput({ limits: { maxIterations: 20, creditCap: 10, usdCap: 0, wallClockMs: 60_000, noProgressWindow: 3 } }));
    expect(out.stopReason).toBe('budget_exhausted');
    expect(out.iterations).toBe(3);
    expect(out.credits).toBe(12);
  });

  it('stops when the cycle budget runs out mid-run', async () => {
    let cycleLeft = 5;
    const gw = fakeGateway((_r, n) => ({ calls: [{ name: 'web_search', args: { q: `q${n}` } }], credits: 3 }));
    let i = 0;
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: `new ${i++}` }, credits: 0, replayed: false }));
    const out = await runLoop(
      { gateway: gw, gate, trace: () => undefined },
      baseInput({
        cycleRemaining: () => ({ credits: cycleLeft, usd: Infinity }),
        onSpend: (c) => {
          cycleLeft -= c;
        },
      }),
    );
    expect(out.stopReason).toBe('budget_exhausted');
    expect(out.iterations).toBe(2);
  });

  it('stops on no progress (same empty result 3 times)', async () => {
    const gw = fakeGateway(() => ({ calls: [{ name: 'web_search', args: { q: 'same' } }] }));
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: 'No results.', empty: true }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput({ limits: { maxIterations: 12, creditCap: 100, usdCap: 0, wallClockMs: 60_000, noProgressWindow: 3 } }));
    expect(out.stopReason).toBe('no_progress');
    expect(out.iterations).toBe(3);
  });

  it('errors and denials never count as progress', async () => {
    const gw = fakeGateway((_r, n) => ({ calls: [{ name: 'web_search', args: { q: `q${n}` } }] }));
    const gate = fakeGate(() => ({ kind: 'denied', reason: 'nope', content: 'DENIED' }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput());
    expect(out.stopReason).toBe('no_progress');
  });

  it('stops on wall-clock timeout', async () => {
    let t = 0;
    const gw = fakeGateway((_r, n) => {
      t += 40_000;
      return { calls: [{ name: 'web_search', args: { q: `q${n}` } }] };
    });
    let i = 0;
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: `new ${i++}` }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined, now: () => t }, baseInput());
    expect(out.stopReason).toBe('timeout');
  });

  it('nudges once when the goal check fails, then stops unverified', async () => {
    const gw = fakeGateway((req) =>
      req.messages[0]?.content.includes('strict reviewer') ? { text: '{"achieved": false, "reason": "nothing saved"}' } : { text: 'I think I am done.' },
    );
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: 'x' }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput());
    expect(out.stopReason).toBe('agent_done_unverified');
    expect(out.iterations).toBe(2);
    const nudge = gw.reqs[2]!.messages.filter((m) => m.role === 'user').at(-1)!.content;
    expect(nudge).toContain('reviewer says the goal is not met');
  });

  it('reports unknown tools back to the model instead of crashing', async () => {
    const gw = fakeGateway((req, n) =>
      req.messages[0]?.content.includes('strict reviewer') ? { text: '{"achieved": true, "reason": "ok"}' } : n === 0 ? { calls: [{ name: 'send_money', args: {} }] } : { text: 'done' },
    );
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: 'x' }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput());
    expect(gate.calls).toHaveLength(0);
    expect(gw.reqs[1]!.messages.find((m) => m.role === 'tool')?.content).toContain('unknown tool "send_money"');
    expect(out.stopReason).toBe('goal_achieved');
  });

  it('a queued approval counts as progress and is reported', async () => {
    const gw = fakeGateway((req, n) =>
      req.messages[0]?.content.includes('strict reviewer') ? { text: '{"achieved": true, "reason": "queued"}' } : n === 0 ? { calls: [{ name: 'knowledge_save', args: {} }] } : { text: 'queued it' },
    );
    const gate = fakeGate(() => ({ kind: 'queued', actionId: 'a1', gate: 'approval', reason: 'r', content: 'QUEUED' }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput());
    expect(out.queuedActions).toEqual(['a1']);
  });

  it('aborts promptly when the signal fires', async () => {
    const ctl = new AbortController();
    const gw = fakeGateway((_r, n) => {
      if (n === 1) ctl.abort();
      return { calls: [{ name: 'web_search', args: { q: `q${n}` } }] };
    });
    let i = 0;
    const gate = fakeGate(() => ({ kind: 'executed', result: { ok: true, content: `r${i++}` }, credits: 0, replayed: false }));
    const out = await runLoop({ gateway: gw, gate, trace: () => undefined }, baseInput({ signal: ctl.signal }));
    expect(out.stopReason).toBe('aborted');
  });
});

describe('compactHistory', () => {
  it('shrinks old tool results but keeps the recent tail', () => {
    const msgs = [
      { role: 'system' as const, content: 's' },
      { role: 'tool' as const, content: 'x'.repeat(50_000) },
      { role: 'tool' as const, content: 'y'.repeat(30_000) },
      { role: 'user' as const, content: 'a' },
      { role: 'assistant' as const, content: 'b' },
      { role: 'tool' as const, content: 'z'.repeat(1_000) },
      { role: 'user' as const, content: 'c' },
    ];
    compactHistory(msgs, 60_000);
    expect(msgs[1]!.content.length).toBeLessThan(700);
    expect(msgs[5]!.content.length).toBe(1_000);
  });
});

describe('runLoop — with the real gate + trace (integration)', () => {
  let env: ServiceEnv;
  afterEach(() => env?.cleanup());

  it('writes a replayable, ordered trace to run_steps', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    const run = env.db.runs.createRun({ companyId: co.id, cycleId: null, role: 'researcher', triggerType: 'manual', goal: 'g' });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'researcher', runId: run.id, cycleId: null, taskId: null });
    const gw = fakeGateway((req, n) =>
      req.messages[0]?.content.includes('strict reviewer')
        ? { text: '{"achieved": true, "reason": "ok"}' }
        : n === 0
          ? { calls: [{ name: 'knowledge_save', args: { content: 'Competitor Plausible charges $9/mo', category: 'competitor', source: 'https://plausible.io/pricing' } }] }
          : { text: 'saved' },
    );
    const out = await runLoop(
      { gateway: gw, gate: env.service.gate, trace: (s) => void env.db.runs.appendStep(run.id, s) },
      baseInput({ companyId: co.id, runId: run.id, ctx, skills: env.service.registry.forRole('researcher', ctx) }),
    );
    expect(out.stopReason).toBe('goal_achieved');
    const steps = env.db.runs.steps(run.id);
    expect(steps.map((s) => s.seqNo)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.find((s) => s.phase === 'act')?.toolName).toBe('knowledge_save');
    expect(env.db.knowledge.list(co.id, { category: 'competitor' })).toHaveLength(1);
  });
});
