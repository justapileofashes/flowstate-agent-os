import { describe, it, expect } from 'vitest';
import { generateAgentId } from '@main/util/agent-id';

describe('generateAgentId', () => {
  it('produces a slug with a uuid suffix', () => {
    const id = generateAgentId('Code Helper');
    expect(id).toMatch(/^code-helper-[0-9a-f]{8}$/);
  });

  it('lowercases and replaces non-alphanumerics with single dash', () => {
    const id = generateAgentId('Researcher: Notes & Synth!');
    expect(id).toMatch(/^researcher-notes-synth-[0-9a-f]{8}$/);
  });

  it('strips leading/trailing dashes', () => {
    const id = generateAgentId('  --  ASCII  --  ');
    expect(id).toMatch(/^ascii-[0-9a-f]{8}$/);
  });

  it('truncates the slug at 24 chars', () => {
    const id = generateAgentId('a'.repeat(60));
    const slug = id.split('-').slice(0, -1).join('-');
    expect(slug.length).toBeLessThanOrEqual(24);
  });

  it('falls back to "agent" when slug is empty', () => {
    const id = generateAgentId('!@#$%');
    expect(id).toMatch(/^agent-[0-9a-f]{8}$/);
  });

  it('returns unique ids across calls', () => {
    const a = generateAgentId('Same Name');
    const b = generateAgentId('Same Name');
    expect(a).not.toBe(b);
  });
});
