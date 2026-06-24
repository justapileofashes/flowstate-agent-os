import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';

export interface FakeProviderOptions {
  models?: LLMProviderModel[];
  reachable?: boolean;
  chatOnceResponses?: string[];
  onceHandler?: (opts: ChatOnceOpts) => Promise<string>;
}

export class FakeProvider implements LLMProvider {
  private cursor = 0;
  private onceCursor = 0;
  private readonly models: LLMProviderModel[];
  private readonly reachable: boolean;
  private readonly chatOnceResponses: string[];
  private readonly onceHandler?: (opts: ChatOnceOpts) => Promise<string>;

  constructor(
    private readonly script: ProviderDelta[],
    opts: FakeProviderOptions = {},
  ) {
    this.models = opts.models ?? [{ name: 'fake-model:1b' }];
    this.reachable = opts.reachable ?? true;
    this.chatOnceResponses = opts.chatOnceResponses ?? [];
    if (opts.onceHandler) this.onceHandler = opts.onceHandler;
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    if (opts.signal?.aborted) return;

    if (this.cursor >= this.script.length) {
      throw new Error('FakeProvider script exhausted');
    }

    while (this.cursor < this.script.length) {
      if (opts.signal?.aborted) return;
      const item = this.script[this.cursor]!;
      this.cursor += 1;
      yield item;
      if (item.type === 'done') return;
    }
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    if (this.onceHandler) {
      return { text: await this.onceHandler(opts) };
    }
    if (this.onceCursor >= this.chatOnceResponses.length) {
      throw new Error('FakeProvider chatOnce responses exhausted');
    }
    const text = this.chatOnceResponses[this.onceCursor]!;
    this.onceCursor += 1;
    return { text };
  }

  async listModels(): Promise<LLMProviderModel[]> {
    return this.models;
  }

  async isReachable(): Promise<boolean> {
    return this.reachable;
  }

  async *pullModel(_name: string): AsyncIterable<PullProgress> {
    yield { status: 'pulling manifest' };
    yield { status: 'pulling', total: 1000, completed: 500 };
    yield { status: 'pulling', total: 1000, completed: 1000 };
    yield { status: 'success' };
  }
}
