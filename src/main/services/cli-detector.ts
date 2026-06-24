// CLI detector — the impure half of CLI detection. Locates each catalog command
// on PATH and best-effort reads its version. Probing is isolated behind
// `probeCli` so the orchestration (`detectInstalledClis`) can be unit-tested
// with a fake probe; the pure merge lives in cli-catalog.ts.

import { spawn } from 'node:child_process';
import { resolveSpawn } from './mcp-client';
import {
  KNOWN_CLIS,
  buildCliReport,
  parseVersion,
  type CliDef,
  type CliProbeResult,
  type DetectedCli,
} from './cli-catalog';

const PROBE_TIMEOUT_MS = 4000;

/** Run a command and resolve its trimmed stdout+stderr, or null on failure /
 *  timeout / non-zero exit. Never rejects. */
function runCapture(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    let out = '';
    try {
      const sp = resolveSpawn(command, args);
      const child = spawn(sp.command, sp.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: sp.shell,
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // best-effort
        }
        finish(null);
      }, PROBE_TIMEOUT_MS);
      child.stdout?.on('data', (d) => (out += String(d)));
      child.stderr?.on('data', (d) => (out += String(d)));
      child.on('error', () => {
        clearTimeout(timer);
        finish(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code === 0 ? out.trim() : null);
      });
    } catch {
      finish(null);
    }
  });
}

/** Locate a command on PATH, returning its resolved path or null. */
async function which(command: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const res = await runCapture(locator, args);
  if (!res) return null;
  // `where` can return multiple lines; take the first.
  return res.split(/\r?\n/)[0]?.trim() || null;
}

/** Probe a single CLI: presence on PATH + best-effort version. */
export async function probeCli(def: CliDef): Promise<CliProbeResult> {
  const path = await which(def.command);
  if (!path) return { id: def.id, installed: false, version: null, path: null };
  const versionOut = await runCapture(def.command, def.versionArgs ?? ['--version']);
  return {
    id: def.id,
    installed: true,
    version: versionOut ? parseVersion(versionOut) : null,
    path,
  };
}

/** Probe every catalog entry (in parallel) and return the merged report. A
 *  throwing probe is treated as "not installed" so one bad command never sinks
 *  the whole scan. `probe` is injectable for tests. */
export async function detectInstalledClis(
  defs: CliDef[] = KNOWN_CLIS,
  probe: (def: CliDef) => Promise<CliProbeResult> = probeCli,
): Promise<DetectedCli[]> {
  const results = await Promise.all(
    defs.map(async (def) => {
      try {
        return await probe(def);
      } catch {
        return { id: def.id, installed: false, version: null, path: null } as CliProbeResult;
      }
    }),
  );
  return buildCliReport(results);
}
