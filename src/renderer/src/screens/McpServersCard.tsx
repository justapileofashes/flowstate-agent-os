import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { McpServerDto, McpServerStatusDto } from '@shared/ipc-channels';

interface DraftServer {
  id: string;
  name: string;
  command: string;
  argsStr: string;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

export function McpServersCard(): JSX.Element {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [status, setStatus] = useState<McpServerStatusDto[]>([]);
  const [draft, setDraft] = useState<DraftServer>({ id: '', name: '', command: '', argsStr: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await ipc.mcp.list();
      setServers(res.servers);
      setStatus(res.status);
    } catch {
      // ignored
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = ipc.mcp.subscribeStatus((p) => setStatus(p.status));
    return unsub;
  }, [refresh]);

  async function persist(next: McpServerDto[]): Promise<void> {
    setSaving(true);
    try {
      await ipc.mcp.save(next);
      setServers(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function addDraft(): Promise<void> {
    setError(null);
    const id = draft.id.trim();
    const name = draft.name.trim() || id;
    const command = draft.command.trim();
    if (!ID_RE.test(id)) {
      setError('ID must be 1–31 chars, alphanumeric / _ / - only.');
      return;
    }
    if (!command) {
      setError('Command is required.');
      return;
    }
    if (servers.some((s) => s.id === id)) {
      setError(`Server id "${id}" already exists.`);
      return;
    }
    const args = draft.argsStr
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const newServer: McpServerDto = { id, name, command, args };
    await persist([...servers, newServer]);
    setDraft({ id: '', name: '', command: '', argsStr: '' });
  }

  async function remove(id: string): Promise<void> {
    setError(null);
    await persist(servers.filter((s) => s.id !== id));
  }

  return (
    <section className="card">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-base font-semibold">MCP servers</h3>
          <p className="text-sm text-[var(--ink-muted)]">
            Model Context Protocol servers expose extra tools to every agent. Spawned over
            stdio. Tool names appear as{' '}
            <span className="kbd">mcp__&lt;id&gt;__&lt;tool&gt;</span>.
          </p>
        </div>
      </div>

      {servers.length === 0 ? (
        <div className="text-xs text-[var(--ink-faint)] mt-2 mb-3">
          No MCP servers configured.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--border)] mt-3 mb-4">
          {servers.map((s) => {
            const st = status.find((x) => x.id === s.id);
            return (
              <li key={s.id} className="py-3 flex items-start gap-3">
                <StatusDot state={st?.state ?? 'idle'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-[10px] text-[var(--ink-faint)]">{s.id}</span>
                    {st ? (
                      <span className="text-[10px] text-[var(--ink-faint)]">
                        {st.state}
                        {st.state === 'ready' ? ` · ${st.toolCount} tools` : ''}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] mt-0.5 break-all">
                    {[s.command, ...s.args].join(' ')}
                  </div>
                  {st?.lastError ? (
                    <div className="text-[11px] text-[var(--bad)] mt-1">{st.lastError}</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => void remove(s.id)}
                  disabled={saving}
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-[var(--border)] pt-3 mt-2">
        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold mb-2">
          Add server
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input
            value={draft.id}
            onChange={(e) => setDraft((d) => ({ ...d, id: e.target.value }))}
            placeholder="id (e.g. filesystem)"
            className="field text-xs"
            maxLength={31}
          />
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="name (optional)"
            className="field text-xs"
            maxLength={60}
          />
          <input
            value={draft.command}
            onChange={(e) => setDraft((d) => ({ ...d, command: e.target.value }))}
            placeholder="command (e.g. npx)"
            className="field text-xs"
          />
          <input
            value={draft.argsStr}
            onChange={(e) => setDraft((d) => ({ ...d, argsStr: e.target.value }))}
            placeholder="args (space-separated)"
            className="field text-xs"
          />
        </div>
        {error ? <div className="text-xs text-[var(--bad)] mt-2">{error}</div> : null}
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            className="btn btn-primary text-xs"
            onClick={() => void addDraft()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Add server'}
          </button>
        </div>
        <div className="mt-3 text-[10px] text-[var(--ink-faint)] leading-relaxed">
          Example:{' '}
          <span className="kbd">npx</span>{' '}
          <span className="kbd">-y @modelcontextprotocol/server-filesystem C:\path</span>
        </div>
      </div>
    </section>
  );
}

function StatusDot({ state }: { state: McpServerStatusDto['state'] }): JSX.Element {
  const cls =
    state === 'ready'
      ? 'dot dot-good'
      : state === 'starting'
        ? 'dot dot-good dot-pulse'
        : state === 'error' || state === 'exited'
          ? 'dot dot-bad'
          : 'dot';
  return <span className={cls} title={state} />;
}
