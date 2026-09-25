// Opt-in Prometheus scrape endpoint, bound to 127.0.0.1 only:
//   GET /metrics  → text exposition     GET /healthz → {"ok":true,...}

import { createServer, type Server } from 'node:http';

export class MetricsServer {
  private server: Server | null = null;
  private port = 0;

  constructor(
    private readonly render: () => string,
    private readonly health: () => Record<string, unknown>,
  ) {}

  get listening(): number | null {
    return this.server ? this.port : null;
  }

  async ensure(port: number): Promise<void> {
    if (port === this.port && this.server) return;
    await this.stop();
    if (!port) return;
    const server = createServer((req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }).end(this.render());
      } else if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, ...this.health() }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.port = port;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.port = 0;
    if (s) await new Promise<void>((r) => s.close(() => r()));
  }
}
