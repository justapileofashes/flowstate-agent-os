export interface ToolPerms {
  shell_enabled: boolean;
  delete_enabled: boolean;
}

export type ApprovalPolicy = 'cautious' | 'trusting' | 'yolo';

export interface AgentDto {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
  avatarColor: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  toolPerms: ToolPerms;
  approvalPolicy: ApprovalPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface ChatDto {
  id: string;
  agentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageDto {
  id: string;
  chatId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: { id: string; name: string; args?: unknown }[];
  toolCallId?: string;
  toolName?: string;
  createdAt: number;
}
