import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { agentFormSchema, AVATAR_COLORS, type AgentFormValues } from '@shared/agent-form-schema';
import type { AgentDto } from '@shared/chat-types';
import type { PluginSkillDto } from '@shared/ipc-channels';
import { SYSTEM_PROMPT_PRESETS } from '@shared/system-prompt-presets';
import { modalBackdrop, modalPanel } from '../lib/motion';
import { TOOL_GROUPS, TOOL_GROUP_IDS } from '@shared/tool-groups';

interface Props {
  mode: 'create' | 'edit';
  initial?: AgentDto;
  onClose: () => void;
  onSaved: (agent: AgentDto) => void;
}

const EMPTY: AgentFormValues = {
  name: '',
  description: '',
  specialtyTags: [],
  systemPrompt:
    'You are a helpful AI agent. Use the available tools to read, write, and search files inside your workspace.',
  model: '',
  avatarColor: AVATAR_COLORS[0],
  toolPerms: { shell_enabled: false, delete_enabled: true },
  approvalPolicy: 'cautious',
};

export function AgentFormModal({ mode, initial, onClose, onSaved }: Props): JSX.Element {
  const [values, setValues] = useState<AgentFormValues>(() =>
    initial
      ? {
          name: initial.name,
          description: initial.description,
          specialtyTags: initial.specialtyTags,
          systemPrompt: initial.systemPrompt,
          model: initial.model,
          avatarColor: initial.avatarColor,
          toolPerms: initial.toolPerms,
          approvalPolicy: initial.approvalPolicy,
        }
      : EMPTY,
  );
  const [tagsInput, setTagsInput] = useState<string>(values.specialtyTags.join(', '));
  const [models, setModels] = useState<Array<{ name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Skill allowlist: null = every enabled skill; a list = only those.
  const [skills, setSkills] = useState<PluginSkillDto[] | null>(null);
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [skillsDirty, setSkillsDirty] = useState(false);

  useEffect(() => {
    void ipc.chat.listModels().then((res) => {
      setModels(res.models);
      if (!values.model && res.models.length > 0) {
        setValues((v) => ({ ...v, model: res.models[0]!.name }));
      }
    });
    void Promise.all([
      ipc.plugins.listSkills(),
      initial ? ipc.plugins.getAgentSkills(initial.id) : Promise.resolve({ names: null }),
    ])
      .then(([s, a]) => {
        setSkills(s.skills);
        setAllowed(a.names);
      })
      .catch(() => setSkills([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof AgentFormValues>(key: K, val: AgentFormValues[K]): void {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function submit(): Promise<void> {
    setError(null);
    const parsed = agentFormSchema.safeParse({
      ...values,
      specialtyTags: tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    });
    if (!parsed.success) {
      setError(parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '));
      return;
    }
    setSaving(true);
    try {
      let saved: AgentDto | null = null;
      if (mode === 'create') {
        saved = (await ipc.chat.createAgent(parsed.data)).agent;
      } else if (initial) {
        saved = (await ipc.chat.updateAgent({ id: initial.id, ...parsed.data })).agent;
      }
      if (saved && skillsDirty) await ipc.plugins.setAgentSkills(saved.id, allowed);
      if (saved) onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="w-[640px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4"
        variants={modalPanel}
      >
        <h2 className="text-lg font-semibold">{mode === 'create' ? 'New agent' : 'Edit agent'}</h2>

        <Field label="Name">
          <input
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            maxLength={60}
          />
        </Field>

        <Field label="Description">
          <input
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            maxLength={200}
          />
        </Field>

        <Field label="Specialty tags (comma-separated)">
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="frontend, react, typescript"
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </Field>

        <Field label="System prompt preset (optional)">
          <select
            value=""
            onChange={(e) => {
              const preset = SYSTEM_PROMPT_PRESETS.find((p) => p.id === e.target.value);
              if (preset) set('systemPrompt', preset.prompt);
            }}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">— pick a preset to fill the prompt below —</option>
            {SYSTEM_PROMPT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
        </Field>

        <Field label="System prompt">
          <textarea
            value={values.systemPrompt}
            onChange={(e) => set('systemPrompt', e.target.value)}
            rows={6}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-mono"
            maxLength={4000}
          />
        </Field>

        <Field label="Model">
          <select
            value={values.model}
            onChange={(e) => set('model', e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {models.length === 0 ? <option value="">No models pulled</option> : null}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Avatar color">
          <div className="flex gap-2">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => set('avatarColor', c)}
                className={`w-7 h-7 rounded-md border-2 transition ${
                  values.avatarColor === c ? 'border-white' : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Pick ${c}`}
              />
            ))}
          </div>
        </Field>

        <Field label="Tools enabled">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.toolPerms.shell_enabled}
                onChange={(e) =>
                  set('toolPerms', { ...values.toolPerms, shell_enabled: e.target.checked })
                }
              />
              Enable shell (run_shell). Always requires approval per policy.
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={values.toolPerms.delete_enabled}
                onChange={(e) =>
                  set('toolPerms', { ...values.toolPerms, delete_enabled: e.target.checked })
                }
              />
              Enable file deletion (delete_file).
            </label>
            <div className="hint" style={{ marginTop: 4 }}>
              Toolset — fewer tools keep small local models accurate. File tools are always on.
            </div>
            {TOOL_GROUPS.map((g) => {
              const groups = values.toolPerms.groups ?? TOOL_GROUP_IDS;
              return (
                <label key={g.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={groups.includes(g.id)}
                    onChange={(e) =>
                      set('toolPerms', {
                        ...values.toolPerms,
                        groups: e.target.checked
                          ? [...new Set([...groups, g.id])]
                          : groups.filter((x) => x !== g.id),
                      })
                    }
                  />
                  {g.label}
                  <span className="muted text-xs">{g.hint}</span>
                </label>
              );
            })}
          </div>
        </Field>

        <SkillPicker
          skills={skills}
          allowed={allowed}
          onChange={(next) => {
            setAllowed(next);
            setSkillsDirty(true);
          }}
        />

        <Field label="Approval policy">
          <div className="flex gap-3 text-sm">
            {(['cautious', 'trusting', 'yolo'] as const).map((p) => (
              <label key={p} className="flex items-center gap-1">
                <input
                  type="radio"
                  name="approvalPolicy"
                  checked={values.approvalPolicy === p}
                  onChange={() => {
                    if (p === 'yolo') {
                      const ok = window.confirm(
                        'YOLO mode: ALL tool calls (including shell + delete) will run WITHOUT approval. This includes destructive commands. Continue?',
                      );
                      if (!ok) return;
                    }
                    set('approvalPolicy', p);
                  }}
                />
                {p}
              </label>
            ))}
          </div>
        </Field>

        {error ? (
          <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Which skills this agent sees. Fewer skills = a shorter prompt, which
 *  matters for small local models. Workspace .claude/skills always apply. */
function SkillPicker({
  skills,
  allowed,
  onChange,
}: {
  skills: PluginSkillDto[] | null;
  allowed: string[] | null;
  onChange: (next: string[] | null) => void;
}): JSX.Element {
  const [filter, setFilter] = useState('');
  const total = skills?.length ?? 0;
  const chosen = new Set(allowed ?? []);
  const q = filter.trim().toLowerCase();
  const shown = (skills ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
  );

  return (
    <div className="space-y-1">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">Skills</span>
      {skills === null ? (
        <div className="text-sm text-[var(--ink-faint)]">Loading skills…</div>
      ) : total === 0 ? (
        <div className="text-sm text-[var(--ink-faint)]">
          No skills installed. Add some on the Plugins screen.
        </div>
      ) : (
        <>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Skills this agent can use">
            <label className="flex items-center gap-1">
              <input type="radio" name="skillMode" checked={allowed === null} onChange={() => onChange(null)} />
              All enabled skills ({total})
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="skillMode"
                checked={allowed !== null}
                onChange={() => onChange(allowed ?? [])}
              />
              Only selected{allowed !== null ? ` (${chosen.size})` : ''}
            </label>
          </div>
          {allowed !== null ? (
            <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 space-y-2">
              <div className="flex gap-2 items-center">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter skills…"
                  aria-label="Filter skills"
                  className="flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onChange([...new Set([...chosen, ...shown.map((s) => s.name)])])}
                >
                  Select shown
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>
                  Clear
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {shown.map((s) => (
                  <label key={s.name} className="flex items-start gap-2 text-sm" title={s.description}>
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={chosen.has(s.name)}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...chosen, s.name]
                            : [...chosen].filter((n) => n !== s.name),
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="font-mono">{s.name}</span>
                      <span className="text-[var(--ink-faint)]"> · {s.pluginId || s.source || 'standalone'}</span>
                      <span className="block text-xs text-[var(--ink-faint)] truncate">{s.description}</span>
                    </span>
                  </label>
                ))}
                {shown.length === 0 ? <div className="text-xs text-[var(--ink-faint)]">No match.</div> : null}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">{label}</span>
      {children}
    </label>
  );
}
