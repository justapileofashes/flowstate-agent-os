// Companies + the versioned CompanyConfig (single source of truth) + the per
// role agent roster. Config rows are append-only: every edit writes a new
// version and moves the active pointer, so history is always diffable.

import type { Database } from 'better-sqlite3';
import {
  companyConfigSchema,
  ROLE_KEYS,
  type AgentConfigDto,
  type AutoApproveLevel,
  type CompanyConfig,
  type CompanyDto,
  type CompanyStatus,
  type ConfigVersionDto,
  type ModelAlias,
  type RoleKey,
} from '@shared/business/types';
import { buildUpdate, parseJson, uid, type Row } from './util';

export type AgentConfigSeed = Omit<AgentConfigDto, 'id' | 'companyId' | 'updatedAt'>;

function parseConfig(raw: unknown, fallbackName: string): CompanyConfig {
  const parsed = companyConfigSchema.safeParse(parseJson(raw, {}));
  return parsed.success ? parsed.data : companyConfigSchema.parse({ name: fallbackName });
}

function mapAgent(r: Row): AgentConfigDto {
  return {
    id: r.id,
    companyId: r.company_id,
    role: r.role as RoleKey,
    enabled: r.enabled === 1,
    scheduleCron: r.schedule_cron,
    modelAlias: r.model_alias as ModelAlias,
    maxIterations: r.max_iterations,
    costCapCredits: r.cost_cap_credits,
    autoApproveUpTo: r.auto_approve_up_to as AutoApproveLevel,
    standingInstruction: r.standing_instruction,
    updatedAt: r.updated_at,
  };
}

const AGENT_COLUMNS: Record<string, string> = {
  enabled: 'enabled',
  scheduleCron: 'schedule_cron',
  modelAlias: 'model_alias',
  maxIterations: 'max_iterations',
  costCapCredits: 'cost_cap_credits',
  autoApproveUpTo: 'auto_approve_up_to',
  standingInstruction: 'standing_instruction',
  updatedAt: 'updated_at',
};

export class CompaniesRepo {
  constructor(private readonly db: Database) {}

  create(
    config: CompanyConfig,
    agents: AgentConfigSeed[],
    opts: { editedBy?: 'user' | 'system'; note?: string; now?: number } = {},
  ): CompanyDto {
    const now = opts.now ?? Date.now();
    const id = uid();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO biz_companies (id, name, status, active_config_version, created_at, updated_at)
           VALUES (?, ?, 'active', 1, ?, ?)`,
        )
        .run(id, config.name, now, now);
      this.db
        .prepare(
          `INSERT INTO biz_company_configs (company_id, version, config, edited_by, note, edited_at)
           VALUES (?, 1, ?, ?, ?, ?)`,
        )
        .run(id, JSON.stringify(config), opts.editedBy ?? 'user', opts.note ?? 'created', now);
      const insertAgent = this.db.prepare(
        `INSERT INTO biz_agent_configs (id, company_id, role, enabled, schedule_cron, model_alias,
           max_iterations, cost_cap_credits, auto_approve_up_to, standing_instruction, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of agents) {
        insertAgent.run(
          uid(),
          id,
          a.role,
          a.enabled ? 1 : 0,
          a.scheduleCron,
          a.modelAlias,
          a.maxIterations,
          a.costCapCredits,
          a.autoApproveUpTo,
          a.standingInstruction,
          now,
          now,
        );
      }
    })();
    return this.get(id)!;
  }

  get(id: string): CompanyDto | null {
    const r = this.db
      .prepare(
        `SELECT c.*, cfg.config AS config FROM biz_companies c
         JOIN biz_company_configs cfg ON cfg.company_id = c.id AND cfg.version = c.active_config_version
         WHERE c.id = ?`,
      )
      .get(id) as Row | undefined;
    return r ? this.map(r) : null;
  }

  list(includeArchived = false): CompanyDto[] {
    const rows = this.db
      .prepare(
        `SELECT c.*, cfg.config AS config FROM biz_companies c
         JOIN biz_company_configs cfg ON cfg.company_id = c.id AND cfg.version = c.active_config_version
         ${includeArchived ? '' : "WHERE c.status != 'archived'"}
         ORDER BY c.created_at`,
      )
      .all() as Row[];
    return rows.map((r) => this.map(r));
  }

  private map(r: Row): CompanyDto {
    return {
      id: r.id,
      name: r.name,
      status: r.status as CompanyStatus,
      activeConfigVersion: r.active_config_version,
      config: parseConfig(r.config, r.name),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  /** Append a new config version and make it active. */
  updateConfig(
    id: string,
    config: CompanyConfig,
    editedBy: 'user' | 'agent' | 'system',
    note = '',
    now = Date.now(),
  ): CompanyDto {
    const clean = companyConfigSchema.parse(config);
    this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT MAX(version) AS v FROM biz_company_configs WHERE company_id = ?')
        .get(id) as { v: number | null };
      if (row.v === null) throw new Error(`unknown company ${id}`);
      const next = row.v + 1;
      this.db
        .prepare(
          `INSERT INTO biz_company_configs (company_id, version, config, edited_by, note, edited_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, next, JSON.stringify(clean), editedBy, note.slice(0, 500), now);
      this.db
        .prepare(
          'UPDATE biz_companies SET active_config_version = ?, name = ?, updated_at = ? WHERE id = ?',
        )
        .run(next, clean.name, now, id);
    })();
    return this.get(id)!;
  }

  history(id: string, limit = 50): ConfigVersionDto[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM biz_company_configs WHERE company_id = ? ORDER BY version DESC LIMIT ?`,
      )
      .all(id, limit) as Row[];
    return rows.map((r) => ({
      version: r.version,
      config: parseConfig(r.config, ''),
      editedBy: r.edited_by,
      note: r.note,
      editedAt: r.edited_at,
    }));
  }

  setStatus(id: string, status: CompanyStatus, now = Date.now()): void {
    this.db
      .prepare('UPDATE biz_companies SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM biz_companies WHERE id = ?').run(id);
  }

  // ── agent roster ────────────────────────────────────────────────────────

  agentConfigs(companyId: string): AgentConfigDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_agent_configs WHERE company_id = ?')
        .all(companyId) as Row[]
    )
      .map(mapAgent)
      .sort((a, b) => ROLE_KEYS.indexOf(a.role) - ROLE_KEYS.indexOf(b.role));
  }

  agentConfig(companyId: string, role: RoleKey): AgentConfigDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_agent_configs WHERE company_id = ? AND role = ?')
      .get(companyId, role) as Row | undefined;
    return r ? mapAgent(r) : null;
  }

  updateAgentConfig(
    companyId: string,
    id: string,
    patch: Partial<Omit<AgentConfigDto, 'id' | 'companyId' | 'role'>>,
    now = Date.now(),
  ): AgentConfigDto | null {
    const upd = buildUpdate(
      'biz_agent_configs',
      'id = ? AND company_id = ?',
      { ...patch, updatedAt: now },
      AGENT_COLUMNS,
    );
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id, companyId);
    const r = this.db
      .prepare('SELECT * FROM biz_agent_configs WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r ? mapAgent(r) : null;
  }

  /** Add roster rows for roles that don't exist yet (new roles after upgrades). */
  ensureAgents(companyId: string, agents: AgentConfigSeed[], now = Date.now()): void {
    const have = new Set(this.agentConfigs(companyId).map((a) => a.role));
    const insert = this.db.prepare(
      `INSERT INTO biz_agent_configs (id, company_id, role, enabled, schedule_cron, model_alias,
         max_iterations, cost_cap_credits, auto_approve_up_to, standing_instruction, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const a of agents) {
      if (have.has(a.role)) continue;
      insert.run(
        uid(),
        companyId,
        a.role,
        a.enabled ? 1 : 0,
        a.scheduleCron,
        a.modelAlias,
        a.maxIterations,
        a.costCapCredits,
        a.autoApproveUpTo,
        a.standingInstruction,
        now,
        now,
      );
    }
  }
}
