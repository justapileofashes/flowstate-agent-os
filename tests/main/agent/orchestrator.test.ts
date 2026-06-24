import { describe, it, expect } from 'vitest';
import { Orchestrator } from '@main/agent/orchestrator';
import { FakeProvider } from '@main/agent/fake-provider';
import type { AgentSummary } from '@main/agent/orchestrator';

// Routing is deterministic (tag/keyword/intent scoring) — the provider and
// model are kept only for constructor backwards-compat and never called.
const AGENTS: AgentSummary[] = [
  { id: 'agent-code-helper', name: 'Code Helper', description: 'codes', specialtyTags: ['coding'] },
  { id: 'researcher-1', name: 'Researcher', description: 'researches', specialtyTags: ['research'] },
];

function build(): Orchestrator {
  return new Orchestrator(new FakeProvider([]), 'fake-model');
}

describe('Orchestrator.pickAgent', () => {
  it('routes by specialty-tag match', async () => {
    const r = await build().pickAgent('do some research on llamas', AGENTS);
    expect(r.agentId).toBe('researcher-1');
    expect(r.fallback).toBe(false);
    expect(r.swarm).toContain('researcher-1');
  });

  it('routes by intent verbs when no tag matches', async () => {
    const r = await build().pickAgent('fix the bug in my function', AGENTS);
    expect(r.agentId).toBe('agent-code-helper');
    expect(r.fallback).toBe(false);
  });

  it('falls back to the first agent when nothing matches', async () => {
    const r = await build().pickAgent('zzz qqq vvv', AGENTS);
    expect(r.fallback).toBe(true);
    expect(r.agentId).toBe(AGENTS[0]!.id);
    expect(r.swarm.length).toBeGreaterThan(0);
  });

  it('falls back on empty user text', async () => {
    const r = await build().pickAgent('   ', AGENTS);
    expect(r.fallback).toBe(true);
    expect(r.agentId).toBe(AGENTS[0]!.id);
  });

  it('caps reasoning at 200 chars', async () => {
    const manyTags: AgentSummary = {
      id: 'taggy',
      name: 'Taggy',
      description: 'lots of tags',
      specialtyTags: Array.from({ length: 10 }, (_, i) => `verylongtagname${i}`),
    };
    const text = manyTags.specialtyTags.join(' ');
    const r = await build().pickAgent(text, [manyTags, ...AGENTS]);
    expect(r.reasoning.length).toBeLessThanOrEqual(200);
  });

  it('builds a swarm capped at 4 including the primary', async () => {
    const clones: AgentSummary[] = Array.from({ length: 6 }, (_, i) => ({
      id: `res-${i}`,
      name: `Researcher ${i}`,
      description: 'researches',
      specialtyTags: ['research'],
    }));
    const r = await build().pickAgent('research the market', clones);
    expect(r.swarm.length).toBeLessThanOrEqual(4);
    expect(r.swarm).toContain(r.agentId);
  });

  it('throws when agents list empty', async () => {
    await expect(build().pickAgent('x', [])).rejects.toThrow();
  });
});
