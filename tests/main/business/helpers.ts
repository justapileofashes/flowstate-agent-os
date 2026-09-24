// Shared fixtures for business-agent tests: temp SQLite DB with all
// migrations, a fake keychain for the vault, and a company factory.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase } from '@main/db/database';
import { BizDb } from '@main/business/db';
import { Vault, type KeyWrapper } from '@main/business/crypto/vault';
import { CredentialStore } from '@main/business/crypto/credentials';
import { companyConfigSchema, type CompanyConfigInput, type CompanyDto } from '@shared/business/types';
import { defaultAgentSeeds } from '@main/business/agent/roles';
import { BusinessAgentService } from '@main/business/service';
import { ScriptedLLM, auxReply, type FakeHandler } from './fake-llm';

export function fakeKeyWrapper(available = true): KeyWrapper & { wraps: number } {
  const w = {
    wraps: 0,
    isAvailable: () => available,
    wrap(dek: Buffer) {
      w.wraps += 1;
      return 'TESTWRAP:' + Buffer.from(dek.map((b) => b ^ 0x5a)).toString('base64');
    },
    unwrap(wrapped: string) {
      if (!wrapped.startsWith('TESTWRAP:')) throw new Error('bad wrap');
      return Buffer.from(Buffer.from(wrapped.slice(9), 'base64').map((b) => b ^ 0x5a));
    },
  };
  return w;
}

export interface TestEnv {
  dir: string;
  raw: Database;
  db: BizDb;
  vault: Vault;
  creds: CredentialStore;
  cleanup: () => void;
}

export function makeEnv(): TestEnv {
  const dir = mkdtempSync(join(tmpdir(), 'flowstate-biz-'));
  const raw = openDatabase(join(dir, 'test.sqlite'));
  const db = new BizDb(raw);
  const vault = new Vault(raw, fakeKeyWrapper());
  const creds = new CredentialStore(raw, vault);
  return {
    dir,
    raw,
    db,
    vault,
    creds,
    cleanup: () => {
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ── service-level fixtures ──────────────────────────────────────────────────

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type FetchRoute = (call: FetchCall) => Response | Promise<Response> | null;

/** Records every request; the first route that returns a Response wins. */
export class FakeFetch {
  readonly calls: FetchCall[] = [];
  private routes: FetchRoute[] = [];

  on(prefix: string, respond: (call: FetchCall) => Response | Promise<Response>): this {
    this.routes.push((c) => (c.url.startsWith(prefix) ? respond(c) : null));
    return this;
  }

  fn = async (input: string, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: FetchCall = {
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    this.calls.push(call);
    for (const r of this.routes) {
      const res = await r(call);
      if (res) return res;
    }
    return new Response('not found', { status: 404 });
  };

  to(prefix: string): FetchCall[] {
    return this.calls.filter((c) => c.url.startsWith(prefix));
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export class FakeClock {
  constructor(public t = new Date(2026, 8, 24, 8, 0, 0).getTime()) {}
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  set(d: Date): void {
    this.t = d.getTime();
  }
}

export function memorySettings(init: Record<string, string> = {}): { get(k: string): string | null; set(k: string, v: string): void; map: Map<string, string> } {
  const map = new Map(Object.entries(init));
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => void map.set(k, v) };
}

export interface ServiceEnv extends TestEnv {
  service: BusinessAgentService;
  llm: ScriptedLLM;
  http: FakeFetch;
  clock: FakeClock;
  settings: ReturnType<typeof memorySettings>;
  notifications: Array<{ title: string; body: string }>;
}

export async function makeServiceEnv(opts: { handler?: FakeHandler; settings?: Record<string, string> } = {}): Promise<ServiceEnv> {
  const base = makeEnv();
  const llm = new ScriptedLLM(opts.handler ?? ((r) => auxReply(r) ?? { text: 'ok' }));
  const http = new FakeFetch();
  const clock = new FakeClock();
  const settings = memorySettings(opts.settings ?? {});
  const notifications: Array<{ title: string; body: string }> = [];
  const service = new BusinessAgentService({
    raw: base.raw,
    provider: llm,
    settings,
    keyWrapper: fakeKeyWrapper(),
    fetch: http.fn,
    now: clock.now,
    resolve: async () => ['93.184.216.34'],
    desktopNotify: (title, body) => notifications.push({ title, body }),
    sleep: async () => undefined,
  });
  await service.init();
  return { ...base, vault: service.vault, creds: service.creds, db: service.db, service, llm, http, clock, settings, notifications };
}

export async function createCompany(env: ServiceEnv, over: Partial<CompanyConfigInput> = {}): Promise<CompanyDto> {
  const { company } = await env.service.handle('companies.create', {
    config: {
      name: 'Acme Analytics',
      niche: 'privacy-first web analytics',
      valueProp: 'Cookie-free analytics that respects visitors',
      icp: 'Indie SaaS founders with 1k-50k monthly visitors',
      brandVoice: 'plain, friendly, no hype',
      brandDonts: ['revolutionary', 'game-changer'],
      goals: ['Reach $1k MRR', 'Publish two useful posts per week'],
      ...over,
    },
  });
  return company;
}

export function makeCompany(env: TestEnv, over: Partial<CompanyConfigInput> = {}): CompanyDto {
  const config = companyConfigSchema.parse({
    name: 'Acme Analytics',
    niche: 'privacy-first web analytics',
    valueProp: 'Cookie-free analytics that respects visitors',
    icp: 'Indie SaaS founders with 1k-50k monthly visitors',
    brandVoice: 'plain, friendly, no hype',
    goals: ['Reach $1k MRR', 'Publish two useful posts per week'],
    ...over,
  });
  return env.db.companies.create(config, defaultAgentSeeds());
}
