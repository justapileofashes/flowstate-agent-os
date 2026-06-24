import type { OllamaHealth } from '@shared/types';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class OllamaClient {
  constructor(
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly timeoutMs: number = 2000,
  ) {}

  async health(): Promise<OllamaHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.host}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          reachable: false,
          host: this.host,
          errorMessage: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as { version?: string };
      return {
        reachable: true,
        host: this.host,
        version: body.version,
      };
    } catch (err) {
      return {
        reachable: false,
        host: this.host,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
