// IPC handlers for the vibe-dev feature pack: prompt snippets, custom slash
// commands, spend budget guard, @file mentions, project-convention context,
// token preflight, environment doctor, pinned chats, and composer prompt
// history. All persistence is settings-KV; the heavy logic lives in pure,
// unit-tested services — these handlers just wire data in and out.

import { ipcMain } from 'electron';
import { accessSync, constants, statfsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { LLMProvider } from '@main/agent/llm-provider';
import { resolveSafe } from '@main/tools/path-sandbox';
import { querySpend } from './usage';
import {
  parseSnippets,
  serializeSnippets,
  snippetSchema,
  type Snippet,
} from '@main/services/prompt-snippets';
import {
  parseUserCommands,
  serializeUserCommands,
  userCommandSchema,
} from '@main/services/user-commands';
import { evaluateBudget } from '@main/services/budget';
import { parseMentions, buildContextBlock, type MentionedFile } from '@main/services/file-mentions';
import {
  CONVENTION_FILES,
  pickConventionFiles,
  buildConventionPreamble,
  type ConventionFile,
} from '@main/services/project-context';
import { preflightPrompt, contextWindowFor } from '@main/services/token-estimate';
import { runDoctor } from '@main/services/env-doctor';
import { parsePins, serializePins, togglePin } from '@main/services/pins';
import { parseHistory, serializeHistory, pushHistory } from '@main/services/prompt-history';

const KV = {
  snippets: 'prompt_snippets',
  userCommands: 'user_commands',
  perChat: 'budget_per_chat_usd',
  perDay: 'budget_per_day_usd',
  pins: 'pinned_chats',
  history: 'prompt_history',
} as const;

const CLOUD_KEY_SETTINGS = [
  'anthropic_api_key',
  'openai_api_key',
  'gemini_api_key',
  'perplexity_api_key',
  'groq_api_key',
  'mistral_api_key',
  'xai_api_key',
];

const MAX_MENTION_BYTES = 100_000;

interface Deps {
  settings: SettingsService;
  repo: ChatRepository;
  provider: LLMProvider;
  workspacesDir: string;
  /** Optional — when present, enabled plugins' commands appear in the slash menu. */
  pluginManager?: import('@main/services/plugin-manager').PluginManager;
}

export function registerDevToolsHandlers(deps: Deps): void {
  const { settings, repo, provider, workspacesDir, pluginManager } = deps;

  // ---- Prompt snippets ----
  ipcMain.handle(CHANNELS.SNIPPETS_LIST, () => ({
    snippets: parseSnippets(settings.get(KV.snippets)),
  }));

  ipcMain.handle(CHANNELS.SNIPPETS_SAVE, (_e, raw) => {
    const { snippet } = schemas.snippetsSaveRequest.parse(raw);
    const current = parseSnippets(settings.get(KV.snippets));
    const id = snippet.id && snippet.id.length > 0 ? snippet.id : `snip_${Date.now().toString(36)}`;
    const candidate: Snippet = { id, name: snippet.name, label: snippet.label, body: snippet.body };
    const parsed = snippetSchema.safeParse(candidate);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid snippet' };
    }
    // name must be unique (case-insensitive) across other snippets
    if (current.some((s) => s.id !== id && s.name.toLowerCase() === candidate.name.toLowerCase())) {
      return { ok: false, error: `A snippet named ":${candidate.name}" already exists.` };
    }
    const next = current.some((s) => s.id === id)
      ? current.map((s) => (s.id === id ? candidate : s))
      : [...current, candidate];
    settings.set(KV.snippets, serializeSnippets(next));
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.SNIPPETS_DELETE, (_e, raw) => {
    const { id } = schemas.snippetsDeleteRequest.parse(raw);
    const next = parseSnippets(settings.get(KV.snippets)).filter((s) => s.id !== id);
    settings.set(KV.snippets, serializeSnippets(next));
    return { ok: true };
  });

  // ---- Custom slash commands ----
  ipcMain.handle(CHANNELS.USER_COMMANDS_LIST, () => {
    const user = parseUserCommands(settings.get(KV.userCommands));
    // Append enabled-plugin commands; user commands win on name collision.
    const taken = new Set(user.map((c) => c.cmd.toLowerCase()));
    const pluginCmds = (pluginManager?.commands() ?? [])
      .map((c) => ({
        cmd: '/' + c.name.replace(/^\//, ''),
        label: c.name,
        hint: c.description || `Plugin command (${c.pluginId})`,
        template: `${c.body}\n\n{{input}}`,
      }))
      .filter((c) => !taken.has(c.cmd.toLowerCase()));
    return { commands: [...user, ...pluginCmds] };
  });

  ipcMain.handle(CHANNELS.USER_COMMANDS_SAVE, (_e, raw) => {
    const { commands } = schemas.userCommandsSaveRequest.parse(raw);
    const cleaned = commands.map((c) => ({ ...c, hint: c.hint ?? '' }));
    const parsed = userCommandSchema.array().safeParse(cleaned);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid command' };
    }
    const seen = new Set<string>();
    for (const c of parsed.data) {
      const key = c.cmd.toLowerCase();
      if (seen.has(key)) return { ok: false, error: `Duplicate command ${c.cmd}` };
      seen.add(key);
    }
    settings.set(KV.userCommands, serializeUserCommands(parsed.data));
    return { ok: true };
  });

  // ---- Budget guard ----
  const readCaps = (): { perChatUsd: number; perDayUsd: number } => ({
    perChatUsd: numOr(settings.get(KV.perChat), 0),
    perDayUsd: numOr(settings.get(KV.perDay), 0),
  });

  ipcMain.handle(CHANNELS.BUDGET_GET_CAPS, () => readCaps());

  ipcMain.handle(CHANNELS.BUDGET_SET_CAPS, (_e, raw) => {
    const caps = schemas.budgetSetCapsRequest.parse(raw);
    settings.set(KV.perChat, String(caps.perChatUsd));
    settings.set(KV.perDay, String(caps.perDayUsd));
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.BUDGET_EVALUATE, (_e, raw) => {
    const { chatId } = schemas.budgetEvaluateRequest.parse(raw);
    const spend = querySpend(chatId);
    const caps = readCaps();
    return evaluateBudget({
      chatSpentUsd: spend.chatUsd,
      dailySpentUsd: spend.dayUsd,
      caps,
    });
  });

  // ---- @file mentions ----
  ipcMain.handle(CHANNELS.MENTIONS_RESOLVE, async (_e, raw) => {
    const { agentId, text } = schemas.mentionsResolveRequest.parse(raw);
    const paths = parseMentions(text);
    const agent = repo.getAgent(agentId);
    const files: MentionedFile[] = [];
    for (const p of paths) {
      files.push({ path: p, content: await safeReadInWorkspace(agent?.workspacePath, p) });
    }
    return { paths, contextBlock: buildContextBlock(files) };
  });

  // ---- Project conventions ----
  ipcMain.handle(CHANNELS.PROJECT_CONTEXT_LOAD, async (_e, raw) => {
    const { agentId } = schemas.projectContextLoadRequest.parse(raw);
    const agent = repo.getAgent(agentId);
    if (!agent?.workspacePath) return { files: [], preamble: '' };
    let present: string[] = [];
    try {
      const entries = await readdir(agent.workspacePath);
      present = entries.filter((e) => (CONVENTION_FILES as readonly string[]).includes(e));
    } catch {
      return { files: [], preamble: '' };
    }
    const picked = pickConventionFiles(present);
    const loaded: ConventionFile[] = [];
    for (const name of picked) {
      const content = await safeReadInWorkspace(agent.workspacePath, name);
      if (content !== null) loaded.push({ name, content });
    }
    return { files: loaded.map((f) => f.name), preamble: buildConventionPreamble(loaded) };
  });

  // ---- Token preflight ----
  ipcMain.handle(CHANNELS.PROMPT_PREFLIGHT, (_e, raw) => {
    const { text, contextChars, model } = schemas.promptPreflightRequest.parse(raw);
    const capTokens = model ? contextWindowFor(model) : 0;
    return preflightPrompt({ text, contextChars, capTokens });
  });

  // ---- Environment doctor ----
  ipcMain.handle(CHANNELS.ENV_DOCTOR_RUN, async () => {
    let modelsInstalled = 0;
    try {
      modelsInstalled = (await provider.listModels()).length;
    } catch {
      modelsInstalled = 0;
    }
    const cloudKeysConfigured = CLOUD_KEY_SETTINGS.filter(
      (k) => (settings.get(k) ?? '').trim().length > 0,
    ).length;
    const ollamaReachable = modelsInstalled > 0 || (await ollamaPing(provider));
    return runDoctor({
      ollamaReachable,
      modelsInstalled,
      cloudKeysConfigured,
      diskFreeGB: diskFreeGB(workspacesDir),
      workspacesWritable: isWritable(workspacesDir),
      gpuPresent: await hasNvidiaGpu(),
    });
  });

  // ---- Pinned chats ----
  ipcMain.handle(CHANNELS.PINS_LIST, () => ({ pinned: parsePins(settings.get(KV.pins)) }));

  ipcMain.handle(CHANNELS.PINS_TOGGLE, (_e, raw) => {
    const { chatId } = schemas.pinsToggleRequest.parse(raw);
    const next = togglePin(parsePins(settings.get(KV.pins)), chatId);
    settings.set(KV.pins, serializePins(next));
    return { pinned: next };
  });

  // ---- Prompt history ----
  ipcMain.handle(CHANNELS.PROMPT_HISTORY_GET, () => ({
    history: parseHistory(settings.get(KV.history)),
  }));

  ipcMain.handle(CHANNELS.PROMPT_HISTORY_PUSH, (_e, raw) => {
    const { entry } = schemas.promptHistoryPushRequest.parse(raw);
    const next = pushHistory(parseHistory(settings.get(KV.history)), entry);
    settings.set(KV.history, serializeHistory(next));
    return { history: next };
  });
}

// ---- helpers ----

function numOr(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

async function safeReadInWorkspace(
  workspacePath: string | undefined,
  relPath: string,
): Promise<string | null> {
  if (!workspacePath) return null;
  try {
    const full = resolveSafe(workspacePath, relPath); // throws if it escapes the sandbox
    const buf = await readFile(full);
    const text = buf.toString('utf8');
    return text.length > MAX_MENTION_BYTES ? text.slice(0, MAX_MENTION_BYTES) : text;
  } catch {
    return null;
  }
}

function diskFreeGB(dir: string): number | null {
  try {
    const s = statfsSync(dir);
    return (s.bsize * s.bavail) / 1024 ** 3;
  } catch {
    return null;
  }
}

function isWritable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function ollamaPing(provider: LLMProvider): Promise<boolean> {
  try {
    await provider.listModels();
    return true;
  } catch {
    return false;
  }
}

async function hasNvidiaGpu(): Promise<boolean> {
  try {
    const { detectHardware } = await import('@main/services/hardware-info');
    const hw = await detectHardware();
    return hw.gpus.some((g) => g.vendor === 'nvidia');
  } catch {
    return false;
  }
}
