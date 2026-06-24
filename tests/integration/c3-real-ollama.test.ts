// Real-Ollama integration smoke. Skipped automatically if Ollama is unreachable.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { OllamaProvider } from '@main/agent/ollama-provider';
import { AgentSessionManager } from '@main/agent/agent-session-manager';
import { ApprovalGate } from '@main/agent/approval-gate';

const HOST = 'http://localhost:11434';

async function ollamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${HOST}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

describe('Plan C3 real-Ollama smoke', () => {
  it('runs a list_dir tool call end-to-end', async () => {
    if (!(await ollamaUp())) {
      console.warn('[smoke] Ollama not reachable on', HOST, '— skipping');
      return;
    }

    // Setup: ephemeral DB, ephemeral workspace with a known file
    const dir = mkdtempSync(join(tmpdir(), 'flowstate-smoke-'));
    const workspace = join(dir, 'ws');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'README.md'), '# test workspace\n');
    writeFileSync(join(workspace, 'a.txt'), 'hello world\n');

    const db = openDatabase(join(dir, 'smoke.sqlite'));
    setHelperWorkspace(db, workspace);
    const repo = new ChatRepository(db);

    // Pick first installed coder model
    const provider = new OllamaProvider(HOST);
    const installed = await provider.listModels();
    const TOOL_PREFIXES = [
      'qwen2.5-coder:',
      'qwen2.5:',
      'qwen3-coder:',
      'qwen3:',
      'llama3.3:',
      'llama3.1:',
      'mistral-nemo:',
    ];
    let model: string | undefined;
    for (const p of TOOL_PREFIXES) {
      const m = installed.find((x) => x.name.startsWith(p));
      if (m) {
        model = m.name;
        break;
      }
    }
    model = model ?? installed[0]?.name;
    if (!model) {
      console.warn('[smoke] no Ollama models installed — skipping');
      db.close();
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    db.prepare(
      "UPDATE agents SET model = ?, updated_at = ? WHERE id = 'agent-code-helper'",
    ).run(model, Date.now());

    const chat = repo.createChat('agent-code-helper');
    const events: Array<{ channel: string; payload: unknown }> = [];
    const send = (channel: string, payload: unknown) => {
      events.push({ channel, payload });
    };

    const approvalGate = new ApprovalGate(send, 50);
    const manager = new AgentSessionManager({
      provider,
      repo,
      approvalGate,
      send,
    });

    const { session, streamId } = await manager.start(chat.id);
    await session.run('Use the list_dir tool to list files in the workspace root.');

    const endChannel = `chat:event:${streamId}:end`;
    const endEvent = events.find((e) => e.channel === endChannel);
    const eventTypes = events
      .filter((e) => e.channel.startsWith('chat:event:') && !e.channel.endsWith(':end'))
      .map((e) => (e.payload as { type: string }).type);

    console.log('[smoke] model:', model);
    console.log('[smoke] event types observed:', eventTypes);
    console.log('[smoke] end:', endEvent?.payload);
    console.log(
      '[smoke] persisted roles:',
      repo.getMessages(chat.id).map((m) => m.role),
    );
    // Print full events to see error details
    for (const e of events) {
      console.log('[smoke] event', e.channel, JSON.stringify(e.payload));
    }

    expect(endEvent).toBeDefined();
    const reason = (endEvent?.payload as { reason: string } | undefined)?.reason;
    expect(['end', 'max-tools']).toContain(reason);

    const persistedRoles = repo.getMessages(chat.id).map((m) => m.role);
    expect(persistedRoles[0]).toBe('user');
    // We expect at least one assistant message after the user message.
    expect(persistedRoles).toContain('assistant');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
