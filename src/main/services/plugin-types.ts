// Shared shapes for the Claude Code-format plugin/skill runtime. Kept in their
// own module so both the manager and its consumers (skill-registry, dispatcher,
// IPC handlers) can import without pulling in node:fs.

import type { McpServerConfig } from './mcp-client';

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
}

/** A SKILL.md a plugin (or standalone folder) provides. */
export interface SkillEntry {
  name: string;
  description: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Absolute path to the skill's directory (holds bundled support files). */
  dir: string;
  /** Owning plugin id, or null for a standalone skill. */
  pluginId: string | null;
}

/** A slash command (`commands/*.md`). */
export interface CommandEntry {
  /** Command name without the leading slash. */
  name: string;
  description: string;
  body: string;
  pluginId: string;
}

/** An agent definition (`agents/*.md`). */
export interface PluginAgentEntry {
  name: string;
  description: string;
  model?: string;
  tools: string[];
  /** Markdown body — becomes the agent's system prompt. */
  body: string;
  pluginId: string;
}

/** An MCP server contributed by a plugin (`.mcp.json`). */
export interface PluginMcpEntry {
  /** Server name as written in .mcp.json. */
  serverName: string;
  config: McpServerConfig;
  pluginId: string;
}

/** A single hook command bound to a lifecycle event (`hooks/hooks.json`). */
export interface HookEntry {
  /** Claude Code event, e.g. PreToolUse, PostToolUse, UserPromptSubmit. */
  event: string;
  /** Optional matcher (tool-name glob/regex for tool events). */
  matcher?: string;
  /** Shell command to run. */
  command: string;
  pluginId: string;
}

export type PluginOrigin =
  | { kind: 'marketplace'; marketplaceId: string }
  | { kind: 'local' }
  | { kind: 'claude-home' };

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  origin: PluginOrigin;
  /** Absolute path to the plugin root. */
  path: string;
  enabled: boolean;
  /** Hooks NEVER run unless this is true (they execute arbitrary shell). */
  hooksConsent: boolean;
  components: {
    skills: number;
    commands: number;
    agents: number;
    mcp: number;
    hooks: number;
  };
  /** True for claude-home discoveries — read-only, cannot be uninstalled. */
  readOnly: boolean;
}

export interface MarketplaceRef {
  id: string;
  name: string;
  /** Git URL or local path. */
  source: string;
  /** Absolute path on disk (clone dir for git, the path itself for local). */
  path: string;
  addedAt: number;
}

/** One plugin offered by a marketplace (not necessarily installed). */
export interface MarketplacePlugin {
  marketplaceId: string;
  name: string;
  description: string;
  /** Source within the marketplace (relative path or git url). */
  source: string;
  installed: boolean;
}
