// Real-server integration test for the flowclaw connectors. Unlike the unit
// tests (which inject a fake fetch), this boots an actual HTTP server speaking
// the Hermes/OpenClaw wire protocol and drives the connectors over real TCP
// using the DEFAULT global fetch — proving the connect + stream path works
// end-to-end without an external gateway running.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { HermesProvider } from '@main/agent/hermes-provider';
import { OpenClawClient } from '@main/agent/openclaw-client';
import { FlowclawConnections, type FlowclawConnection } from '@main/agent/flowclaw-connections';

let server: Server;
let base: string;
const seenAuth: string[] = [];

function handle(req: IncomingMessage, res: ServerResponse): void {
  seenAuth.push(req.headers['authorization'] ?? '');
  const url = req.url ?? '/';

  if (req.method === 'GET' && url.startsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'local-llama' }, { id: 'hermes-3' }] }));
    return;
  }

  if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (o: unknown): void => {
      res.write(`data: ${JSON.stringify(o)}\n\n`);
    };
    send({ choices: [{ delta: { content: 'Hello' } }] });
    send({ choices: [{ delta: { content: ' world' } }] });
    send({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } });
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // OpenClaw connection probe hits the gateway root.
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{}');
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('flowclaw integration (real HTTP server, global fetch)', () => {
  it('Hermes: lists models and streams a chat over real TCP', async () => {
    const p = new HermesProvider(() => 'live-key', base); // no injected fetch — real global fetch
    const models = await p.listModels();
    expect(models.map((m) => m.name)).toEqual(['local-llama', 'hermes-3']);

    const out: string[] = [];
    let usage: { promptTokens?: number; completionTokens?: number } | null = null;
    for await (const d of p.chatStream({ model: 'local-llama', messages: [{ role: 'user', content: 'hi' }], tools: [] })) {
      if (d.type === 'text') out.push(d.text);
      if (d.type === 'done') usage = d;
    }
    expect(out.join('')).toBe('Hello world');
    expect(usage).toMatchObject({ promptTokens: 4, completionTokens: 2 });
  });

  it('OpenClaw: connection probe succeeds and sends the bearer token', async () => {
    seenAuth.length = 0;
    const c = new OpenClawClient(() => 'gw-token', base);
    const res = await c.testConnection();
    expect(res.ok).toBe(true);
    expect(seenAuth.some((a) => a === 'Bearer gw-token')).toBe(true);
  });

  it('registry: testConnection works for both kinds against the live server', async () => {
    const conns: FlowclawConnection[] = [
      { id: 'h', kind: 'hermes', label: 'H', baseUrl: base, model: 'local-llama', enabled: true },
      { id: 'o', kind: 'openclaw', label: 'O', baseUrl: base, enabled: true },
    ];
    const reg = new FlowclawConnections({
      list: () => conns,
      get: (id) => conns.find((c) => c.id === id),
      getSecret: () => 'tok',
    });
    expect((await reg.testConnection('h')).ok).toBe(true);
    expect((await reg.testConnection('o')).ok).toBe(true);
  });
});
