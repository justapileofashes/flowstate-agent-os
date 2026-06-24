// Full-setup backup. Bundles your agents + non-secret settings into one
// portable JSON file so you can move to a new machine or restore after a wipe.
// Secrets (API keys, license tokens) are DELIBERATELY excluded — a backup is a
// shareable/cloud-stored artifact and must never carry credentials. Pure:
// serialize/parse only; file IO + agent creation live in the IPC handler.

import { z } from 'zod';
import { SECRET_SETTING_KEYS } from './settings-service';

export const BACKUP_KIND = 'flowstate-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = 'flowstate-backup.json';

const backupAgentSchema = z.object({
  name: z.string(),
  description: z.string(),
  specialtyTags: z.array(z.string()),
  systemPrompt: z.string(),
  model: z.string(),
  avatarColor: z.string(),
  toolPerms: z.object({ shell_enabled: z.boolean(), delete_enabled: z.boolean() }),
  approvalPolicy: z.enum(['cautious', 'trusting', 'yolo']),
});
export type BackupAgent = z.infer<typeof backupAgentSchema>;

const backupSchema = z.object({
  kind: z.literal(BACKUP_KIND),
  version: z.number(),
  exportedAt: z.number(),
  agents: z.array(backupAgentSchema),
  settings: z.record(z.string(), z.string()),
});
export type Backup = z.infer<typeof backupSchema>;

/** Settings keys never written to a backup (secrets + machine-local cache). */
const EXCLUDED_SETTING_PREFIXES = ['license.', 'chat_model_override:', 'chat_workspace_override:'];

function isExcludedSetting(key: string): boolean {
  if (SECRET_SETTING_KEYS.has(key)) return true;
  return EXCLUDED_SETTING_PREFIXES.some((p) => key.startsWith(p));
}

export function buildBackup(
  agents: BackupAgent[],
  settings: Array<{ key: string; value: string }>,
  now: number = Date.now(),
): Backup {
  const filtered: Record<string, string> = {};
  for (const { key, value } of settings) {
    if (!isExcludedSetting(key)) filtered[key] = value;
  }
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: now,
    agents: agents.map((a) => backupAgentSchema.parse(a)),
    settings: filtered,
  };
}

/** Parse a backup file. Throws a friendly error on a wrong/garbled file. */
export function parseBackup(json: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('Not a valid backup file (could not parse JSON).');
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('Not a valid FlowState backup file.');
  }
  if (parsed.data.version > BACKUP_VERSION) {
    throw new Error(`This backup was made by a newer version (v${parsed.data.version}).`);
  }
  // Restore never reintroduces secrets even if a hand-edited file added them.
  for (const key of Object.keys(parsed.data.settings)) {
    if (isExcludedSetting(key)) delete parsed.data.settings[key];
  }
  return parsed.data;
}
