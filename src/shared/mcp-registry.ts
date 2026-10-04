// Official MCP Registry (registry.modelcontextprotocol.io) → Flowstate MCP
// server configs. Pure: the main process fetches, this maps; the renderer
// builds the final config from the user's form values.
//
// How a registry entry is launched:
//   npm package   → npx -y <pkg>@<version> [package args]
//   PyPI package  → uvx <pkg>==<version> [package args]
//   OCI image     → docker run -i --rm -e VAR … <image> [package args]
//   remote server → npx -y mcp-remote <url> --header Name:${ENV}   (headers
//                   come from env, so secrets never appear in the process list)

export type RegistryKind = 'npm' | 'pypi' | 'oci' | 'remote';

export interface RegistryField {
  /** Env var name, or `header:<Name>` / `arg:<name>` for other inputs. */
  key: string;
  label: string;
  description: string;
  secret: boolean;
  required: boolean;
  defaultValue?: string;
}

interface PlanArg {
  type: 'positional' | 'named';
  name?: string;
  /** Fixed value from the registry, or… */
  value?: string;
  /** …the form field that supplies it. */
  fieldKey?: string;
}

export interface RegistryPlan {
  kind: RegistryKind;
  /** Package id, image, or remote URL. */
  identifier: string;
  version?: string;
  args: PlanArg[];
  /** Remote servers: header name → env var that holds its value. */
  headers: Array<{ name: string; envKey: string }>;
}

export interface RegistryEntryDto {
  /** Registry name, e.g. "io.github.upstash/context7". */
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl?: string;
  repositoryUrl?: string;
  plan: RegistryPlan;
  fields: RegistryField[];
}

export interface BuiltServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function headerEnvKey(name: string): string {
  return `MCP_HEADER_${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

function fieldFromInput(key: string, input: Json, fallbackLabel: string): RegistryField {
  const f: RegistryField = {
    key,
    label: str(input['name']) || fallbackLabel,
    description: str(input['description']),
    secret: input['isSecret'] === true,
    required: input['isRequired'] === true,
  };
  const d = str(input['default']) || str(input['value']);
  if (d) f.defaultValue = d;
  return f;
}

function planArgs(list: unknown, fields: RegistryField[]): PlanArg[] {
  const out: PlanArg[] = [];
  for (const raw of arr(list)) {
    const a = obj(raw);
    const type = a['type'] === 'named' ? 'named' : 'positional';
    const name = str(a['name']);
    const value = str(a['value']);
    if (value) {
      out.push({ type, ...(name ? { name } : {}), value });
    } else if (a['isRequired'] === true || str(a['default'])) {
      const key = `arg:${name || str(a['valueHint']) || `arg${out.length}`}`;
      fields.push(fieldFromInput(key, a, name || str(a['valueHint']) || 'argument'));
      out.push({ type, ...(name ? { name } : {}), fieldKey: key });
    }
  }
  return out;
}

/** Map one registry `server` object to an installable entry (null if it can't run here). */
export function mapRegistryServer(server: unknown): RegistryEntryDto | null {
  const s = obj(server);
  const name = str(s['name']);
  if (!name) return null;
  const base = {
    name,
    title: str(s['title']) || str(obj(obj(s['_meta'])['io.modelcontextprotocol.registry/publisher-provided'])['title']) || name.split('/').pop()!,
    description: str(s['description']),
    version: str(s['version']),
    ...(str(s['websiteUrl']) ? { websiteUrl: str(s['websiteUrl']) } : {}),
    ...(str(obj(s['repository'])['url']) ? { repositoryUrl: str(obj(s['repository'])['url']) } : {}),
  };

  // Prefer a local stdio package (npm, then PyPI, then OCI); else a remote.
  const packages = arr(s['packages']).map(obj);
  const order: Array<'npm' | 'pypi' | 'oci'> = ['npm', 'pypi', 'oci'];
  for (const kind of order) {
    const p = packages.find((x) => str(x['registryType']) === kind && str(obj(x['transport'])['type'] || 'stdio') === 'stdio');
    if (!p || !str(p['identifier'])) continue;
    const fields: RegistryField[] = [];
    for (const ev of arr(p['environmentVariables'])) {
      const e = obj(ev);
      if (str(e['name'])) fields.push(fieldFromInput(str(e['name']), e, str(e['name'])));
    }
    const args = planArgs(p['packageArguments'], fields);
    return {
      ...base,
      plan: {
        kind,
        identifier: str(p['identifier']),
        ...(str(p['version']) ? { version: str(p['version']) } : {}),
        args,
        headers: [],
      },
      fields,
    };
  }

  const remote = arr(s['remotes']).map(obj).find((r) => str(r['url']).startsWith('https://'));
  if (remote) {
    const fields: RegistryField[] = [];
    const headers: RegistryPlan['headers'] = [];
    for (const h of arr(remote['headers'])) {
      const hh = obj(h);
      const hName = str(hh['name']);
      if (!hName) continue;
      const envKey = headerEnvKey(hName);
      headers.push({ name: hName, envKey });
      fields.push({ ...fieldFromInput(envKey, hh, hName), label: hName });
    }
    return { ...base, plan: { kind: 'remote', identifier: str(remote['url']), args: [], headers }, fields };
  }
  return null;
}

/** A valid MCP server id (`^[a-z0-9][a-z0-9_-]{0,30}$`) from a registry name. */
export function serverIdFor(name: string, taken: Set<string> = new Set()): string {
  const last = name.split('/').pop() ?? name;
  let base = last.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 28) || 'mcp';
  base = base.replace(/-+$/, '') || 'mcp';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base.slice(0, 27)}-${n}`;
  return id;
}

/** Turn an entry + the user's form values into a server config. */
export function buildServerFromEntry(
  entry: RegistryEntryDto,
  values: Record<string, string>,
  taken: Set<string> = new Set(),
): BuiltServer {
  const { plan } = entry;
  const env: Record<string, string> = {};
  for (const f of entry.fields) {
    if (f.key.startsWith('arg:')) continue;
    const v = (values[f.key] ?? f.defaultValue ?? '').trim();
    if (v) env[f.key] = v;
  }
  const pkgArgs: string[] = [];
  for (const a of plan.args) {
    const v = a.value ?? (a.fieldKey ? (values[a.fieldKey] ?? '').trim() : '');
    if (!v) continue;
    if (a.type === 'named' && a.name) pkgArgs.push(a.name, v);
    else pkgArgs.push(v);
  }
  let command: string;
  let args: string[];
  switch (plan.kind) {
    case 'npm':
      command = 'npx';
      args = ['-y', plan.version ? `${plan.identifier}@${plan.version}` : plan.identifier, ...pkgArgs];
      break;
    case 'pypi':
      command = 'uvx';
      args = [plan.version ? `${plan.identifier}==${plan.version}` : plan.identifier, ...pkgArgs];
      break;
    case 'oci':
      command = 'docker';
      args = [
        'run',
        '-i',
        '--rm',
        ...Object.keys(env).flatMap((k) => ['-e', k]),
        plan.identifier.includes(':') || !plan.version ? plan.identifier : `${plan.identifier}:${plan.version}`,
        ...pkgArgs,
      ];
      break;
    case 'remote':
      command = 'npx';
      args = [
        '-y',
        'mcp-remote',
        plan.identifier,
        ...plan.headers.filter((h) => env[h.envKey]).flatMap((h) => ['--header', `${h.name}:\${${h.envKey}}`]),
      ];
      break;
  }
  return {
    id: serverIdFor(entry.name, taken),
    name: entry.title,
    command,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
