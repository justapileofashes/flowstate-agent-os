// How capable is the model a feature will run on? Multi-agent planning
// (team runs, the Business agent, the AI Trader desk) needs a strong model;
// small local models produce plans that look fine and aren't. The UI uses
// this to recommend a cloud model where it matters.

import { providerKindForModel } from './provider-router';

export type ModelStrength = 'cloud' | 'local-large' | 'local-small';

/** Parameter count in billions from a tag like "qwen2.5:7b" / "llama3.1:70b-q4"
 *  / "mixtral:8x7b" (MoE counts total). Null when the name doesn't say. */
export function paramsB(model: string): number | null {
  const tag = model.toLowerCase().split(':')[1] ?? model.toLowerCase();
  const moe = /(\d+)x(\d+(?:\.\d+)?)b/.exec(tag);
  if (moe) return Number(moe[1]) * Number(moe[2]);
  const m = /(\d+(?:\.\d+)?)b\b/.exec(tag);
  return m ? Number(m[1]) : null;
}

/** Local models from 30B up handle planning acceptably. */
const LARGE_LOCAL_B = 30;

export function modelStrength(model: string): ModelStrength {
  if (!model) return 'local-small';
  if (providerKindForModel(model) !== 'ollama') return 'cloud';
  const lower = model.toLowerCase();
  // Ollama cloud models (e.g. "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud").
  if (lower.endsWith('-cloud') || lower.endsWith(':cloud')) return 'cloud';
  const b = paramsB(model);
  return b !== null && b >= LARGE_LOCAL_B ? 'local-large' : 'local-small';
}
