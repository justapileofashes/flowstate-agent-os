// "Paste JSON" import for MCP servers, accepting the formats people copy
// from READMEs:
//   Claude Desktop / .mcp.json   { "mcpServers": { "<name>": {…} } }
//   VS Code                      { "servers":    { "<name>": {…} } }
//   a bare map                   { "<name>": { "command": … } }
//   a single server              { "command": …, "args": [ … ] }
// Each server is a local command (`command`/`args`/`env`) or a remote URL
// (`url`/`serverUrl` + `headers`), which runs through the mcp-remote bridge
// with header values kept in env. Pure.

import { serverIdFor, type BuiltServer } from './mcp-registry';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

function stringMap(v: unknown): Record<string, string> {
  if (!isObj(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) as Record<string, string>;
}

function looksLikeServer(v: unknown): v is Json {
  return isObj(v) && (typeof v['command'] === 'string' || typeof v['url'] === 'string' || typeof v['serverUrl'] === 'string');
}

function toServer(name: string, def: Json, taken: Set<string>): BuiltServer | string {
  const id = serverIdFor(name, taken);
  taken.add(id);
  const url = typeof def['url'] === 'string' ? def['url'] : typeof def['serverUrl'] === 'string' ? def['serverUrl'] : '';
  if (typeof def['command'] === 'string' && def['command'].trim()) {
    const args = Array.isArray(def['args']) ? def['args'].filter((a): a is string => typeof a === 'string') : [];
    const env = stringMap(def['env']);
    return {
      id,
      name,
      command: def['command'].trim(),
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  if (url) {
    if (!/^https?:\/\//i.test(url)) return `${name}: unsupported URL`;
    const headers = stringMap(def['headers']);
    const env: Record<string, string> = {};
    const headerArgs: string[] = [];
    for (const [h, value] of Object.entries(headers)) {
      const key = `MCP_HEADER_${h.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
      env[key] = value;
      headerArgs.push('--header', `${h}:\${${key}}`);
    }
    return {
      id,
      name,
      command: 'npx',
      args: ['-y', 'mcp-remote', url, ...headerArgs],
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  return `${name}: no command or url`;
}

export function parseMcpImport(
  text: string,
  taken: Set<string> = new Set(),
): { servers: BuiltServer[]; skipped: string[]; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/,(\s*[}\]])/g, '$1')); // tolerate trailing commas
  } catch {
    // READMEs often show just the inner `"name": { … }` fragment.
    try {
      parsed = JSON.parse(`{${text.trim().replace(/,\s*$/, '')}}`);
    } catch {
      return { servers: [], skipped: [], error: 'Not valid JSON.' };
    }
  }
  if (!isObj(parsed)) return { servers: [], skipped: [], error: 'Expected a JSON object.' };

  let map: Json;
  if (isObj(parsed['mcpServers'])) map = parsed['mcpServers'];
  else if (isObj(parsed['servers'])) map = parsed['servers'];
  else if (looksLikeServer(parsed)) map = { [typeof parsed['name'] === 'string' ? parsed['name'] : 'custom']: parsed };
  else map = parsed;

  const taken2 = new Set(taken);
  const servers: BuiltServer[] = [];
  const skipped: string[] = [];
  for (const [name, def] of Object.entries(map)) {
    if (!isObj(def)) {
      skipped.push(`${name}: not a server definition`);
      continue;
    }
    const r = toServer(name, def, taken2);
    if (typeof r === 'string') skipped.push(r);
    else servers.push(r);
  }
  if (servers.length === 0 && skipped.length === 0) return { servers, skipped, error: 'No MCP servers found in that JSON.' };
  return { servers, skipped };
}
