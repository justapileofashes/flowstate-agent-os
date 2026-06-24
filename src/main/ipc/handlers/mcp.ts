import { ipcMain, BrowserWindow } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { McpManager } from '@main/services/mcp-manager';
import type { SettingsService } from '@main/services/settings-service';
import type { McpServerConfig } from '@main/services/mcp-client';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';

const SETTINGS_KEY = 'mcp_servers';

// Encrypts/decrypts connector `env` secrets at rest via the OS keychain.
const secrets = new SecretStore(electronSafeStorageBackend());

/** Parse the persisted JSON into configs, leaving `env` in its stored form
 *  (which may be encrypted). Shared by the decrypting reader and the migration
 *  check so both see the same coerced shape. */
function parseStored(settings: SettingsService): McpServerConfig[] {
  const raw = settings.get(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive — coerce shape
    return parsed
      .map((p): McpServerConfig | null => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        const id = typeof o['id'] === 'string' ? o['id'] : '';
        const name = typeof o['name'] === 'string' ? o['name'] : id;
        const command = typeof o['command'] === 'string' ? o['command'] : '';
        const args = Array.isArray(o['args'])
          ? (o['args'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        if (!id || !command) return null;
        const env =
          o['env'] && typeof o['env'] === 'object'
            ? (Object.fromEntries(
                Object.entries(o['env'] as Record<string, unknown>).filter(
                  ([, v]) => typeof v === 'string',
                ),
              ) as Record<string, string>)
            : undefined;
        const cwd = typeof o['cwd'] === 'string' ? o['cwd'] : undefined;
        const cfg: McpServerConfig = { id, name, command, args };
        if (env) cfg.env = env;
        if (cwd) cfg.cwd = cwd;
        return cfg;
      })
      .filter((c): c is McpServerConfig => c !== null);
  } catch {
    return [];
  }
}

/** Configs with secrets decrypted — safe to spawn or hand back to the renderer
 *  (over local IPC; the threat being closed here is on-disk plaintext). */
function readServers(settings: SettingsService): McpServerConfig[] {
  return parseStored(settings).map((c) => {
    if (c.env) c.env = secrets.decryptEnv(c.env);
    return c;
  });
}

/** Persist configs with their `env` secrets encrypted at rest. */
function persistServers(settings: SettingsService, servers: McpServerConfig[]): void {
  const toStore = servers.map((s) => {
    const cfg: McpServerConfig = { id: s.id, name: s.name, command: s.command, args: s.args };
    const enc = secrets.encryptEnv(s.env);
    if (enc) cfg.env = enc;
    if (s.cwd) cfg.cwd = s.cwd;
    return cfg;
  });
  settings.set(SETTINGS_KEY, JSON.stringify(toStore));
}

export function registerMcpHandlers(deps: {
  manager: McpManager;
  settings: SettingsService;
}): void {
  // One-time migration: if any persisted secret is still plaintext (saved
  // before encryption existed) and the keychain is available, re-persist the
  // whole set encrypted.
  if (secrets.needsMigration(parseStored(deps.settings).map((c) => c.env))) {
    persistServers(deps.settings, readServers(deps.settings));
  }

  // Apply persisted servers on startup
  void deps.manager.setServers(readServers(deps.settings));

  // Broadcast status changes to renderer
  deps.manager.on('status', (status) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send(CHANNELS.MCP_STATUS, { status });
  });

  ipcMain.handle(CHANNELS.MCP_LIST, () => {
    return {
      servers: readServers(deps.settings),
      status: deps.manager.statusList(),
    };
  });

  ipcMain.handle(CHANNELS.MCP_SAVE, async (_e, raw) => {
    const { servers } = schemas.mcpSaveRequest.parse(raw);
    // Coerce optional fields explicitly so spawn() gets the right shape
    const configs: McpServerConfig[] = servers.map((s) => {
      const cfg: McpServerConfig = {
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args,
      };
      if (s.env) cfg.env = s.env;
      if (s.cwd) cfg.cwd = s.cwd;
      return cfg;
    });
    // Persist with secrets encrypted; spawn with the plaintext copy.
    persistServers(deps.settings, configs);
    await deps.manager.setServers(configs);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.MCP_TEST, async (_e, raw) => {
    const { server } = schemas.mcpTestRequest.parse(raw);
    // Form values are plaintext (user just typed them) — test as-is, nothing
    // persisted, nothing registered.
    const cfg: McpServerConfig = {
      id: server.id,
      name: server.name,
      command: server.command,
      args: server.args,
    };
    if (server.env) cfg.env = server.env;
    if (server.cwd) cfg.cwd = server.cwd;
    return deps.manager.testServer(cfg);
  });
}
