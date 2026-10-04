import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { TerminalService, type PtyModule } from '@main/services/terminal-service';

const require = createRequire(import.meta.url);

describe('TerminalService', () => {
  it('runs a command in a piped shell and streams output until exit', async () => {
    let data = '';
    const exit = new Promise<number | null>((resolve) => {
      const svc = new TerminalService({
        onData: (_id, chunk) => {
          data += chunk;
        },
        onExit: (_id, code) => resolve(code),
      });
      svc.start('t1', tmpdir());
      // Echo a sentinel, then exit the shell.
      svc.write('t1', 'echo flowstate_term_ok\r\n');
      svc.write('t1', 'exit\r\n');
    });

    await exit;
    expect(data).toContain('flowstate_term_ok');
  }, 20_000);

  it('kill() ends a running session and fires onExit', async () => {
    const exited = new Promise<void>((resolve) => {
      const svc = new TerminalService({
        onData: () => {},
        onExit: () => resolve(),
      });
      svc.start('t2', tmpdir());
      setTimeout(() => svc.kill('t2'), 300);
    });
    await exited;
    expect(true).toBe(true);
  }, 20_000);

  it('falls back to a piped shell when node-pty cannot load', () => {
    const svc = new TerminalService({ onData: () => {}, onExit: () => {} }, () => {
      throw new Error('no native module');
    });
    expect(svc.hasPty).toBe(false);
    expect(svc.start('t3', tmpdir())).toEqual({ pty: false });
    svc.kill('t3');
  });

  it.runIf(process.platform === 'win32')('gives sessions a real TTY via node-pty (resizable)', async () => {
    let out = '';
    const exits: Array<number | null> = [];
    const svc = new TerminalService(
      {
        onData: (_id, chunk) => {
          out += chunk;
        },
        onExit: (_id, code) => exits.push(code),
      },
      () => require('@lydell/node-pty') as PtyModule,
    );
    const waitFor = async (re: RegExp): Promise<void> => {
      const until = Date.now() + 15_000;
      while (!re.test(out)) {
        if (Date.now() > until) throw new Error(`timed out waiting for ${re}; got: ${out.slice(-300)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    expect(svc.hasPty).toBe(true);
    expect(svc.start('t4', tmpdir(), { cols: 90, rows: 20 })).toEqual({ pty: true });
    // TTY-only: PowerShell reports the console width we asked for.
    svc.write('t4', 'echo "PTY_W=$($Host.UI.RawUI.WindowSize.Width)"\r');
    await waitFor(/PTY_W=90/);
    svc.resize('t4', 120, 30);
    svc.write('t4', 'echo "PTY_W=$($Host.UI.RawUI.WindowSize.Width)"\r');
    await waitFor(/PTY_W=120/);
    svc.write('t4', 'exit\r');
    const until = Date.now() + 10_000;
    while (exits.length === 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
    expect(exits).toHaveLength(1);
  }, 40_000);
});
