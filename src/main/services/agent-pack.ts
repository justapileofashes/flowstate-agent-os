// Agent pack export/import — share agents as JSON files (roadmap 5c slice).
// A pack carries only portable fields: ids, workspace paths, and timestamps
// are machine-specific and re-generated on import.

import { z } from 'zod';

export const AGENT_PACK_KIND = 'flowstate-agent-pack';
export const AGENT_PACK_VERSION = 1;
export const AGENT_PACK_EXTENSION = 'flowstate-agents.json';

// Caps mirror chatCreateAgentRequest in shared/ipc-channels.ts so every
// imported agent passes the create/update UI validation afterwards.
const packAgentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
  specialtyTags: z.array(z.string()).max(10),
  systemPrompt: z.string().min(1).max(4000),
  model: z.string().min(1),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  toolPerms: z.object({ shell_enabled: z.boolean(), delete_enabled: z.boolean() }),
  approvalPolicy: z.enum(['cautious', 'trusting', 'yolo']),
});

const packSchema = z.object({
  kind: z.literal(AGENT_PACK_KIND),
  version: z.literal(AGENT_PACK_VERSION),
  exportedAt: z.number().optional(),
  agents: z.array(packAgentSchema).min(1).max(200),
});

export type ExportableAgent = z.infer<typeof packAgentSchema>;
export type AgentPack = z.infer<typeof packSchema>;

export function serializeAgents(agents: ExportableAgent[]): AgentPack {
  return {
    kind: AGENT_PACK_KIND,
    version: AGENT_PACK_VERSION,
    exportedAt: Date.now(),
    agents: agents.map((a) => packAgentSchema.parse(a)),
  };
}

export function parseAgentPack(json: string): AgentPack {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  const result = packSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(
      `Not a valid FlowState agent pack${first ? ` (${first.path.join('.')}: ${first.message})` : ''}.`,
    );
  }
  return result.data;
}

export interface ImportPlan {
  id: string;
  workspaceSlug: string;
  agent: ExportableAgent;
}

/** Assign unique ids + workspace slugs to incoming agents, deduping against
 *  what's already on this machine AND earlier entries in the same pack.
 *  Imported prompts are untrusted: shell-enabled agents are downgraded to
 *  the 'cautious' approval policy so every command still gets a prompt. */
export function planImports(
  agents: ExportableAgent[],
  existing: { slugs: string[]; ids: string[] },
): ImportPlan[] {
  const takenSlugs = new Set(existing.slugs);
  const takenIds = new Set(existing.ids);
  return agents.map((agent) => {
    const base = slugify(agent.name);
    let slug = base;
    for (let n = 2; takenSlugs.has(slug) || takenIds.has(`agent-imp-${slug}`); n++) {
      slug = `${base}-${n}`;
    }
    takenSlugs.add(slug);
    const id = `agent-imp-${slug}`;
    takenIds.add(id);
    const safeAgent: ExportableAgent =
      agent.toolPerms.shell_enabled && agent.approvalPolicy !== 'cautious'
        ? { ...agent, approvalPolicy: 'cautious' }
        : agent;
    return { id, workspaceSlug: slug, agent: safeAgent };
  });
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return slug.length > 0 ? slug : 'imported-agent';
}
