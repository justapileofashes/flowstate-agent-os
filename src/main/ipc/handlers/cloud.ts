import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { LLMProvider } from '@main/agent/llm-provider';

export interface CloudHandlerDeps {
  anthropic: LLMProvider;
  openai: LLMProvider;
  gemini: LLMProvider;
  perplexity: LLMProvider;
  groq: LLMProvider;
  mistral: LLMProvider;
  xai: LLMProvider;
}

export function registerCloudHandlers(deps: CloudHandlerDeps): void {
  ipcMain.handle(CHANNELS.CLOUD_TEST_CONNECTION, async (_e, raw) => {
    const { provider } = schemas.cloudTestConnectionRequest.parse(raw);
    const p = deps[provider];
    try {
      const models = await p.listModels();
      if (models.length === 0) {
        return {
          ok: false,
          models: 0,
          error: 'No models returned. Key may be missing or invalid.',
        };
      }
      return { ok: true, models: models.length };
    } catch (err) {
      return {
        ok: false,
        models: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
