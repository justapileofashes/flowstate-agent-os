// BusinessAgentService — the feature's composition root and API surface.
// Wires repos, vault, gateway, skills, gate, kaizen, runner, scheduler and
// notifier over one SQLite handle, and implements every RPC method. Every
// mutating method writes an audit row (params scrubbed of secrets).
// No electron imports: the IPC handler injects keychain, notifications and
// broadcast so this whole service runs under vitest.

import type { Database } from 'better-sqlite3';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { McpManager } from '@main/services/mcp-manager';
import {
  MODEL_ALIASES,
  ROLE_KEYS,
  type CompanyDto,
  type DashboardDto,
  type FeedEventDto,
  type IntegrationDto,
  type RoleKey,
  type UsageSummaryDto,
} from '@shared/business/types';
import type { BizEvent, BizMethod, BizParsed, BizResponses, RoleMetaDto } from '@shared/business/api';
import { bizRequestSchemas } from '@shared/business/api';
import { BizDb } from './db';
import { toPendingDto } from './db/approvals';
import { localDate, startOfDay, startOfMonth } from './db/util';
import { Vault, type KeyWrapper } from './crypto/vault';
import { CredentialStore } from './crypto/credentials';
import { ModelGateway } from './providers/gateway';
import { hashEmbedder, ollamaEmbedder, openaiEmbedder, type Embedder } from './memory/embeddings';
import { KnowledgeService } from './memory/knowledge';
import { Kaizen } from './memory/kaizen';
import { buildRegistry, INTEGRATIONS } from './skills';
import type { Resolver } from './skills/web';
import type { FetchFn, SkillContext } from './skills/types';
import type { SkillRegistry } from './skills/registry';
import { ActionGate } from './guardrails/approval';
import { scrubValue } from './guardrails/scrub';
import { constitutionRows } from './guardrails/constitution';
import { CycleRunner } from './agent/orchestrator';
import { defaultAgentSeeds, ROLES } from './agent/roles';
import { Scheduler, monthKey } from './scheduler/scheduler';
import { Notifier } from './notifications';
import { computeAlerts } from './observability/alerts';
import { buildReplay } from './observability/replay';
import { readLegacyBusiness } from './legacy-import';
import { BIZ_SETTINGS, BUSINESS_AGENT_VERSION, LIMITS } from './config';
import { isValidCron } from '@main/util/cron';

export interface ServiceDeps {
  raw: Database;
  provider: LLMProvider;
  settings: { get(key: string): string | null; set(key: string, value: string): void };
  keyWrapper: KeyWrapper;
  fetch?: FetchFn;
  mcp?: Pick<McpManager, 'toolSpecs' | 'callTool'>;
  ollamaHost?: () => string;
  openaiKey?: () => string;
  desktopNotify?: (title: string, body: string) => void;
  broadcast?: (ev: BizEvent) => void;
  /** App-wide cost meter (Settings → usage). */
  recordGlobalUsage?: (row: { chatId: string; agentId: string; model: string; promptTokens: number; completionTokens: number }) => void;
  legacyDir?: string;
  now?: () => number;
  resolve?: Resolver;
  limits?: { cycleWallClockMs?: number; runWallClockMs?: number };
  sleep?: (ms: number) => Promise<void>;
}

const MUTATING = new Set<BizMethod>([
  'setEnabled',
  'companies.create',
  'companies.updateConfig',
  'companies.setStatus',
  'companies.delete',
  'cycles.trigger',
  'cycles.abort',
  'agents.update',
  'agents.runRole',
  'runs.retry',
  'tasks.create',
  'tasks.update',
  'tasks.delete',
  'approvals.approve',
  'approvals.reject',
  'knowledge.add',
  'knowledge.delete',
  'rules.setStatus',
  'rules.delete',
  'constraints.add',
  'constraints.delete',
  'credentials.save',
  'credentials.delete',
  'budgets.addCredits',
  'drafts.update',
  'leads.setStatus',
  'tickets.add',
  'tickets.update',
  'vault.rotate',
]);

export class BusinessAgentService {
  readonly db: BizDb;
  readonly vault: Vault;
  readonly creds: CredentialStore;
  readonly registry: SkillRegistry;
  readonly knowledge: KnowledgeService;
  readonly gateway: ModelGateway;
  readonly gate: ActionGate;
  readonly kaizen: Kaizen;
  readonly runner: CycleRunner;
  readonly scheduler: Scheduler;
  readonly notifier: Notifier;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private defaultModel = '';

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.db = new BizDb(deps.raw);
    this.vault = new Vault(deps.raw, deps.keyWrapper);
    this.creds = new CredentialStore(deps.raw, this.vault);
    this.registry = buildRegistry({ ...(deps.mcp ? { mcp: deps.mcp } : {}), ...(deps.resolve ? { resolve: deps.resolve } : {}) });
    this.knowledge = new KnowledgeService(this.db, (companyId) => this.embedderFor(companyId));
    this.gateway = new ModelGateway({
      provider: deps.provider,
      resolveModel: (companyId, alias) => this.db.companies.get(companyId)?.config.models[alias] ?? '',
      fallbackModels: () => this.fallbackModels(),
      onUsage: (e) => {
        this.db.billing.recordUsage(e, this.now());
        if (e.ok) {
          deps.recordGlobalUsage?.({
            chatId: `business:${e.companyId}`,
            agentId: `business:${e.role ?? 'agent'}`,
            model: e.model,
            promptTokens: e.inputTokens,
            completionTokens: e.outputTokens,
          });
        }
      },
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      now: this.now,
    });
    this.kaizen = new Kaizen({
      db: this.db,
      gateway: this.gateway,
      feed: (e) => this.feed(e),
      onSpend: (companyId, credits) => {
        if (credits > 0) this.db.billing.entry({ companyId, delta: -credits, reason: 'cycle_spend', refType: 'kaizen', refId: null, now: this.now() });
      },
      now: this.now,
    });
    this.gate = new ActionGate({
      db: this.db,
      vault: this.vault,
      registry: this.registry,
      makeContext: (input) => this.makeContext(input),
      feed: (e) => this.feed(e),
      onRejected: (action, reason) => this.kaizen.onRejected(action, reason),
      onLearn: (companyId, proposals, ref) => this.kaizen.onLearn(companyId, proposals, ref),
      now: this.now,
    });
    this.notifier = new Notifier({
      db: this.db,
      credentials: this.creds,
      fetch: this.fetchFn,
      ...(deps.desktopNotify ? { desktop: deps.desktopNotify } : {}),
      now: this.now,
    });
    this.runner = new CycleRunner({
      db: this.db,
      gateway: this.gateway,
      gate: this.gate,
      registry: this.registry,
      knowledge: this.knowledge,
      kaizen: this.kaizen,
      makeContext: (input) => this.makeContext(input),
      feed: (e) => this.feed(e),
      notify: (companyId, n) => this.notifier.notify(companyId, n),
      now: this.now,
      ...(deps.limits ? { limits: deps.limits } : {}),
    });
    this.scheduler = new Scheduler({
      db: this.db,
      runner: this.runner,
      gate: this.gate,
      enabled: () => this.enabled(),
      grantMonthly: (companyId, at) => this.grantMonthly(companyId, at),
      onSkip: (companyId, text) => this.feed({ companyId, cycleId: null, runId: null, role: 'ceo', kind: 'phase', text }),
      now: this.now,
    });
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.db.runs.recoverInterrupted(this.now());
    try {
      this.defaultModel = (await this.deps.provider.listModels())[0]?.name ?? '';
    } catch {
      this.defaultModel = '';
    }
    this.importLegacy();
    for (const c of this.db.companies.list(true)) {
      this.db.companies.ensureAgents(c.id, defaultAgentSeeds(), this.now());
      this.grantMonthly(c.id, this.now());
    }
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
    this.runner.abortAll();
  }

  enabled(): boolean {
    return this.deps.settings.get(BIZ_SETTINGS.enabled) !== '0';
  }

  private fallbackModels(): string[] {
    const chain = (this.deps.settings.get('model_fallback_chain') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...chain, this.deps.settings.get('orchestrator_model') ?? '', this.defaultModel].filter(Boolean);
  }

  private embedderFor(companyId: string): Embedder {
    const model = this.db.companies.get(companyId)?.config.models.embed.trim() ?? '';
    if (!model) return hashEmbedder();
    if (model.startsWith('text-embedding')) return openaiEmbedder(this.deps.openaiKey ?? (() => ''), model, this.fetchFn);
    return ollamaEmbedder(this.deps.ollamaHost?.() ?? 'http://localhost:11434', model, this.fetchFn);
  }

  makeContext(input: {
    companyId: string;
    role: RoleKey;
    runId: string | null;
    cycleId: string | null;
    taskId: string | null;
    signal?: AbortSignal;
  }): SkillContext {
    const company = this.db.companies.get(input.companyId);
    if (!company) throw new Error('unknown company');
    return {
      companyId: input.companyId,
      company,
      role: input.role,
      runId: input.runId,
      cycleId: input.cycleId,
      taskId: input.taskId,
      db: this.db,
      credentials: {
        has: (p) => Boolean(this.creds.has(input.companyId, p)),
        resolve: (p) => this.creds.resolve(input.companyId, p, this.now()),
      },
      fetch: this.fetchFn,
      gateway: this.gateway,
      knowledge: this.knowledge,
      now: this.now,
      ...(input.signal ? { signal: input.signal } : {}),
    };
  }

  feed(e: Omit<FeedEventDto, 'id' | 'ts'>): FeedEventDto {
    const ev = this.db.ops.pushFeed({ ...e, ts: this.now() }, LIMITS.feedCapPerCompany);
    this.deps.broadcast?.({ type: 'feed', event: ev });
    return ev;
  }

  private changed(companyId: string, what: Extract<BizEvent, { type: 'changed' }>['what']): void {
    this.deps.broadcast?.({ type: 'changed', companyId, what });
  }

  grantMonthly(companyId: string, at: number): void {
    const company = this.db.companies.get(companyId);
    if (!company) return;
    const key = monthKey(at);
    if (this.db.billing.hasEntry(companyId, 'grant_monthly', key)) return;
    this.db.billing.entry({
      companyId,
      delta: company.config.budgets.monthlyCredits,
      reason: 'grant_monthly',
      refType: 'month',
      refId: key,
      note: `monthly allowance ${key}`,
      now: this.now(),
    });
  }

  private importLegacy(): void {
    if (!this.deps.legacyDir || this.deps.settings.get(BIZ_SETTINGS.legacyImported) === '1') return;
    this.deps.settings.set(BIZ_SETTINGS.legacyImported, '1');
    if (this.db.companies.list(true).length) return;
    const legacy = readLegacyBusiness(this.deps.legacyDir);
    if (!legacy) return;
    const company = this.db.companies.create(legacy.config, defaultAgentSeeds(), { editedBy: 'system', note: 'imported from the previous Business autopilot', now: this.now() });
    if (legacy.memory) {
      void this.knowledge.add(company.id, { content: legacy.memory.slice(0, 8_000), category: 'note', source: 'previous autopilot memory', confidence: 0.5 });
    }
    this.db.ops.audit({ companyId: company.id, actorType: 'system', actorId: 'migration', action: 'company.imported', resourceType: 'company', resourceId: company.id, now: this.now() });
  }

  // ── RPC dispatch ────────────────────────────────────────────────────────

  async handle<M extends BizMethod>(method: M, rawParams: unknown): Promise<BizResponses[M]> {
    const schema = bizRequestSchemas[method];
    if (!schema) throw new Error(`unknown method ${String(method)}`);
    const params = schema.parse(rawParams ?? {}) as BizParsed<M>;
    const result = (await this.dispatch(method, params)) as BizResponses[M];
    if (MUTATING.has(method)) {
      const p = params as Record<string, unknown>;
      const companyId = typeof p['companyId'] === 'string' ? (p['companyId'] as string) : null;
      const resourceId =
        (['actionId', 'taskId', 'ruleId', 'credentialId', 'agentId', 'runId', 'draftId', 'leadId', 'ticketId', 'id'] as const)
          .map((k) => p[k])
          .find((v): v is string => typeof v === 'string') ?? null;
      const { secret: _s, ...rest } = p;
      this.db.ops.audit({
        companyId: companyId && this.db.companies.get(companyId) ? companyId : null,
        actorType: 'user',
        actorId: 'owner',
        action: method,
        resourceType: method.split('.')[0] ?? method,
        resourceId,
        metadata: scrubValue(rest) as Record<string, unknown>,
        now: this.now(),
      });
    }
    return result;
  }

  private requireCompany(companyId: string): CompanyDto {
    const c = this.db.companies.get(companyId);
    if (!c) throw new Error('unknown company');
    return c;
  }

  private async dispatch(method: BizMethod, p: any): Promise<unknown> {  
    const db = this.db;
    switch (method) {
      case 'status':
        return {
          enabled: this.enabled(),
          runningCompanies: db.companies.list().filter((c) => this.runner.isRunning(c.id)).map((c) => c.id),
          version: BUSINESS_AGENT_VERSION,
          vaultAvailable: this.vault.available(),
        };
      case 'setEnabled':
        this.deps.settings.set(BIZ_SETTINGS.enabled, p.enabled ? '1' : '0');
        if (!p.enabled) this.runner.abortAll();
        return { enabled: this.enabled() };

      // ── companies ──
      case 'companies.list':
        return { companies: db.companies.list(Boolean(p.includeArchived)) };
      case 'companies.create': {
        const company = db.companies.create(p.config, defaultAgentSeeds(), { now: this.now() });
        this.grantMonthly(company.id, this.now());
        if (p.initialCredits) {
          db.billing.entry({ companyId: company.id, delta: p.initialCredits, reason: 'grant_manual', note: 'initial credits', now: this.now() });
        }
        this.feed({ companyId: company.id, cycleId: null, runId: null, role: 'ceo', kind: 'phase', text: `Company created — ${company.config.validation.required ? 'validate-before-build is on' : 'ready'}` });
        return { company };
      }
      case 'companies.dashboard':
        return this.dashboard(p.companyId);
      case 'companies.updateConfig': {
        this.requireCompany(p.companyId);
        const company = db.companies.updateConfig(p.companyId, p.config, 'user', p.note ?? 'edited in settings', this.now());
        this.changed(p.companyId, 'company');
        return { company };
      }
      case 'companies.configHistory':
        return { versions: db.companies.history(p.companyId) };
      case 'companies.setStatus': {
        this.requireCompany(p.companyId);
        db.companies.setStatus(p.companyId, p.status, this.now());
        if (p.status !== 'active') this.runner.abort(p.companyId);
        this.changed(p.companyId, 'company');
        return { company: db.companies.get(p.companyId)! };
      }
      case 'companies.delete': {
        const c = this.requireCompany(p.companyId);
        if (p.confirmName.trim() !== c.name) return { ok: false, error: 'type the company name to confirm' };
        this.runner.abort(p.companyId);
        db.ops.deleteCronForCompany(p.companyId);
        db.companies.delete(p.companyId);
        return { ok: true };
      }
      case 'companies.export':
        // Handled by the IPC layer (save dialog); the service provides data.
        return { ok: false, error: 'export is handled by the IPC layer' };

      // ── cycles ──
      case 'cycles.estimate': {
        const c = this.requireCompany(p.companyId);
        const v = this.runner.budgetVerdict(c);
        const recent = db.runs.listCycles(p.companyId, 10).filter((x) => x.status !== 'running' && x.kind !== 'evening' && x.creditsSpent > 0);
        return {
          creditsCap: Math.min(c.config.budgets.cycleCredits, Math.max(0, v.balance)),
          usdCap: c.config.budgets.cycleUsd,
          avgRecentCredits: recent.length ? recent.reduce((s, x) => s + x.creditsSpent, 0) / recent.length : 0,
          balance: v.balance,
          monthSpent: v.monthSpent,
          monthlyCredits: c.config.budgets.monthlyCredits,
          verdict: v.level,
          message: v.message,
          running: this.runner.isRunning(p.companyId),
        };
      }
      case 'cycles.trigger': {
        if (!this.enabled()) return { error: 'The business agent is switched off (emergency stop). Turn it back on in Settings.' };
        const r = this.runner.begin(p.companyId, p.kind, 'manual');
        if ('error' in r) return { error: r.error };
        void r.done.then(() => this.changed(p.companyId, 'cycles')).catch(() => undefined);
        this.changed(p.companyId, 'cycles');
        return { cycle: r.cycle, alreadyRunning: r.alreadyRunning };
      }
      case 'cycles.abort':
        return { ok: this.runner.abort(p.companyId) };
      case 'cycles.list':
        return { cycles: db.runs.listCycles(p.companyId, p.limit ?? 60) };
      case 'cycles.get': {
        const cycle = db.runs.getCycle(p.cycleId, p.companyId);
        return {
          cycle,
          runs: cycle ? db.runs.runsForCycle(cycle.id) : [],
          tasks: cycle ? db.work.listTasks(p.companyId, { limit: 500 }).filter((t) => t.cycleId === cycle.id) : [],
        };
      }

      // ── agents ──
      case 'agents.list':
        return { agents: db.companies.agentConfigs(p.companyId), roles: this.roleMeta() };
      case 'agents.update': {
        if (p.scheduleCron !== undefined && p.scheduleCron.trim() && !isValidCron(p.scheduleCron)) {
          return { agent: null, error: 'schedule must be a 5-field cron expression, e.g. "0 */3 * * *"' };
        }
        const { companyId, agentId, ...patch } = p;
        const agent = db.companies.updateAgentConfig(companyId, agentId, patch, this.now());
        this.changed(companyId, 'company');
        return { agent };
      }
      case 'agents.runRole': {
        if (!this.enabled()) return { error: 'The business agent is switched off (emergency stop).' };
        const r = this.runner.begin(p.companyId, 'role', 'manual', { role: p.role });
        if ('error' in r) return { error: r.error };
        void r.done.then(() => this.changed(p.companyId, 'cycles')).catch(() => undefined);
        return { cycle: r.cycle, alreadyRunning: r.alreadyRunning };
      }

      // ── runs ──
      case 'runs.list':
        return { runs: db.runs.listRuns({ companyId: p.companyId, ...(p.role ? { role: p.role } : {}), ...(p.status ? { status: p.status } : {}), limit: p.limit ?? 100 }) };
      case 'runs.get': {
        const run = db.runs.getRun(p.runId, p.companyId);
        return { run, steps: run ? db.runs.steps(run.id) : [] };
      }
      case 'runs.replay': {
        const run = db.runs.getRun(p.runId, p.companyId);
        if (!run) return { error: 'unknown run' };
        return buildReplay(run, db.runs.steps(run.id), p.uptoSeq);
      }
      case 'runs.retry': {
        if (!this.enabled()) return { error: 'The business agent is switched off (emergency stop).' };
        const run = db.runs.getRun(p.runId, p.companyId);
        if (!run) return { error: 'unknown run' };
        if (run.role === 'ceo') return { error: 'retry a role run; to re-plan, trigger a new cycle' };
        const r = this.runner.begin(p.companyId, 'role', 'retry', {
          role: run.role,
          retryOf: { runId: run.id, ...(p.fromSeq !== undefined ? { fromSeq: p.fromSeq } : {}) },
        });
        if ('error' in r) return { error: r.error };
        return { cycle: r.cycle };
      }

      // ── tasks ──
      case 'tasks.list':
        return { tasks: db.work.listTasks(p.companyId, { limit: 500 }) };
      case 'tasks.create': {
        this.requireCompany(p.companyId);
        const task = db.work.createTask({
          companyId: p.companyId,
          title: p.title,
          description: p.description ?? '',
          assignedRole: p.role,
          priority: p.priority ?? 2,
          status: 'todo',
          source: 'human',
          riskLevel: p.riskLevel ?? 'low',
          estimatedCredits: p.estimatedCredits ?? 20,
          now: this.now(),
        });
        this.changed(p.companyId, 'tasks');
        return { task };
      }
      case 'tasks.update': {
        const { companyId, taskId, ...patch } = p;
        const task = db.work.updateTask(companyId, taskId, { ...patch, ...(patch.status === 'done' ? { completedAt: this.now() } : {}) }, this.now());
        this.changed(companyId, 'tasks');
        return { task };
      }
      case 'tasks.delete':
        db.work.deleteTask(p.companyId, p.taskId);
        this.changed(p.companyId, 'tasks');
        return { ok: true };

      // ── approvals ──
      case 'approvals.list': {
        const statuses =
          p.status === 'pending' ? (['pending'] as const) : p.status === 'resolved' ? (['approved', 'executing', 'executed', 'failed', 'rejected', 'expired'] as const) : undefined;
        return {
          actions: db.approvals
            .list({ companyId: p.companyId, ...(statuses ? { statuses: [...statuses] } : {}), limit: 300 })
            .map(toPendingDto),
        };
      }
      case 'approvals.get':
        return { action: this.gate.detail(p.companyId, p.actionId) };
      case 'approvals.approve': {
        const res = await this.gate.approve(p.companyId, p.actionId, { ...(p.note ? { note: p.note } : {}), actor: 'owner' });
        this.changed(p.companyId, 'approvals');
        return res;
      }
      case 'approvals.reject': {
        const res = this.gate.reject(p.companyId, p.actionId, p.reason, 'owner');
        this.changed(p.companyId, 'approvals');
        return res;
      }

      // ── knowledge ──
      case 'knowledge.list': {
        const memories = p.query?.trim()
          ? await this.knowledge.search(p.companyId, p.query, { k: 50, minScore: 0.02 })
          : this.knowledge.list(p.companyId, 300);
        return {
          memories,
          rules: db.knowledge.rules(p.companyId),
          constraints: [...constitutionRows(), ...db.knowledge.constraints(p.companyId)],
        };
      }
      case 'knowledge.add': {
        const memory = await this.knowledge.add(p.companyId, { content: p.content, category: p.category, source: 'owner', confidence: 0.9 });
        this.changed(p.companyId, 'knowledge');
        return { memory };
      }
      case 'knowledge.delete':
        return { ok: db.knowledge.delete(p.companyId, p.id) };
      case 'rules.setStatus': {
        const rule = db.knowledge.setRuleStatus(p.companyId, p.ruleId, p.status, this.now());
        this.changed(p.companyId, 'knowledge');
        return { rule };
      }
      case 'rules.delete':
        return { ok: db.knowledge.deleteRule(p.companyId, p.ruleId) };
      case 'constraints.add':
        return { constraint: db.knowledge.addConstraint(p.companyId, p.rule, this.now()) };
      case 'constraints.delete':
        return { ok: db.knowledge.deleteConstraint(p.companyId, p.id) };

      // ── credentials ──
      case 'credentials.list':
        return { credentials: this.creds.list(p.companyId) };
      case 'credentials.save': {
        this.requireCompany(p.companyId);
        if (!INTEGRATIONS.some((i) => i.provider === p.provider)) return { error: `unknown provider ${p.provider}` };
        try {
          const credential = this.creds.save({
            companyId: p.shared ? null : p.companyId,
            provider: p.provider,
            label: p.label ?? '',
            secret: p.secret,
            meta: p.meta ?? {},
            now: this.now(),
          });
          this.changed(p.companyId, 'company');
          return { credential };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'credentials.delete':
        return { ok: this.creds.revoke(p.companyId, p.credentialId) };
      case 'credentials.test':
        return this.testCredential(p.companyId, p.provider);
      case 'integrations.list':
        return { integrations: this.integrations(p.companyId) };

      // ── usage + budgets ──
      case 'usage.summary':
        return this.usageSummary(p.companyId, p.days ?? 30);
      case 'budgets.addCredits': {
        this.requireCompany(p.companyId);
        const entry = db.billing.entry({ companyId: p.companyId, delta: p.credits, reason: 'grant_manual', note: p.note ?? 'credits added', now: this.now() });
        this.changed(p.companyId, 'company');
        return { balance: entry.balanceAfter };
      }

      // ── outputs ──
      case 'drafts.list':
        return { drafts: db.work.listDrafts(p.companyId, { limit: 300, ...(p.status ? { status: p.status } : {}) }) };
      case 'drafts.update': {
        const { companyId, draftId, ...patch } = p;
        return { draft: db.work.updateDraft(companyId, draftId, patch, this.now()) };
      }
      case 'leads.list':
        return { leads: db.work.listLeads(p.companyId) };
      case 'leads.setStatus':
        db.work.setLeadStatus(p.companyId, p.leadId, p.status);
        return { ok: true };
      case 'tickets.list':
        return { tickets: db.work.listTickets(p.companyId, { limit: 300 }) };
      case 'tickets.add':
        return {
          ticket: db.work.createTicket({
            companyId: p.companyId,
            subject: p.subject,
            body: p.body ?? '',
            customer: p.customer ?? '',
            priority: p.priority ?? 'normal',
            now: this.now(),
          }),
        };
      case 'tickets.update':
        return { ticket: db.work.updateTicket(p.companyId, p.ticketId, { ...(p.status ? { status: p.status } : {}) }, this.now()) };

      // ── chat ──
      case 'chat.sessions':
        return { sessions: db.ops.chatSessions(p.companyId) };
      case 'chat.messages': {
        const s = db.ops.chatSession(p.companyId, p.sessionId);
        return { messages: s ? db.ops.chatMessages(s.id) : [] };
      }
      case 'chat.send':
        if (!this.enabled()) throw new Error('The business agent is switched off (emergency stop).');
        return this.runner.chat(p.companyId, p.sessionId ?? null, p.message);

      // ── observability ──
      case 'feed.list':
        return { events: db.ops.feed(p.companyId, p.limit ?? 300) };
      case 'alerts.list':
        return { alerts: computeAlerts(db, this.requireCompany(p.companyId), this.now()) };
      case 'audit.list':
        return { entries: db.ops.auditLog(p.companyId, 300) };
      case 'models.list': {
        let models: string[] = [];
        try {
          models = (await this.deps.provider.listModels()).map((m) => m.name);
        } catch {
          models = [];
        }
        return { models, defaultModel: this.fallbackModels()[0] ?? this.defaultModel };
      }
      case 'models.health':
        return { aliases: this.gateway.health(p.companyId, MODEL_ALIASES) };
      case 'mcp.tools':
        return { tools: (this.deps.mcp?.toolSpecs() ?? []).map((t) => ({ name: t.name, description: t.description.slice(0, 300) })) };
      case 'vault.rotate': {
        let credentials = 0;
        let actions = 0;
        const keyId = this.vault.rotate((convert) => {
          credentials = this.creds.reencryptAll(convert);
          for (const a of db.approvals.allArgs()) {
            if (a.argsEnc.startsWith('plain:')) continue;
            db.approvals.setArgs(a.id, convert(a.argsEnc));
            actions += 1;
          }
        });
        return { keyId, credentials, actions };
      }
      default:
        throw new Error(`unhandled method ${String(method)}`);
    }
  }

  // ── read models ─────────────────────────────────────────────────────────

  roleMeta(): RoleMetaDto[] {
    return ROLE_KEYS.map((k) => ({
      key: k,
      label: ROLES[k].label,
      glyph: ROLES[k].glyph,
      responsibility: ROLES[k].responsibility,
      skills: ROLES[k].skills,
      buildsProduct: ROLES[k].buildsProduct,
    }));
  }

  dashboard(companyId: string): DashboardDto {
    const company = this.requireCompany(companyId);
    const db = this.db;
    const last = db.runs.lastCycle(companyId, { withSummary: true });
    return {
      company,
      running: db.runs.runningCycle(companyId),
      lastCycle: db.runs.lastCycle(companyId),
      lastSummary: last?.summary ? { cycleId: last.id, kind: last.kind, text: last.summary, at: last.endedAt ?? last.startedAt } : null,
      pendingApprovals: db.approvals.countPending(companyId),
      openTasks: db.work.countTasks(companyId, ['backlog', 'todo', 'in_progress', 'awaiting_approval']),
      kpis: db.work.latestKpis(companyId),
      balance: db.billing.balance(companyId),
      monthSpentCredits: db.billing.monthSpent(companyId, this.now()),
      alerts: computeAlerts(db, company, this.now()),
      agents: db.companies.agentConfigs(companyId),
      validation: company.config.validation,
      nextRuns: this.enabled() ? this.scheduler.nextRuns(companyId) : [],
    };
  }

  integrations(companyId: string): IntegrationDto[] {
    return INTEGRATIONS.map((i) => {
      const cred = this.creds.has(companyId, i.provider);
      return {
        provider: i.provider,
        label: i.label,
        purpose: i.purpose,
        skills: this.registry
          .all()
          .filter((s) => s.providers?.includes(i.provider) || (i.provider === 'tavily' && s.key === 'web.search') || (i.provider === 'firecrawl' && s.key === 'web.browse'))
          .map((s) => s.key),
        connected: Boolean(cred),
        credentialId: cred?.id ?? null,
        fingerprint: cred?.fingerprint ?? null,
        metaFields: i.metaFields,
        docsUrl: i.docsUrl,
      };
    });
  }

  usageSummary(companyId: string, days: number): UsageSummaryDto {
    const company = this.requireCompany(companyId);
    const now = this.now();
    const since = startOfDay(now) - (days - 1) * 86_400_000;
    const events = this.db.billing.usageSince(companyId, since);
    const byRole = new Map<string, { credits: number; usd: number; calls: number }>();
    const byModel = new Map<string, { credits: number; usd: number; calls: number; errors: number }>();
    const daily = new Map<string, { credits: number; usd: number }>();
    for (const e of events) {
      const r = byRole.get(e.role ?? 'other') ?? { credits: 0, usd: 0, calls: 0 };
      r.credits += e.credits;
      r.usd += e.costUsd;
      r.calls += 1;
      byRole.set(e.role ?? 'other', r);
      const m = byModel.get(e.model) ?? { credits: 0, usd: 0, calls: 0, errors: 0 };
      m.credits += e.credits;
      m.usd += e.costUsd;
      m.calls += 1;
      if (!e.ok) m.errors += 1;
      byModel.set(e.model, m);
      const day = localDate(e.createdAt);
      const d = daily.get(day) ?? { credits: 0, usd: 0 };
      d.credits += e.credits;
      d.usd += e.costUsd;
      daily.set(day, d);
    }
    const days30: Array<{ day: string; credits: number; usd: number }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const day = localDate(startOfDay(now) - i * 86_400_000 + 12 * 3_600_000);
      days30.push({ day, ...(daily.get(day) ?? { credits: 0, usd: 0 }) });
    }
    const monthStart = startOfMonth(now);
    const monthSpentCredits = this.db.billing.monthSpent(companyId, now);
    const monthSpentUsd = this.db.billing.usdSince(companyId, monthStart);
    const d = new Date(now);
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const elapsed = Math.max(1, (now - monthStart) / 86_400_000);
    return {
      balance: this.db.billing.balance(companyId),
      monthSpentCredits,
      monthSpentUsd,
      monthlyCredits: company.config.budgets.monthlyCredits,
      monthlyUsd: company.config.budgets.monthlyUsd,
      projectedMonthCredits: (monthSpentCredits / elapsed) * daysInMonth,
      projectedMonthUsd: (monthSpentUsd / elapsed) * daysInMonth,
      byRole: [...byRole.entries()].map(([role, v]) => ({ role, ...v })).sort((a, b) => b.credits - a.credits),
      byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.credits - a.credits),
      daily: days30,
      ledger: this.db.billing.ledger(companyId, 50),
    };
  }

  /** Verify a credential with a harmless read (never sends, posts, or deploys). */
  async testCredential(companyId: string, provider: string): Promise<{ ok: boolean; detail: string }> {
    let cred;
    try {
      cred = this.creds.resolve(companyId, provider, this.now());
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
    if (!cred) return { ok: false, detail: 'not connected' };
    const key = cred.secret.reveal();
    const get = async (url: string, headers: Record<string, string>): Promise<{ ok: boolean; detail: string }> => {
      try {
        const res = await this.fetchFn(url, { headers, signal: AbortSignal.timeout(10_000) });
        return { ok: res.ok, detail: res.ok ? `connected (HTTP ${res.status})` : `HTTP ${res.status} — check the key and its permissions` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    };
    const bearer = { Authorization: `Bearer ${key}` };
    switch (provider) {
      case 'stripe':
        return get('https://api.stripe.com/v1/balance', bearer);
      case 'resend':
        return get('https://api.resend.com/domains', bearer);
      case 'sendgrid':
        return get('https://api.sendgrid.com/v3/scopes', bearer);
      case 'github':
        return get('https://api.github.com/user', { ...bearer, 'User-Agent': 'flowstate-business-agent', Accept: 'application/vnd.github+json' });
      case 'hubspot':
        return get('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', bearer);
      case 'meta_ads':
        return get('https://graph.facebook.com/v21.0/me', bearer);
      case 'x':
        return get('https://api.twitter.com/2/users/me', bearer);
      case 'tavily':
      case 'firecrawl':
        return { ok: true, detail: 'stored — verified on first use' };
      case 'publish_webhook':
      case 'deploy_hook':
      case 'slack_webhook':
        // Never fire a webhook as a "test" — that would publish/deploy/post.
        return key.startsWith('https://')
          ? { ok: true, detail: 'looks valid (https URL) — not called during testing' }
          : { ok: false, detail: 'must be an https:// URL' };
      default:
        return { ok: false, detail: `unknown provider ${provider}` };
    }
  }
}
