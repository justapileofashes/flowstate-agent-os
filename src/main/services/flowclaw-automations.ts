// Flowclaw automations — scheduled (cron-like) gateway tasks. A user sets up a
// recurring job ("daily research digest", "monitor X") that fires a prompt at a
// connection on an interval and delivers the result back. Pure store + due-logic
// so it's unit-testable; the handler owns the ticker + actual gateway run + JSON
// persistence. Modeled on the local scheduled-tasks store.

import { z } from 'zod';

export const automationSchema = z.object({
  id: z.string(),
  connectionId: z.string().min(1),
  label: z.string().min(1).max(120),
  prompt: z.string().min(1),
  intervalMinutes: z.number().int().min(1).max(60 * 24 * 30),
  enabled: z.boolean(),
  /** Where to deliver the result: 'inbox' (in-app feed) or a chat channel id. */
  deliverTo: z.string().default('inbox'),
  createdAt: z.number(),
  nextRunAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastResult: z.string().nullable(),
});
export type Automation = z.infer<typeof automationSchema>;

const storeSchema = z.array(automationSchema);

export function parseAutomations(json: string | null | undefined): Automation[] {
  if (!json) return [];
  try {
    const parsed = storeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeAutomations(items: Automation[]): string {
  return JSON.stringify(storeSchema.parse(items));
}

export interface NewAutomationInput {
  connectionId: string;
  label: string;
  prompt: string;
  intervalMinutes: number;
  deliverTo?: string;
}

export function createAutomation(input: NewAutomationInput, now: number = Date.now()): Automation {
  return {
    id: `auto_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    connectionId: input.connectionId,
    label: input.label,
    prompt: input.prompt,
    intervalMinutes: input.intervalMinutes,
    enabled: true,
    deliverTo: input.deliverTo ?? 'inbox',
    createdAt: now,
    nextRunAt: now + input.intervalMinutes * 60_000,
    lastRunAt: null,
    lastResult: null,
  };
}

/** Enabled automations whose nextRunAt is due. */
export function dueAutomations(items: Automation[], now: number = Date.now()): Automation[] {
  return items.filter((a) => a.enabled && a.nextRunAt <= now);
}

/** Stamp a run result and roll nextRunAt forward by the interval. */
export function markRan(a: Automation, result: string, now: number = Date.now()): Automation {
  return { ...a, lastRunAt: now, lastResult: result, nextRunAt: now + a.intervalMinutes * 60_000 };
}
