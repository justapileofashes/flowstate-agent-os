// Search the official MCP Registry (registry.modelcontextprotocol.io) and map
// results to installable entries (see src/shared/mcp-registry.ts). Results
// are cached briefly; only the latest version of each server is asked for.

import { mapRegistryServer, type RegistryEntryDto } from '@shared/mcp-registry';

const BASE = 'https://registry.modelcontextprotocol.io/v0/servers';
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; entries: RegistryEntryDto[] }>();

export async function searchMcpRegistry(
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<RegistryEntryDto[]> {
  const q = query.trim().toLowerCase();
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.entries;

  const params = new URLSearchParams({ version: 'latest', limit: '60' });
  if (q) params.set('search', q);
  const res = await fetchFn(`${BASE}?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`MCP registry returned HTTP ${res.status}`);
  const body = (await res.json()) as { servers?: Array<{ server?: unknown; _meta?: Record<string, unknown> }> };

  const seen = new Set<string>();
  const entries: RegistryEntryDto[] = [];
  for (const item of body.servers ?? []) {
    const status = (item._meta?.['io.modelcontextprotocol.registry/official'] as { status?: string } | undefined)?.status;
    if (status && status !== 'active') continue;
    const e = mapRegistryServer(item.server);
    if (!e || seen.has(e.name)) continue;
    seen.add(e.name);
    entries.push(e);
  }
  cache.set(q, { at: Date.now(), entries });
  return entries;
}
