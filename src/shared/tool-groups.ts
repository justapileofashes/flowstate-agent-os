// Per-agent toolsets. Every agent always has the file tools; the groups below
// are opt-in per agent (stored as `toolPerms.groups`). An agent with no
// `groups` field predates toolsets and keeps every tool, so nothing an
// existing agent could do is taken away. Small local models choose tools
// better (and spend less context) when they only see the ones they need.

import { z } from 'zod';

export const TOOL_GROUPS = [
  { id: 'web', label: 'Web', hint: 'Search the web and read pages', tools: ['web_search', 'fetch_url'] },
  { id: 'brain', label: 'Brain', hint: 'Read and write the knowledge base', tools: ['brain_capture', 'brain_note', 'brain_search'] },
  { id: 'design', label: 'Design', hint: 'HTML/SVG artifacts and 3D models', tools: ['design_artifact', 'generate_3d_model'] },
  {
    id: 'markets',
    label: 'Markets',
    hint: 'Market data, charts and the paper-trading desk',
    tools: [
      'stock_data',
      'stock_chart',
      'trading_account',
      'propose_trade',
      'close_trade',
      'trader_signals',
      'list_strategies',
      'save_strategy',
      'trade_journal',
    ],
  },
  { id: 'skills', label: 'Skills', hint: 'Installed skills', tools: ['skill'] },
  { id: 'mcp', label: 'Connectors', hint: 'Tools from your MCP connectors', tools: [] },
] as const;

export type ToolGroupId = (typeof TOOL_GROUPS)[number]['id'];

export const TOOL_GROUP_IDS: ToolGroupId[] = TOOL_GROUPS.map((g) => g.id);

/** The stored/IPC shape of an agent's tool permissions. Unknown group ids are
 *  dropped (a pack from a newer build still imports). */
export const toolPermsSchema = z.object({
  shell_enabled: z.boolean(),
  delete_enabled: z.boolean(),
  groups: z
    .array(z.string())
    .max(20)
    .transform((gs) => [...new Set(gs.filter((g) => (TOOL_GROUP_IDS as string[]).includes(g)))])
    .optional(),
});

/** Which opt-in group a tool belongs to; undefined = always available
 *  (files) or governed by another switch (shell, run_code). */
export function toolGroupOf(toolName: string): ToolGroupId | undefined {
  if (toolName.startsWith('mcp__')) return 'mcp';
  return TOOL_GROUPS.find((g) => (g.tools as readonly string[]).includes(toolName))?.id;
}

/** Is this tool enabled for an agent with these groups? */
export function toolAllowed(toolName: string, groups: readonly string[] | undefined): boolean {
  if (!groups) return true;
  const g = toolGroupOf(toolName);
  return g === undefined || groups.includes(g);
}
