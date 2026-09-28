import { describe, it, expect } from 'vitest';
import { AgentGenerator } from '@main/agent/agent-generator';
import type { LLMProvider } from '@main/agent/llm-provider';

const SPEC = JSON.stringify({
  name: 'CSV Wrangler',
  description: 'Parses CSV files',
  specialty_tags: ['csv', 'data'],
  system_prompt: 'You wrangle CSV files for the user, carefully and concisely.',
  model: 'qwen2.5:7b',
  avatar_color: '#6dbf94',
  tool_perms: { shell_enabled: false, delete_enabled: false },
  approval_policy: 'cautious',
});

function stubProvider(text: string, seenModels: string[]): LLMProvider {
  return {
    chatOnce: async (opts: { model: string }) => {
      seenModels.push(opts.model);
      return { text };
    },
    listModels: async () => [],
  } as unknown as LLMProvider;
}

describe('AgentGenerator — response parsing', () => {
  // Non-Ollama providers ignore "no prose" and wrap the object in a fence.
  it('accepts JSON wrapped in a ```json fence', async () => {
    const gen = new AgentGenerator(stubProvider('```json\n' + SPEC + '\n```', []), async () => 'm');
    await expect(gen.generate({ use: 'parse csv files' })).resolves.toMatchObject({
      name: 'CSV Wrangler',
    });
  });

  it('accepts a bare ``` fence', async () => {
    const gen = new AgentGenerator(stubProvider('```\n' + SPEC + '\n```', []), async () => 'm');
    await expect(gen.generate({ use: 'parse csv files' })).resolves.toMatchObject({
      name: 'CSV Wrangler',
    });
  });

  it('still rejects text that is not JSON at all', async () => {
    const gen = new AgentGenerator(stubProvider('sorry, I cannot', []), async () => 'm');
    await expect(gen.generate({ use: 'parse csv files' })).rejects.toThrow(/invalid JSON/);
  });
});

describe('AgentGenerator — model resolution', () => {
  // The orchestrator model is a setting; capturing it at startup means a
  // change only takes effect after a restart.
  it('resolves the model on every generate() call', async () => {
    const seenModels: string[] = [];
    let calls = 0;
    const gen = new AgentGenerator(stubProvider(SPEC, seenModels), async () => {
      calls += 1;
      return `model-${calls}`;
    });

    const spec = await gen.generate({ use: 'parse csv files' });
    expect(spec.name).toBe('CSV Wrangler');
    await gen.generate({ use: 'parse csv files' });

    expect(calls).toBe(2);
    expect(seenModels).toEqual(['model-1', 'model-2']);
  });
});
