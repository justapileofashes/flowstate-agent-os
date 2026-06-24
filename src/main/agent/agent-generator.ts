// Generates a full agent spec (name, description, system prompt, model
// choice, avatar color, tool perms, approval policy) from a one-line "use"
// description. Uses the planner model via the existing LLM provider.

import type { LLMProvider } from './llm-provider';

export interface GenerateAgentInput {
  /** Optional user-chosen name. If empty, the model picks one. */
  name?: string;
  /** Required: what the agent should do. */
  use: string;
}

export interface GeneratedAgentSpec {
  name: string;
  description: string;
  specialtyTags: string[];
  systemPrompt: string;
  model: string;
  avatarColor: string;
  toolPerms: { shell_enabled: boolean; delete_enabled: boolean };
  approvalPolicy: 'cautious' | 'trusting' | 'yolo';
}

interface AvailableModel {
  name: string;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_COLOR = '#d97757';
const FALLBACK_MODEL_PREFIXES = [
  'qwen2.5-coder:',
  'qwen2.5:',
  'qwen3-coder:',
  'qwen3:',
  'llama3.3:',
  'llama3.1:',
  'mistral-nemo:',
  'mistral-small:',
];

function pickFallbackModel(models: AvailableModel[]): string {
  for (const prefix of FALLBACK_MODEL_PREFIXES) {
    const m = models.find((x) => x.name.startsWith(prefix));
    if (m) return m.name;
  }
  return models[0]?.name ?? 'qwen2.5:7b';
}

function clamp(s: unknown, max: number, fallback: string): string {
  if (typeof s !== 'string') return fallback;
  const t = s.trim();
  if (t.length === 0) return fallback;
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

function buildPrompt(input: GenerateAgentInput, models: AvailableModel[]): string {
  const modelList = models.length > 0 ? models.map((m) => m.name).join(', ') : '(none listed)';
  const nameHint =
    input.name && input.name.trim().length > 0
      ? `The user wants this agent named: "${input.name.trim()}". Use that exact name.`
      : `The user did not pick a name — invent a concise 1–3 word name based on the use case.`;
  return `You are designing a specialist AI agent that will run locally on the user's machine via Ollama.

What the user wants the agent to do:
"""
${input.use.trim()}
"""

${nameHint}

Available local models: ${modelList}

Reply with valid JSON only — no markdown, no commentary. Schema:
{
  "name": "<1-3 word name>",
  "description": "<one-sentence summary, max 200 chars>",
  "specialty_tags": ["<tag>", "<tag>", "<tag>"],
  "system_prompt": "<full system prompt addressing the agent in second person, 200-1500 chars>",
  "model": "<must be one of the available local models>",
  "avatar_color": "<hex like #6dbf94 — pick something visually distinct, NOT orange>",
  "tool_perms": { "shell_enabled": <bool>, "delete_enabled": <bool> },
  "approval_policy": "cautious" | "trusting" | "yolo"
}

Rules:
- name: max 40 chars
- specialty_tags: 2 to 5 short lowercase tags, no spaces, hyphens allowed
- system_prompt: be specific about scope, tone, expected output style; include any guardrails relevant to the use case
- shell_enabled: true ONLY if the task clearly requires running shell commands
- delete_enabled: true ONLY if the agent must delete files as part of its core job
- approval_policy: "cautious" by default; "trusting" only if the agent is read-mostly; never "yolo"
- model: pick the BEST fit from the available list for this task`;
}

export class AgentGenerator {
  constructor(
    private readonly provider: LLMProvider,
    private readonly model: string,
  ) {}

  async generate(input: GenerateAgentInput): Promise<GeneratedAgentSpec> {
    if (!input.use || input.use.trim().length === 0) {
      throw new Error('Agent "use" description is required.');
    }
    let models: AvailableModel[] = [];
    try {
      models = await this.provider.listModels();
    } catch {
      models = [];
    }

    const prompt = buildPrompt(input, models);

    let response: { text: string };
    try {
      response = await this.provider.chatOnce({
        model: this.model,
        format: 'json',
        messages: [
          {
            role: 'system',
            content:
              'You design specialist AI agent specs. Output strictly JSON matching the schema requested by the user. No prose.',
          },
          { role: 'user', content: prompt },
        ],
      });
    } catch (err) {
      throw new Error(
        `Agent generator failed to call the local model: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text.trim());
    } catch {
      throw new Error('Agent generator returned invalid JSON. Try again.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Agent generator returned a non-object.');
    }
    const obj = parsed as Record<string, unknown>;

    // Name: prefer user-supplied (already validated non-empty); else model's.
    const userName = input.name?.trim();
    const name = clamp(
      userName && userName.length > 0 ? userName : obj['name'],
      40,
      'New Agent',
    );

    const description = clamp(obj['description'], 200, `Agent for ${input.use.slice(0, 80)}`);

    // Tags
    const rawTags = Array.isArray(obj['specialty_tags']) ? (obj['specialty_tags'] as unknown[]) : [];
    const specialtyTags = rawTags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
      .filter((t) => t.length > 0 && t.length <= 30)
      .slice(0, 5);
    if (specialtyTags.length === 0) specialtyTags.push('general');

    const systemPrompt = clamp(
      obj['system_prompt'],
      4000,
      `You are ${name}, a helpful assistant. The user wants you to: ${input.use.trim()}. Be concise, accurate, and stay focused on this purpose.`,
    );

    // Model — must be in installed list; else fallback
    const installedNames = new Set(models.map((m) => m.name));
    const modelCandidate = obj['model'];
    const model =
      typeof modelCandidate === 'string' && installedNames.has(modelCandidate)
        ? modelCandidate
        : pickFallbackModel(models);

    // Color — must be hex; else accent-adjacent palette pick
    const colorCandidate = obj['avatar_color'];
    const PALETTE = [
      '#6dbf94', '#7aa2f7', '#bb9af7', '#e0af68', '#f7768e',
      '#73c5cf', '#9ece6a', '#ff9e64', '#c678dd', '#56b6c2',
    ];
    const avatarColor =
      typeof colorCandidate === 'string' && HEX_COLOR_RE.test(colorCandidate)
        ? colorCandidate
        : (PALETTE[Math.floor(Math.random() * PALETTE.length)] ?? FALLBACK_COLOR);

    // Tool perms
    const tp = obj['tool_perms'];
    const toolPerms = {
      shell_enabled:
        typeof tp === 'object' && tp !== null && typeof (tp as Record<string, unknown>)['shell_enabled'] === 'boolean'
          ? ((tp as Record<string, unknown>)['shell_enabled'] as boolean)
          : false,
      delete_enabled:
        typeof tp === 'object' && tp !== null && typeof (tp as Record<string, unknown>)['delete_enabled'] === 'boolean'
          ? ((tp as Record<string, unknown>)['delete_enabled'] as boolean)
          : false,
    };

    // Approval policy — force 'cautious' if model picks 'yolo' (safety)
    const policyCandidate = obj['approval_policy'];
    const approvalPolicy: 'cautious' | 'trusting' | 'yolo' =
      policyCandidate === 'trusting'
        ? 'trusting'
        : policyCandidate === 'yolo'
          ? 'cautious' // override — never auto-grant yolo
          : 'cautious';

    return {
      name,
      description,
      specialtyTags,
      systemPrompt,
      model,
      avatarColor,
      toolPerms,
      approvalPolicy,
    };
  }
}
