// Semantic memory service: embed on write, cosine recall on read. Rows
// embedded by a different model (e.g. the owner switched embedders, or a
// write fell back to hashing) are lazily re-embedded at query time so recall
// stays comparable. Retrieval feeds planning context.

import type { KnowledgeCategory, KnowledgeDto } from '@shared/business/types';
import type { BizDb } from '../db';
import { LIMITS } from '../config';
import { cosine, safeEmbed, type Embedder } from './embeddings';

const REEMBED_PER_QUERY = 200;

function toDto(r: KnowledgeDto & { embedding?: unknown; embedModel?: unknown }, score?: number): KnowledgeDto {
  return {
    id: r.id,
    companyId: r.companyId,
    content: r.content,
    category: r.category,
    source: r.source,
    sourceRunId: r.sourceRunId,
    confidence: r.confidence,
    active: r.active,
    createdAt: r.createdAt,
    ...(score !== undefined ? { score: Math.round(score * 1000) / 1000 } : {}),
  };
}

export class KnowledgeService {
  constructor(
    private readonly db: BizDb,
    private readonly embedderFor: (companyId: string) => Embedder,
  ) {}

  async add(
    companyId: string,
    input: {
      content: string;
      category: KnowledgeCategory;
      source?: string;
      sourceRunId?: string | null;
      confidence?: number;
    },
  ): Promise<KnowledgeDto> {
    const { model, vectors } = await safeEmbed(this.embedderFor(companyId), [input.content]);
    const row = this.db.knowledge.add({
      companyId,
      content: input.content,
      category: input.category,
      source: input.source ?? '',
      sourceRunId: input.sourceRunId ?? null,
      confidence: input.confidence ?? 0.6,
      embedding: vectors[0] ?? null,
      embedModel: model,
    });
    this.db.knowledge.prune(companyId, LIMITS.knowledgeCapPerCompany);
    return toDto(row);
  }

  async search(
    companyId: string,
    query: string,
    opts: { k?: number; category?: KnowledgeCategory; minScore?: number } = {},
  ): Promise<KnowledgeDto[]> {
    const rows = this.db.knowledge.list(companyId, {
      activeOnly: true,
      ...(opts.category ? { category: opts.category } : {}),
    });
    if (!rows.length || !query.trim()) return [];
    const embedder = this.embedderFor(companyId);
    const q = await safeEmbed(embedder, [query]);
    const qv = q.vectors[0]!;

    // Re-embed rows whose vectors came from another model (bounded per query).
    const stale = rows.filter((r) => r.embedModel !== q.model || !r.embedding).slice(0, REEMBED_PER_QUERY);
    if (stale.length) {
      const fresh = await safeEmbed(embedder, stale.map((r) => r.content));
      if (fresh.model === q.model) {
        stale.forEach((r, i) => {
          const v = fresh.vectors[i]!;
          r.embedding = v;
          r.embedModel = fresh.model;
          this.db.knowledge.setEmbedding(companyId, r.id, v, fresh.model);
        });
      }
    }

    const minScore = opts.minScore ?? 0.05;
    return rows
      .filter((r) => r.embedding && r.embedModel === q.model)
      .map((r) => ({ r, score: cosine(qv, r.embedding!) * (0.75 + 0.25 * r.confidence) }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.k ?? 5)
      .map((x) => toDto(x.r, x.score));
  }

  list(companyId: string, limit = 200): KnowledgeDto[] {
    return this.db.knowledge.list(companyId, { limit }).map((r) => toDto(r));
  }
}
