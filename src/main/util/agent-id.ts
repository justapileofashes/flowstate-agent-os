import { randomUUID } from 'node:crypto';

export function generateAgentId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'agent';
  return `${slug}-${randomUUID().slice(0, 8)}`;
}
