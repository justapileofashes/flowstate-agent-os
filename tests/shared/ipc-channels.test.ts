import { describe, it, expect } from 'vitest';
import {
  CHANNELS,
  schemas,
  chatEventChannel,
  chatEventEndChannel,
} from '@shared/ipc-channels';

describe('ipc-channels', () => {
  it('declares settings channels with stable names', () => {
    expect(CHANNELS.SETTINGS_GET).toBe('settings:get');
    expect(CHANNELS.SETTINGS_SET).toBe('settings:set');
  });

  it('declares ollama channels with stable names', () => {
    expect(CHANNELS.OLLAMA_HEALTH).toBe('ollama:health');
  });

  it('settings:set request schema rejects empty key', () => {
    const result = schemas.settingsSetRequest.safeParse({ key: '', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('settings:set request schema accepts valid payload', () => {
    const result = schemas.settingsSetRequest.safeParse({ key: 'workspaces_dir', value: '/tmp/ws' });
    expect(result.success).toBe(true);
  });

  it('ollama:health response schema accepts valid status', () => {
    const result = schemas.ollamaHealthResponse.safeParse({
      reachable: true,
      version: '0.4.0',
      host: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });

  it('ollama:health response schema accepts unreachable without version', () => {
    const result = schemas.ollamaHealthResponse.safeParse({
      reachable: false,
      host: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });
});

describe('chat channels', () => {
  it('declares chat channels with stable names', () => {
    expect(CHANNELS.CHAT_LIST_AGENTS).toBe('chat:list-agents');
    expect(CHANNELS.CHAT_LIST_CHATS).toBe('chat:list-chats');
    expect(CHANNELS.CHAT_CREATE_CHAT).toBe('chat:create-chat');
    expect(CHANNELS.CHAT_GET_MESSAGES).toBe('chat:get-messages');
    expect(CHANNELS.CHAT_SEND_MESSAGE).toBe('chat:send-message');
    expect(CHANNELS.CHAT_ABORT).toBe('chat:abort');
  });

  it('chat:send-message request rejects empty text', () => {
    const r = schemas.chatSendMessageRequest.safeParse({ chatId: 'c1', text: '' });
    expect(r.success).toBe(false);
  });

  it('chat:send-message request accepts valid payload', () => {
    const r = schemas.chatSendMessageRequest.safeParse({ chatId: 'c1', text: 'hi' });
    expect(r.success).toBe(true);
  });

  it('chat:create-chat request allows optional title', () => {
    expect(schemas.chatCreateChatRequest.safeParse({ agentId: 'a1' }).success).toBe(true);
    expect(schemas.chatCreateChatRequest.safeParse({ agentId: 'a1', title: 't' }).success).toBe(true);
  });

  it('chat:abort request requires streamId', () => {
    expect(schemas.chatAbortRequest.safeParse({}).success).toBe(false);
    expect(schemas.chatAbortRequest.safeParse({ streamId: 's1' }).success).toBe(true);
  });

  it('chat:event channel name builder produces stable string', () => {
    expect(chatEventChannel('abc-123')).toBe('chat:event:abc-123');
    expect(chatEventEndChannel('abc-123')).toBe('chat:event:abc-123:end');
  });
});
