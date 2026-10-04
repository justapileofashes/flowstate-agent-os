// Turn raw provider failures ("fetch failed", "Ollama chat HTTP 404") into
// something a user can act on. Used for chat turns, team runs and routines.

import { providerKindForModel } from './provider-router';

const UNREACHABLE = /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|connect ETIMEDOUT/i;

export function describeModelError(raw: string, model: string): string {
  const local = providerKindForModel(model) === 'ollama';
  if (local && UNREACHABLE.test(raw)) {
    return 'Ollama is offline — start it from the sidebar (Start Ollama), then try again.';
  }
  if (local && (/HTTP 404/.test(raw) || /model .*not found/i.test(raw))) {
    return `The model "${model}" isn't installed in Ollama. Pull it on the Models screen, or pick another model for this agent.`;
  }
  if (!local && UNREACHABLE.test(raw)) {
    return `Couldn't reach the provider for "${model}" — check your internet connection. (${raw})`;
  }
  return raw;
}
