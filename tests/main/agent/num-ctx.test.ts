import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider, pickNumCtx } from '@main/agent/ollama-provider';
import { buildSkillsBlock, SKILLS_BLOCK_TOKEN_BUDGET } from '@main/agent/skills-block';
import { estimateTokens } from '@main/services/token-estimate';

describe('pickNumCtx', () => {
  it('never goes below 8k (Ollama defaults to 4096 and truncates silently)', () => {
    expect(pickNumCtx('llama3.1:8b', 100)).toBe(8192);
  });

  it('grows in powers of two with a reply reserve', () => {
    expect(pickNumCtx('llama3.1:8b', 7000)).toBe(16384);
    expect(pickNumCtx('llama3.1:8b', 20_000)).toBe(32768);
  });

  it('is capped by maxCtx and by the model window', () => {
    expect(pickNumCtx('llama3.1:8b', 90_000)).toBe(32768);
    expect(pickNumCtx('llama3.1:8b', 90_000, 65536)).toBe(65536);
    expect(pickNumCtx('llama3:8b', 20_000)).toBe(8192); // llama3 is an 8k model
  });

  it('uses maxCtx for unknown models', () => {
    expect(pickNumCtx('some-custom-model', 50_000, 16384)).toBe(16384);
  });
});

describe('OllamaProvider sends num_ctx', () => {
  function doneStream(): Response {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(JSON.stringify({ message: { content: '' }, done: true }) + '\n'));
          c.close();
        },
      }),
      { status: 200 },
    );
  }

  it('chatStream sizes num_ctx to messages + tool schemas', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => doneStream());
    const p = new OllamaProvider('http://h', fetchMock);
    const bigTool = {
      name: 't',
      description: 'x'.repeat(40_000), // ~10k tokens of schema
      parameters: { type: 'object', properties: {} },
    };
    for await (const _ of p.chatStream({ model: 'llama3.1:8b', messages: [{ role: 'user', content: 'hi' }], tools: [bigTool] })) {
      // drain
    }
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(16384);
  });

  it('chatOnce sends num_ctx too', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: 'ok' } }), { status: 200 }),
    );
    const p = new OllamaProvider('http://h', fetchMock, () => 16384);
    await p.chatOnce({ model: 'qwen2.5:7b', messages: [{ role: 'user', content: 'hi' }] });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { options: { num_ctx: number } };
    expect(body.options.num_ctx).toBe(8192);
  });
});

describe('buildSkillsBlock', () => {
  it('is empty with no skills', () => {
    expect(buildSkillsBlock([])).toBe('');
  });

  it('lists skills one line each with short descriptions', () => {
    const out = buildSkillsBlock([{ name: 'pdf', description: 'Read\n\nand   write PDFs. '.repeat(20) }]);
    const line = out.split('\n').find((l) => l.startsWith('- **pdf**'))!;
    expect(line.length).toBeLessThan(130);
    expect(line).not.toContain('\n');
  });

  it('falls back to names only when many skills would blow the budget', () => {
    const skills = Array.from({ length: 300 }, (_, i) => ({ name: `skill-${i}`, description: 'd'.repeat(200) }));
    const out = buildSkillsBlock(skills);
    expect(out).toContain('Skill names: skill-0, skill-1');
    expect(estimateTokens(out)).toBeLessThan(SKILLS_BLOCK_TOKEN_BUDGET * 2);
  });
});
