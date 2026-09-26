import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseOllamaLibrary } from '@main/services/ollama-library';

// Shape of ollama.com/library as of 2026 (no x-test-* attributes).
const CARD = `
<ul>
<li  class="flex items-baseline border-b border-neutral-200 py-6">
  <a href="/library/qwen3" class="group w-full space-y-5">
    <div  title="qwen3" class="flex flex-col">
      <h2 class="truncate"><span class="group-hover:underline truncate">qwen3</span></h2>
      <p class="max-w-lg break-words text-neutral-800 text-md">Qwen3 is the latest generation &amp; family.</p>
    </div>
    <div class="flex flex-col space-y-2">
      <div class="flex flex-wrap space-x-2">
        <span  class="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 sm:text-[13px]">tools</span>
        <span  class="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600 sm:text-[13px]">thinking</span>
        <span  class="inline-flex items-center rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-500 sm:text-[13px]">cloud</span>
        <span  class="inline-flex items-center rounded-md bg-[#ddf4ff] px-2 py-0.5 text-xs font-medium text-blue-600 sm:text-[13px]">0.6b</span>
        <span  class="inline-flex items-center rounded-md bg-[#ddf4ff] px-2 py-0.5 text-xs font-medium text-blue-600 sm:text-[13px]">235b</span>
        <span  class="inline-flex items-center rounded-md bg-[#ddf4ff] px-2 py-0.5 text-xs font-medium text-blue-600 sm:text-[13px]">8x7b</span>
      </div>
      <p class="my-4 flex space-x-5 text-[13px] font-medium text-neutral-500">
        <span class="flex items-center"><svg><path d="M3"></path></svg>
          <span >38.1M</span>
          <span class="hidden sm:flex">&nbsp;Pulls</span>
        </span>
        <span class="flex items-center"><svg><path/></svg>
          <span >58</span>
          <span class="hidden sm:flex">&nbsp;Tags</span>
        </span>
        <span class="flex items-center" title="Oct 10, 2025"><svg><path/></svg>
          <span class="hidden sm:flex">Updated&nbsp;</span>
          <span >11 months ago</span>
        </span>
      </p>
    </div>
  </a>
</li>
</ul>`;

describe('parseOllamaLibrary', () => {
  it('reads badges and stats from the current (attribute-less) markup', () => {
    const [m] = parseOllamaLibrary(CARD);
    expect(m).toEqual({
      name: 'qwen3',
      description: 'Qwen3 is the latest generation & family.',
      pullCount: '38.1M',
      tagCount: 58,
      sizes: ['0.6b', '235b', '8x7b'],
      capabilities: ['tools', 'thinking', 'cloud'],
      updatedAt: '11 months ago',
    });
  });

  it('still understands the old x-test-* attributes', () => {
    const html = `<li><a href="/library/llama3"><p>Meta Llama 3</p><span x-test-capability>tools</span><span x-test-size>8b</span><span x-test-pull-count>9M</span><span x-test-tag-count>68</span><span x-test-updated>1 year ago</span></a></li>`;
    const [m] = parseOllamaLibrary(html);
    expect(m).toMatchObject({ name: 'llama3', sizes: ['8b'], capabilities: ['tools'], pullCount: '9M', tagCount: 68 });
  });

  // Optional check against a saved copy of the live page (not committed).
  const saved = process.env['OLLAMA_LIBRARY_HTML'];
  it.runIf(!!saved && existsSync(saved))('parses the live page with badges filled in', () => {
    const models = parseOllamaLibrary(readFileSync(saved!, 'utf8'));
    expect(models.length).toBeGreaterThan(50);
    expect(models.filter((m) => m.sizes.length > 0).length).toBeGreaterThan(40);
    expect(models.filter((m) => m.pullCount).length).toBeGreaterThan(50);
  });
});
