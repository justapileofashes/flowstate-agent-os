// Desktop notifications (roadmap 2c): surface approval requests and run
// completion when the user is away from the window. The decision logic is
// pure so it can be unit-tested; the Electron Notification side lives in
// main/index.ts.

import { redactSensitive } from './redaction';

export interface NotificationContent {
  title: string;
  body: string;
}

const MAX_BODY = 200;

/** Map an agent stream event payload to a desktop notification, or null when
 *  the event is not notification-worthy (deltas, usage, user aborts, junk). */
export function decideNotification(payload: unknown): NotificationContent | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (p.type === 'tool-approval-required' && typeof p.toolName === 'string') {
    let detail = '';
    try {
      detail = redactSensitive(JSON.stringify(p.args ?? ''));
    } catch {
      // args not serializable — tool name alone is enough
    }
    return {
      title: 'FlowState — approval needed',
      body: clip(`${p.toolName} is waiting for your approval. ${detail}`),
    };
  }

  if (p.type === 'turn-done') {
    if (p.reason === 'error') {
      const err = typeof p.error === 'string' ? redactSensitive(p.error) : 'unknown error';
      return { title: 'FlowState — run failed', body: clip(err) };
    }
    if (p.reason === 'end' || p.reason === 'max-tools') {
      return { title: 'FlowState — agent finished', body: 'The agent completed its turn.' };
    }
    return null; // 'aborted' — the user did it themselves
  }

  return null;
}

function clip(s: string): string {
  const t = s.trim();
  return t.length > MAX_BODY ? t.slice(0, MAX_BODY - 1) + '…' : t;
}
