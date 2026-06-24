import { z } from 'zod';

export const agentFormSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(200),
  specialtyTags: z.array(z.string().min(1).max(40)).max(10),
  systemPrompt: z.string().min(1).max(4000),
  model: z.string().min(1),
  avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  toolPerms: z.object({
    shell_enabled: z.boolean(),
    delete_enabled: z.boolean(),
  }),
  approvalPolicy: z.enum(['cautious', 'trusting', 'yolo']),
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

export const AVATAR_COLORS = [
  '#d97757',
  '#5b8def',
  '#6dbf94',
  '#a973d4',
  '#d96e6e',
  '#9ca3af',
] as const;
