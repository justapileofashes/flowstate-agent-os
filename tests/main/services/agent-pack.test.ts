import { describe, it, expect } from 'vitest';
import {
  AGENT_PACK_KIND,
  AGENT_PACK_VERSION,
  serializeAgents,
  parseAgentPack,
  planImports,
  type ExportableAgent,
} from '@main/services/agent-pack';

const sample: ExportableAgent = {
  name: 'Copy Editor',
  description: 'Edits copy.',
  specialtyTags: ['copy', 'editing'],
  systemPrompt: 'You edit copy. Be terse.',
  model: 'qwen2.5:7b',
  avatarColor: '#a973d4',
  toolPerms: { shell_enabled: false, delete_enabled: false },
  approvalPolicy: 'trusting',
};

describe('agent-pack', () => {
  it('round-trips serialize → parse', () => {
    const pack = serializeAgents([sample]);
    expect(pack.kind).toBe(AGENT_PACK_KIND);
    expect(pack.version).toBe(AGENT_PACK_VERSION);
    const parsed = parseAgentPack(JSON.stringify(pack));
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).toMatchObject(sample);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseAgentPack('{not json')).toThrow(/not valid JSON/i);
  });

  it('rejects wrong kind and unsupported version', () => {
    const pack = serializeAgents([sample]);
    expect(() => parseAgentPack(JSON.stringify({ ...pack, kind: 'other' }))).toThrow();
    expect(() => parseAgentPack(JSON.stringify({ ...pack, version: 99 }))).toThrow();
  });

  it('rejects an empty agents list', () => {
    expect(() =>
      parseAgentPack(JSON.stringify({ kind: AGENT_PACK_KIND, version: 1, agents: [] })),
    ).toThrow();
  });

  it('plans slugs from names and dedupes against existing slugs', () => {
    const plans = planImports([sample], { slugs: ['copy-editor'], ids: [] });
    expect(plans[0]!.workspaceSlug).toBe('copy-editor-2');
    expect(plans[0]!.id).toBe('agent-imp-copy-editor-2');
  });

  it('dedupes slugs within the same pack', () => {
    const plans = planImports([sample, sample], { slugs: [], ids: [] });
    expect(plans[0]!.workspaceSlug).toBe('copy-editor');
    expect(plans[1]!.workspaceSlug).toBe('copy-editor-2');
  });

  it('dedupes against existing ids too', () => {
    const plans = planImports([sample], { slugs: [], ids: ['agent-imp-copy-editor'] });
    expect(plans[0]!.workspaceSlug).toBe('copy-editor-2');
  });

  it('slugifies hostile names safely', () => {
    const plans = planImports([{ ...sample, name: '  Ünsafe / Name!! ' }], { slugs: [], ids: [] });
    expect(plans[0]!.workspaceSlug).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('forces cautious approval when an imported agent has shell access', () => {
    const shellAgent: ExportableAgent = {
      ...sample,
      toolPerms: { shell_enabled: true, delete_enabled: false },
      approvalPolicy: 'yolo',
    };
    const plans = planImports([shellAgent], { slugs: [], ids: [] });
    expect(plans[0]!.agent.approvalPolicy).toBe('cautious');
  });

  it('keeps the declared approval policy for non-shell agents', () => {
    const plans = planImports([sample], { slugs: [], ids: [] });
    expect(plans[0]!.agent.approvalPolicy).toBe('trusting');
  });
});
