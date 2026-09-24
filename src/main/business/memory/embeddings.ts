// Embedders for semantic memory (the pgvector replacement). Real models via
// Ollama (/api/embed) or OpenAI; a deterministic feature-hashing embedder is
// the offline fallback so memory recall works with zero setup.

export interface Embedder {
  readonly model: string;
  embed(texts: string[]): Promise<Float32Array[]>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const STOPWORDS = new Set(
  'a an and are as at be but by for from has have i in is it its of on or that the this to was we were will with you your our not no'.split(
    ' ',
  ),
);

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/** Bag of words + bigrams, signed feature hashing, L2-normalized. */
export function hashEmbedder(dim = 384): Embedder {
  return {
    model: `hash-${dim}`,
    async embed(texts) {
      return texts.map((text) => {
        const v = new Float32Array(dim);
        const words = text
          .toLowerCase()
          .split(/[^a-z0-9$%]+/)
          .filter((w) => w.length > 1 && !STOPWORDS.has(w));
        const feats = [...words];
        for (let i = 0; i + 1 < words.length; i++) feats.push(`${words[i]} ${words[i + 1]}`);
        for (const f of feats) {
          const h = fnv1a(f);
          v[h % dim] = v[h % dim]! + (h & 0x80000000 ? -1 : 1);
        }
        return normalize(v);
      });
    },
  };
}

export function ollamaEmbedder(host: string, model: string, fetchFn: FetchFn = fetch): Embedder {
  return {
    model: `ollama:${model}`,
    async embed(texts) {
      const res = await fetchFn(`${host}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
      const body = (await res.json()) as { embeddings?: number[][] };
      if (!body.embeddings || body.embeddings.length !== texts.length) throw new Error('Ollama embed: bad response');
      return body.embeddings.map((e) => normalize(Float32Array.from(e)));
    },
  };
}

export function openaiEmbedder(getKey: () => string, model: string, fetchFn: FetchFn = fetch): Embedder {
  return {
    model: `openai:${model}`,
    async embed(texts) {
      const key = getKey();
      if (!key) throw new Error('OpenAI key not configured');
      const res = await fetchFn('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`OpenAI embed HTTP ${res.status}`);
      const body = (await res.json()) as { data?: Array<{ embedding: number[] }> };
      if (!body.data || body.data.length !== texts.length) throw new Error('OpenAI embed: bad response');
      return body.data.map((d) => normalize(Float32Array.from(d.embedding)));
    },
  };
}

/** Wrap an embedder so failures degrade to hashing instead of throwing. */
export async function safeEmbed(
  embedder: Embedder,
  texts: string[],
): Promise<{ model: string; vectors: Float32Array[] }> {
  try {
    return { model: embedder.model, vectors: await embedder.embed(texts) };
  } catch {
    const fb = hashEmbedder();
    return { model: fb.model, vectors: await fb.embed(texts) };
  }
}
