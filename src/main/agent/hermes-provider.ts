// Hermes Agent (NousResearch) provider.
//
// Hermes exposes an OpenAI-compatible surface (`/v1/chat/completions`,
// `/v1/models`), so we reuse OpenAIProvider's streaming + model logic verbatim
// and only add the Hermes-specific bits:
//   - configurable base URL (the user's local/remote Hermes host)
//   - optional `X-Hermes-Session-Id` header for persistent session continuity
//   - no model-name filter (return every model the server reports, including
//     local models served via Ollama / an OpenAI-compatible local endpoint)
//   - API key optional (a local Hermes may run keyless)
//
// The exact base URL/port and whether a key is required come from the user's
// connection config; this class stays transport-only.

import { OpenAIProvider } from './openai-provider';

export interface HermesProviderOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Returns the current session id to send as `X-Hermes-Session-Id`, if any. */
  getSessionId?: () => string | undefined;
}

export class HermesProvider extends OpenAIProvider {
  constructor(getKey: () => string, baseUrl: string, opts: HermesProviderOpts = {}) {
    super(getKey, baseUrl, null, {
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      requireKey: false,
      extraHeaders: (): Record<string, string> => {
        const sid = opts.getSessionId?.();
        return sid ? { 'X-Hermes-Session-Id': sid } : {};
      },
    });
  }
}
