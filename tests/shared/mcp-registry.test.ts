import { describe, it, expect } from 'vitest';
import { buildServerFromEntry, mapRegistryServer, serverIdFor } from '../../src/shared/mcp-registry';
import { parseMcpImport } from '../../src/shared/mcp-import';

const context7 = {
  name: 'io.github.upstash/context7',
  description: 'Up-to-date docs',
  version: '4.1.1',
  packages: [
    {
      registryType: 'npm',
      identifier: '@upstash/context7-mcp',
      version: '4.1.1',
      transport: { type: 'stdio' },
      environmentVariables: [{ name: 'CONTEXT7_API_KEY', description: 'API key', isSecret: true }],
    },
  ],
};

describe('MCP registry mapping', () => {
  it('maps an npm package to npx with env fields', () => {
    const e = mapRegistryServer(context7)!;
    expect(e.plan.kind).toBe('npm');
    expect(e.fields).toEqual([{ key: 'CONTEXT7_API_KEY', label: 'CONTEXT7_API_KEY', description: 'API key', secret: true, required: false }]);
    const s = buildServerFromEntry(e, { CONTEXT7_API_KEY: 'k1' });
    expect(s).toEqual({ id: 'context7', name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp@4.1.1'], env: { CONTEXT7_API_KEY: 'k1' } });
  });

  it('maps PyPI with fixed package args, and OCI with -e env passing', () => {
    const py = mapRegistryServer({
      name: 'dev.memgit/memgit',
      version: '0.12.0',
      packages: [{ registryType: 'pypi', identifier: 'memgit', version: '0.12.0', transport: { type: 'stdio' }, packageArguments: [{ type: 'positional', value: 'serve' }] }],
    })!;
    expect(buildServerFromEntry(py, {}).args).toEqual(['memgit==0.12.0', 'serve']);
    const oci = mapRegistryServer({
      name: 'x/img',
      version: '1',
      packages: [{ registryType: 'oci', identifier: 'ghcr.io/x/img:1.0', transport: { type: 'stdio' }, environmentVariables: [{ name: 'TOKEN', isRequired: true }] }],
    })!;
    const built = buildServerFromEntry(oci, { TOKEN: 't' });
    expect(built.command).toBe('docker');
    expect(built.args).toEqual(['run', '-i', '--rm', '-e', 'TOKEN', 'ghcr.io/x/img:1.0']);
  });

  it('maps remote servers through mcp-remote with header secrets kept in env', () => {
    const e = mapRegistryServer({
      name: 'com.example/api',
      version: '1.0.0',
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', isSecret: true, isRequired: true }] }],
    })!;
    expect(e.plan.kind).toBe('remote');
    const s = buildServerFromEntry(e, { MCP_HEADER_AUTHORIZATION: 'Bearer abc' });
    expect(s.args).toEqual(['-y', 'mcp-remote', 'https://example.com/mcp', '--header', 'Authorization:${MCP_HEADER_AUTHORIZATION}']);
    expect(s.env).toEqual({ MCP_HEADER_AUTHORIZATION: 'Bearer abc' });
    expect(JSON.stringify(s.args)).not.toContain('abc');
  });

  it('skips entries it cannot run', () => {
    expect(mapRegistryServer({ name: 'a/b', remotes: [{ url: 'http://insecure' }] })).toBeNull();
    expect(mapRegistryServer({})).toBeNull();
  });

  it('makes valid, unique server ids', () => {
    expect(serverIdFor('io.github.upstash/Context7 MCP!!')).toBe('context7-mcp');
    expect(serverIdFor('a/context7', new Set(['context7']))).toBe('context7-2');
    expect(serverIdFor('x/' + 'y'.repeat(60))).toMatch(/^[a-z0-9][a-z0-9_-]{0,30}$/);
  });
});

describe('Paste-JSON MCP import', () => {
  it('reads Claude Desktop mcpServers (local + remote)', () => {
    const r = parseMcpImport(
      JSON.stringify({
        mcpServers: {
          playwright: { command: 'npx', args: ['@playwright/mcp@latest'] },
          linear: { url: 'https://mcp.linear.app/sse', headers: { Authorization: 'Bearer lin_123' } },
        },
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.servers[0]).toEqual({ id: 'playwright', name: 'playwright', command: 'npx', args: ['@playwright/mcp@latest'] });
    expect(r.servers[1]!.args).toEqual(['-y', 'mcp-remote', 'https://mcp.linear.app/sse', '--header', 'Authorization:${MCP_HEADER_AUTHORIZATION}']);
    expect(r.servers[1]!.env).toEqual({ MCP_HEADER_AUTHORIZATION: 'Bearer lin_123' });
  });

  it('accepts VS Code "servers", a bare map, a single server and a README fragment', () => {
    expect(parseMcpImport('{"servers":{"a":{"command":"uvx","args":["x"]}}}').servers).toHaveLength(1);
    expect(parseMcpImport('{"b":{"command":"node","args":["s.js"],"env":{"K":"v"}}}').servers[0]!.env).toEqual({ K: 'v' });
    expect(parseMcpImport('{"command":"npx","args":["-y","pkg"]}').servers[0]!.id).toBe('custom');
    expect(parseMcpImport('"memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] },').servers[0]!.id).toBe('memory');
  });

  it('reports bad input instead of throwing', () => {
    expect(parseMcpImport('not json').error).toBeTruthy();
    expect(parseMcpImport('{"x": {"foo": 1}}').skipped).toEqual(['x: no command or url']);
  });
});
