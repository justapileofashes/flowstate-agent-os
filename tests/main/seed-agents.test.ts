import { describe, it, expect } from 'vitest';
import { SEED_AGENTS } from '@main/seed-agents';

// Invariants for the whole seed list. Caps mirror the IPC schemas in
// shared/ipc-channels.ts (chatCreateAgentRequest) so every seed agent can
// round-trip through the create/update UI without validation errors.
describe('SEED_AGENTS', () => {
  it('has unique ids', () => {
    const ids = SEED_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique workspace slugs', () => {
    const slugs = SEED_AGENTS.map((a) => a.workspaceSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses filesystem-safe workspace slugs', () => {
    for (const a of SEED_AGENTS) {
      expect(a.workspaceSlug, a.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it('respects the UI schema caps', () => {
    for (const a of SEED_AGENTS) {
      expect(a.name.length, `${a.id} name`).toBeLessThanOrEqual(60);
      expect(a.name.trim().length, `${a.id} name`).toBeGreaterThan(0);
      expect(a.description.length, `${a.id} description`).toBeLessThanOrEqual(200);
      expect(a.systemPrompt.length, `${a.id} prompt`).toBeLessThanOrEqual(4000);
      expect(a.systemPrompt.length, `${a.id} prompt`).toBeGreaterThan(0);
      expect(a.specialtyTags.length, `${a.id} tags`).toBeLessThanOrEqual(10);
    }
  });

  it('uses valid avatar colors and approval policies', () => {
    for (const a of SEED_AGENTS) {
      expect(a.avatarColor, a.id).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(['cautious', 'trusting', 'yolo'], a.id).toContain(a.approvalPolicy);
    }
  });

  it('includes the stocks pack', () => {
    const ids = new Set(SEED_AGENTS.map((a) => a.id));
    for (const id of ['agent-stock-researcher', 'agent-technical-analyst', 'agent-trade-strategist']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('includes the business pack', () => {
    const ids = new Set(SEED_AGENTS.map((a) => a.id));
    for (const id of [
      'agent-sales-outreach',
      'agent-email-marketer',
      'agent-social-media',
      'agent-customer-support',
      'agent-market-researcher',
      'agent-bookkeeper',
      'agent-contract-reviewer',
      'agent-hiring-helper',
      'agent-pitch-builder',
      'agent-pricing-strategist',
      'agent-biz-plan-writer',
      'agent-meeting-summarizer',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
