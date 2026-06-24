// Tracks every configured MCP server. Spawns clients, aggregates their
// tool specs, routes tool calls, broadcasts state changes to the renderer.
//
// Tool naming: each MCP tool is exposed to agents as
//   mcp__<serverId>__<toolName>
// so collisions across servers are impossible, and the dispatcher can
// route by prefix without ambiguity.

import { EventEmitter } from 'node:events';
import { McpClient, type McpServerConfig, type McpClientState } from './mcp-client';
import type { ToolSpec } from '@main/agent/types';

export interface McpServerStatus {
  id: string;
  name: string;
  command: string;
  args: string[];
  state: McpClientState;
  toolCount: number;
  lastError: string | null;
}

export interface McpTestResult {
  ok: boolean;
  toolCount: number;
  tools: string[];
  error: string | null;
}

const TOOL_PREFIX = 'mcp__';

function isSafeId(id: string): boolean {
  // Up to 64 chars: plugin-contributed servers use `plugin-<pluginId>-<server>`.
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id);
}

export class McpManager extends EventEmitter {
  private readonly clients = new Map<string, McpClient>();
  // Two layers merged into the live set: user-configured servers (from
  // Settings) and plugin-contributed servers. Either can be updated
  // independently without clobbering the other.
  private userConfigs: McpServerConfig[] = [];
  private pluginConfigs: McpServerConfig[] = [];

  /** Replace the user (Settings) server layer. */
  async setServers(configs: McpServerConfig[]): Promise<void> {
    this.userConfigs = configs;
    await this.apply();
  }

  /** Replace the plugin-contributed server layer. */
  async setPluginServers(configs: McpServerConfig[]): Promise<void> {
    this.pluginConfigs = configs;
    await this.apply();
  }

  /** Reconcile the live client set against the merged layers (user wins on id
   *  collision). Stops dropped servers, starts new ones. */
  private async apply(): Promise<void> {
    const merged = new Map<string, McpServerConfig>();
    for (const c of this.pluginConfigs) merged.set(c.id, c);
    for (const c of this.userConfigs) merged.set(c.id, c); // user overrides plugin
    const configs = Array.from(merged.values());
    const nextIds = new Set(configs.map((c) => c.id));

    // Stop servers that disappeared
    for (const [id, client] of this.clients) {
      if (!nextIds.has(id)) {
        client.stop();
        this.clients.delete(id);
      }
    }

    // Start / update remaining
    for (const cfg of configs) {
      if (!isSafeId(cfg.id)) {
        // eslint-disable-next-line no-console
        console.warn(`[mcp] skipping server with invalid id: ${cfg.id}`);
        continue;
      }
      const existing = this.clients.get(cfg.id);
      if (existing && sameConfig(existing.config, cfg)) {
        continue; // already running with this exact config
      }
      if (existing) {
        existing.stop();
      }
      const client = new McpClient(cfg);
      client.on('state', () => this.emit('status', this.statusList()));
      this.clients.set(cfg.id, client);
      // Fire and forget — start failures show up via the status broadcast
      void client.start().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`[mcp:${cfg.id}] start failed: ${err.message}`);
      });
    }
    this.emit('status', this.statusList());
  }

  statusList(): McpServerStatus[] {
    return Array.from(this.clients.values()).map((c) => ({
      id: c.config.id,
      name: c.config.name,
      command: c.config.command,
      args: c.config.args,
      state: c.state,
      toolCount: c.tools.length,
      lastError: c.lastError,
    }));
  }

  /**
   * Aggregate all ready servers' tools as ToolSpec entries the LLM provider
   * can advertise. Tool name format: mcp__<serverId>__<toolName>.
   */
  toolSpecs(): ToolSpec[] {
    const out: ToolSpec[] = [];
    for (const client of this.clients.values()) {
      if (client.state !== 'ready') continue;
      for (const t of client.tools) {
        out.push({
          name: `${TOOL_PREFIX}${client.config.id}__${t.name}`,
          description: t.description ?? `${client.config.name}: ${t.name}`,
          parameters: t.inputSchema ?? { type: 'object', properties: {} },
        });
      }
    }
    return out;
  }

  /** True iff this tool name is routed through MCP. */
  static isMcpTool(name: string): boolean {
    return name.startsWith(TOOL_PREFIX);
  }

  /** Route a tool call to the right server. Throws on unknown routing. */
  async callTool(
    fullName: string,
    args: unknown,
  ): Promise<{ content: string; isError: boolean }> {
    if (!McpManager.isMcpTool(fullName)) {
      throw new Error(`Not an MCP tool: ${fullName}`);
    }
    const rest = fullName.slice(TOOL_PREFIX.length);
    const sepIdx = rest.indexOf('__');
    if (sepIdx <= 0) throw new Error(`Malformed MCP tool name: ${fullName}`);
    const serverId = rest.slice(0, sepIdx);
    const toolName = rest.slice(sepIdx + 2);
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`Unknown MCP server: ${serverId}`);
    return client.callTool(toolName, args);
  }

  /**
   * Dry-run a config without persisting or registering it: spawn a throwaway
   * client, run the initialize + tools/list handshake, then tear it down.
   * Lets the UI surface a bad command, missing package, or bad token before a
   * secret is ever saved. Always cleans up the child process.
   */
  async testServer(config: McpServerConfig): Promise<McpTestResult> {
    const client = new McpClient(config);
    try {
      await client.start();
      return {
        ok: true,
        toolCount: client.tools.length,
        tools: client.tools.slice(0, 50).map((t) => t.name),
        error: null,
      };
    } catch (err) {
      return {
        ok: false,
        toolCount: 0,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      client.stop();
    }
  }

  stopAll(): void {
    for (const client of this.clients.values()) {
      client.stop();
    }
    this.clients.clear();
  }
}

function sameConfig(a: McpServerConfig, b: McpServerConfig): boolean {
  return (
    a.command === b.command &&
    JSON.stringify(a.args) === JSON.stringify(b.args) &&
    JSON.stringify(a.env ?? {}) === JSON.stringify(b.env ?? {}) &&
    (a.cwd ?? '') === (b.cwd ?? '')
  );
}
