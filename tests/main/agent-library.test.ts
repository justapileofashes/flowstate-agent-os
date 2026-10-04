import { describe, it, expect } from 'vitest';
import {
  CORE_AGENT_IDS,
  cleanupCandidates,
  parseLedger,
  planSeeding,
  templateGroups,
} from '@main/agent-library';
import { SEED_AGENTS } from '@main/seed-agents';

const ids = SEED_AGENTS.map((s) => s.id);

describe('planSeeding', () => {
  it('fresh install seeds only the core set', () => {
    const plan = planSeeding({ templateIds: ids, existingIds: new Set(), ledger: null });
    expect(plan.create).toEqual([...CORE_AGENT_IDS]);
    expect(plan.ledger).toEqual([...CORE_AGENT_IDS]);
    expect(plan.upgrade).toBe(false);
  });

  it('fresh install where migration 002 already created code-helper still seeds the core set', () => {
    const plan = planSeeding({ templateIds: ids, existingIds: new Set(['agent-code-helper']), ledger: null });
    expect(plan.upgrade).toBe(false);
    expect(plan.create).toEqual(CORE_AGENT_IDS.filter((id) => id !== 'agent-code-helper'));
    expect(plan.ledger).toEqual([...CORE_AGENT_IDS]);
  });

  it('existing install (old build seeded everything) creates nothing and flags the upgrade', () => {
    const existing = new Set(ids.filter((id) => id !== 'agent-writer')); // user deleted one
    const plan = planSeeding({ templateIds: ids, existingIds: existing, ledger: null });
    expect(plan.create).toEqual([]);
    expect(plan.ledger).toEqual(ids);
    expect(plan.upgrade).toBe(true);
  });

  it('a deleted agent never comes back once it is in the ledger', () => {
    const plan = planSeeding({
      templateIds: ids,
      existingIds: new Set(CORE_AGENT_IDS.filter((id) => id !== 'agent-code-helper')),
      ledger: [...CORE_AGENT_IDS],
    });
    expect(plan.create).toEqual([]);
  });

  it('a core template added by a newer build is seeded once', () => {
    const plan = planSeeding({
      templateIds: ids,
      existingIds: new Set(),
      ledger: CORE_AGENT_IDS.filter((id) => id !== 'agent-tutor'),
    });
    expect(plan.create).toEqual(['agent-tutor']);
    expect(plan.ledger).toContain('agent-tutor');
  });
});

describe('cleanupCandidates', () => {
  const t = SEED_AGENTS.find((s) => s.id === 'agent-regex-wizard')!;
  const untouched = { id: t.id, name: t.name, description: t.description, systemPrompt: t.systemPrompt };
  const base = { templates: SEED_AGENTS, chatCounts: new Map<string, number>(), referencedIds: new Set<string>() };

  it('moves an untouched, unused non-core template back to the Library', () => {
    expect(cleanupCandidates({ ...base, agents: [untouched] })).toEqual([t.id]);
  });

  it('keeps edited, used, routine-referenced, core and user agents', () => {
    const core = SEED_AGENTS.find((s) => s.id === 'agent-code-helper')!;
    expect(
      cleanupCandidates({
        ...base,
        agents: [
          { ...untouched, systemPrompt: t.systemPrompt + ' edited' },
          { id: core.id, name: core.name, description: core.description, systemPrompt: core.systemPrompt },
          { id: 'user-1', name: 'Mine', description: '', systemPrompt: 'x' },
        ],
      }),
    ).toEqual([]);
    expect(cleanupCandidates({ ...base, agents: [untouched], chatCounts: new Map([[t.id, 1]]) })).toEqual([]);
    expect(cleanupCandidates({ ...base, agents: [untouched], referencedIds: new Set([t.id]) })).toEqual([]);
  });
});

describe('templateGroups', () => {
  it('gives coding agents no markets/design/brain tools', () => {
    expect(templateGroups(['coding', 'files'])).toEqual(['web', 'skills', 'mcp']);
  });
  it('adds groups by job', () => {
    expect(templateGroups(['stocks', 'research'])).toEqual(['web', 'skills', 'mcp', 'brain', 'markets']);
    expect(templateGroups(['vibecoding', 'design'])).toContain('design');
  });
});

describe('parseLedger', () => {
  it('null when unset, [] when corrupt', () => {
    expect(parseLedger(null)).toBeNull();
    expect(parseLedger('nope')).toEqual([]);
    expect(parseLedger('["a",1]')).toEqual(['a']);
  });
});

describe('core ids', () => {
  it('all exist as templates', () => {
    for (const id of CORE_AGENT_IDS) expect(ids).toContain(id);
  });
});
