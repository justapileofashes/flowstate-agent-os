import type { MessageDto, AgentDto } from '@shared/chat-types';
import { ToolCallCard } from './ToolCallCard';
import type { ToolCallView } from '../lib/chat-stream-helpers';
import { MarkdownText } from './MarkdownText';
import { AgentAvatar } from '../lib/agent-icons';
import { ProcessTimeline } from './ProcessTimeline';

interface Props {
  message: MessageDto;
  toolResults: Map<string, { ok: boolean; content: string }>;
  agent?: AgentDto;
}

export function Message({ message, toolResults, agent }: Props): JSX.Element | null {
  if (message.role === 'system' || message.role === 'tool') {
    return null;
  }

  if (message.role === 'user') {
    return (
      <div className="msg">
        <div
          className="avatar"
          style={{ background: 'var(--accent)', color: '#0e0d0c', fontWeight: 600 }}
        >
          Y
        </div>
        <div className="body">
          <div className="role">you</div>
          <div className="text whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  const calls: ToolCallView[] = (message.toolCalls ?? []).map((c) => {
    const r = toolResults.get(c.id);
    return r ? { id: c.id, name: c.name, args: c.args, result: r } : { id: c.id, name: c.name, args: c.args };
  });

  return (
    <div className="msg">
      <div className="avatar" style={{ padding: 0 }}>
        {agent ? <AgentAvatar agent={agent} size={20} /> : <span>▲</span>}
      </div>
      <div className="body">
        <div className="role">{agent?.name?.toLowerCase() ?? 'agent'}</div>
        {calls.length > 0 ? <ProcessTimeline toolCalls={calls} /> : null}
        {message.content.length > 0 ? (
          <div className="text markdown" style={{ marginTop: 8 }}>
            <MarkdownText>{message.content}</MarkdownText>
          </div>
        ) : null}
        {calls.length > 0 ? (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {calls.map((c) => (
              <ToolCallCard key={c.id} call={c} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
