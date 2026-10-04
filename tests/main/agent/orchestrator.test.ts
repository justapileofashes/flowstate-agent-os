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

  it('does not treat a tag buried inside a longer word as a hit', async () => {
    // Short tags are normal ('go', 'ai', 'js'). Substring matching scores them
    // against any prompt containing 'good', 'said', 'json' — B1 fan-out again.
    const shortTags: AgentSummary[] = [
      { id: 'a-go', name: 'Go Helper', description: 'golang', specialtyTags: ['go'] },
      { id: 'a-ai', name: 'AI Helper', description: 'models', specialtyTags: ['ai'] },
    ];
    const r = await build().pickAgent('is this a good idea, said the man', shortTags);
    expect(r.swarm).toEqual([r.agentId]);
  });

  it('still matches a hyphenated tag as a whole word', async () => {
    const tagged: AgentSummary[] = [
      { id: 'a-web', name: 'Web Bot', description: 'searches', specialtyTags: ['web-search'] },
      { id: 'a-go', name: 'Go Helper', description: 'golang', specialtyTags: ['go'] },
    ];
    const r = await build().pickAgent('please web-search this topic', tagged);
    expect(r.agentId).toBe('a-web');
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

  // A swarm means a team run (chat.ts fans out when swarm.length > 1), so an
  // agent only joins when the text actually mentions one of its tags.
  it('keeps a greeting on one agent', async () => {
    const r = await build().pickAgent('hello there', AGENTS);
    expect(r.fallback).toBe(true);
    expect(r.swarm).toEqual([r.agentId]);
  });

  it('does not add a same-score agent that matched no tag', async () => {
    const withWriter: AgentSummary[] = [
      ...AGENTS,
      { id: 'writer-1', name: 'Writer', description: 'writes docs', specialtyTags: ['writing'] },
    ];
    const r = await build().pickAgent('write python code to parse a csv', withWriter);
    expect(r.swarm).toEqual([r.agentId]);
  });

  it('still forms a team when several agents are named by tag', async () => {
    const pair: AgentSummary[] = [
      { id: 'a-research', name: 'Researcher', description: 'researches', specialtyTags: ['research'] },
      { id: 'a-design', name: 'Designer', description: 'designs', specialtyTags: ['design'] },
    ];
    const r = await build().pickAgent('research the design of the landing page', pair);
    expect(r.swarm).toHaveLength(2);
  });

  it('throws when agents list empty', async () => {
    await expect(build().pickAgent('x', [])).rejects.toThrow();
  });
});
