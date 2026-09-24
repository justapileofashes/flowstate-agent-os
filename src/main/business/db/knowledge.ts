// Semantic memory rows (content + Float32 embedding BLOB), kaizen learned
// rules (agents only ever *propose*; the owner activates), and owner-added
// constitutional constraints (no agent write path exists).

import type { Database } from 'better-sqlite3';
import type {
  ConstraintDto,
  KnowledgeCategory,
  KnowledgeDto,
  LearnedRuleDto,
  RuleStatus,
} from '@shared/business/types';
import { uid, type Row } from './util';

export interface KnowledgeRow extends KnowledgeDto {
  embedding: Float32Array | null;
  embedModel: string | null;
}

function toVector(buf: unknown): Float32Array | null {
  if (!Buffer.isBuffer(buf) || buf.byteLength % 4 !== 0 || buf.byteLength === 0) return null;
  // Copy into an aligned buffer — SQLite blobs are not guaranteed 4-byte aligned.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

export function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function mapKnowledge(r: Row): KnowledgeRow {
  return {
    id: r.id,
    companyId: r.company_id,
    content: r.content,
    category: r.category as KnowledgeCategory,
    source: r.source,
    sourceRunId: r.source_run_id ?? null,
    confidence: r.confidence,
    active: r.active === 1,
    createdAt: r.created_at,
    embedding: toVector(r.embedding),
    embedModel: r.embed_model ?? null,
  };
}

function mapRule(r: Row): LearnedRuleDto {
  return {
    id: r.id,
    companyId: r.company_id,
    condition: r.condition,
    action: r.action,
    rationale: r.rationale,
    polarity: r.polarity === 'avoid' ? 'avoid' : 'do',
    confidence: r.confidence,
    sourceRunId: r.source_run_id ?? null,
    sourceActionId: r.source_action_id ?? null,
    proposedBy: r.proposed_by,
    status: r.status as RuleStatus,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? null,
  };
}

export class KnowledgeRepo {
  constructor(private readonly db: Database) {}

  // ── semantic memory ─────────────────────────────────────────────────────

  add(input: {
    companyId: string;
    content: string;
    category: KnowledgeCategory;
    source?: string;
    sourceRunId?: string | null;
    confidence?: number;
    embedding?: Float32Array | null;
    embedModel?: string | null;
    now?: number;
  }): KnowledgeRow {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO biz_knowledge (id, company_id, content, category, source, source_run_id, confidence, active,
           embedding, embed_model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.content.slice(0, 8_000),
        input.category,
        (input.source ?? '').slice(0, 500),
        input.sourceRunId ?? null,
        Math.max(0, Math.min(1, input.confidence ?? 0.6)),
        input.embedding ? vectorToBlob(input.embedding) : null,
        input.embedModel ?? null,
        input.now ?? Date.now(),
      );
    return this.get(input.companyId, id)!;
  }

  get(companyId: string, id: string): KnowledgeRow | null {
    const r = this.db
      .prepare('SELECT * FROM biz_knowledge WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r ? mapKnowledge(r) : null;
  }

  list(companyId: string, opts: { activeOnly?: boolean; category?: KnowledgeCategory; limit?: number } = {}): KnowledgeRow[] {
    const where = ['company_id = ?'];
    const args: unknown[] = [companyId];
    if (opts.activeOnly) where.push('active = 1');
    if (opts.category) {
      where.push('category = ?');
      args.push(opts.category);
    }
    args.push(opts.limit ?? 5_000);
    return (
      this.db
        .prepare(`SELECT * FROM biz_knowledge WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...args) as Row[]
    ).map(mapKnowledge);
  }

  setEmbedding(companyId: string, id: string, v: Float32Array, model: string): void {
    this.db
      .prepare('UPDATE biz_knowledge SET embedding = ?, embed_model = ? WHERE id = ? AND company_id = ?')
      .run(vectorToBlob(v), model, id, companyId);
  }

  setActive(companyId: string, id: string, active: boolean): void {
    this.db
      .prepare('UPDATE biz_knowledge SET active = ? WHERE id = ? AND company_id = ?')
      .run(active ? 1 : 0, id, companyId);
  }

  delete(companyId: string, id: string): boolean {
    return this.db.prepare('DELETE FROM biz_knowledge WHERE id = ? AND company_id = ?').run(id, companyId).changes > 0;
  }

  /** Keep the newest `cap` rows per company. */
  prune(companyId: string, cap: number): void {
    this.db
      .prepare(
        `DELETE FROM biz_knowledge WHERE company_id = ? AND id NOT IN (
           SELECT id FROM biz_knowledge WHERE company_id = ? ORDER BY created_at DESC LIMIT ?)`,
      )
      .run(companyId, companyId, cap);
  }

  // ── learned rules ───────────────────────────────────────────────────────

  proposeRule(input: {
    companyId: string;
    condition: string;
    action: string;
    rationale?: string;
    polarity?: 'do' | 'avoid';
    confidence?: number;
    sourceRunId?: string | null;
    sourceActionId?: string | null;
    proposedBy: LearnedRuleDto['proposedBy'];
    status?: RuleStatus;
    now?: number;
  }): LearnedRuleDto | null {
    const condition = input.condition.trim().slice(0, 400);
    const action = input.action.trim().slice(0, 600);
    if (!condition || !action) return null;
    // Skip exact duplicates of an existing proposed/active rule.
    const dupe = this.db
      .prepare(
        "SELECT id FROM biz_learned_rules WHERE company_id = ? AND condition = ? AND action = ? AND status != 'rejected'",
      )
      .get(input.companyId, condition, action) as Row | undefined;
    if (dupe) return null;
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO biz_learned_rules (id, company_id, condition, action, rationale, polarity, confidence,
           source_run_id, source_action_id, proposed_by, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        condition,
        action,
        (input.rationale ?? '').slice(0, 1_000),
        input.polarity ?? 'do',
        Math.max(0, Math.min(1, input.confidence ?? 0.5)),
        input.sourceRunId ?? null,
        input.sourceActionId ?? null,
        input.proposedBy,
        input.status ?? 'proposed',
        input.now ?? Date.now(),
      );
    return this.getRule(input.companyId, id);
  }

  getRule(companyId: string, id: string): LearnedRuleDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_learned_rules WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r ? mapRule(r) : null;
  }

  rules(companyId: string, status?: RuleStatus): LearnedRuleDto[] {
    const rows = status
      ? this.db
          .prepare('SELECT * FROM biz_learned_rules WHERE company_id = ? AND status = ? ORDER BY created_at DESC')
          .all(companyId, status)
      : this.db.prepare('SELECT * FROM biz_learned_rules WHERE company_id = ? ORDER BY created_at DESC').all(companyId);
    return (rows as Row[]).map(mapRule);
  }

  setRuleStatus(companyId: string, id: string, status: RuleStatus, now = Date.now()): LearnedRuleDto | null {
    this.db
      .prepare('UPDATE biz_learned_rules SET status = ?, decided_at = ? WHERE id = ? AND company_id = ?')
      .run(status, now, id, companyId);
    return this.getRule(companyId, id);
  }

  deleteRule(companyId: string, id: string): boolean {
    return (
      this.db.prepare('DELETE FROM biz_learned_rules WHERE id = ? AND company_id = ?').run(id, companyId).changes > 0
    );
  }

  // ── owner constraints ───────────────────────────────────────────────────

  addConstraint(companyId: string | null, rule: string, now = Date.now()): ConstraintDto {
    const id = uid();
    this.db
      .prepare('INSERT INTO biz_constraints (id, company_id, rule, created_at) VALUES (?, ?, ?, ?)')
      .run(id, companyId, rule.trim().slice(0, 500), now);
    return { id, companyId, rule: rule.trim().slice(0, 500), immutable: false, createdAt: now };
  }

  constraints(companyId: string): ConstraintDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_constraints WHERE company_id = ? OR company_id IS NULL ORDER BY created_at')
        .all(companyId) as Row[]
    ).map((r) => ({
      id: r.id,
      companyId: r.company_id ?? null,
      rule: r.rule,
      immutable: false,
      createdAt: r.created_at,
    }));
  }

  deleteConstraint(companyId: string, id: string): boolean {
    return (
      this.db.prepare('DELETE FROM biz_constraints WHERE id = ? AND company_id = ?').run(id, companyId).changes > 0
    );
  }
}
