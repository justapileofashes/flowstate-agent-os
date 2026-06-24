import { chatEventChannel } from '@shared/ipc-channels';
import type { ApprovalPolicy, ToolPerms } from '@shared/chat-types';
import type { AuditLogger } from '@main/services/audit-logger';
import { evaluateConstitution, type ConstitutionRule } from './constitution';

interface AgentLike {
  id: string;
  approvalPolicy: ApprovalPolicy;
  toolPerms: ToolPerms;
}

export interface ApprovalRequireOpts {
  streamId: string;
  chatId: string;
  agent: AgentLike;
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
  isOverwrite: boolean;
  /** Per-agent constitution rules, evaluated before the built-in policy. */
  constitution?: ConstitutionRule[];
}

type Decision = 'allow-once' | 'allow-rest' | 'deny';

interface PendingApproval {
  resolve: (result: 'allow' | 'deny') => void;
  timer: NodeJS.Timeout;
  chatId: string;
  toolName: string;
  agentId: string;
  streamId: string;
}

export class ApprovalGate {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly allowRestMemo = new Map<string, Set<string>>();

  constructor(
    private readonly send: (channel: string, payload: unknown) => void,
    private readonly autoDenyMs: number = 5 * 60 * 1000,
    private readonly audit?: AuditLogger,
  ) {}

  shouldPrompt(
    policy: ApprovalPolicy,
    toolName: string,
    _args: unknown,
    isOverwrite: boolean,
  ): boolean {
    if (policy === 'yolo') return false;
    if (toolName === 'run_shell') return true;
    if (toolName === 'delete_file') return true;
    if (toolName === 'write_file') {
      if (policy === 'cautious') return isOverwrite;
      return false;
    }
    return false;
  }

  async require(opts: ApprovalRequireOpts): Promise<'allow' | 'deny'> {
    // Constitution rules win over the built-in policy.
    const verdict =
      opts.constitution && opts.constitution.length
        ? evaluateConstitution(opts.constitution, { toolName: opts.toolName, args: opts.args })
        : null;
    if (verdict === 'deny') {
      this.audit?.approval(
        { agentId: opts.agent.id, chatId: opts.chatId, streamId: opts.streamId },
        { toolName: opts.toolName, decision: 'constitution-deny', args: opts.args },
      );
      return 'deny';
    }
    if (verdict === 'allow') {
      return 'allow';
    }
    const mustAsk = verdict === 'ask';

    if (!mustAsk) {
      if (!this.shouldPrompt(opts.agent.approvalPolicy, opts.toolName, opts.args, opts.isOverwrite)) {
        return 'allow';
      }
      const memo = this.allowRestMemo.get(opts.chatId);
      if (memo?.has(opts.toolName)) return 'allow';
    }

    const key = `${opts.streamId}:${opts.toolCallId}`;
    return new Promise<'allow' | 'deny'>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        this.audit?.approval(
          { agentId: opts.agent.id, chatId: opts.chatId, streamId: opts.streamId },
          { toolName: opts.toolName, decision: 'auto-deny', args: opts.args },
        );
        resolve('deny');
      }, this.autoDenyMs);
      this.pending.set(key, {
        resolve,
        timer,
        chatId: opts.chatId,
        toolName: opts.toolName,
        agentId: opts.agent.id,
        streamId: opts.streamId,
      });
      this.send(chatEventChannel(opts.streamId), {
        type: 'tool-approval-required',
        toolCallId: opts.toolCallId,
        toolName: opts.toolName,
        args: opts.args,
        cwd: opts.cwd,
      });
    });
  }

  resolve(streamId: string, toolCallId: string, decision: Decision, _reason?: string): boolean {
    const key = `${streamId}:${toolCallId}`;
    const entry = this.pending.get(key);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(key);
    if (decision === 'allow-rest') {
      let set = this.allowRestMemo.get(entry.chatId);
      if (!set) {
        set = new Set();
        this.allowRestMemo.set(entry.chatId, set);
      }
      set.add(entry.toolName);
    }
    this.audit?.approval(
      { agentId: entry.agentId, chatId: entry.chatId, streamId: entry.streamId },
      { toolName: entry.toolName, decision },
    );
    entry.resolve(decision === 'deny' ? 'deny' : 'allow');
    this.send(chatEventChannel(streamId), {
      type: 'tool-approval-resolved',
      toolCallId,
      decision,
    });
    return true;
  }
}
