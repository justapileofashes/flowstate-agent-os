import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { TerminalService } from '@main/services/terminal-service';

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
});
