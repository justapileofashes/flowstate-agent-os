import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { agentFormSchema, AVATAR_COLORS, type AgentFormValues } from '@shared/agent-form-schema';
import type { AgentDto } from '@shared/chat-types';
import { SYSTEM_PROMPT_PRESETS } from '@shared/system-prompt-presets';
import { modalBackdrop, modalPanel } from '../lib/motion';

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

  useEffect(() => {
    void ipc.chat.listModels().then((res) => {
      setModels(res.models);
      if (!values.model && res.models.length > 0) {
        setValues((v) => ({ ...v, model: res.models[0]!.name }));
      }
    });
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
      if (mode === 'create') {
        const { agent } = await ipc.chat.createAgent(parsed.data);
        onSaved(agent);
      } else if (initial) {
        const { agent } = await ipc.chat.updateAgent({ id: initial.id, ...parsed.data });
        onSaved(agent);
      }
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
          </div>
        </Field>

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

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">{label}</span>
      {children}
    </label>
  );
}
