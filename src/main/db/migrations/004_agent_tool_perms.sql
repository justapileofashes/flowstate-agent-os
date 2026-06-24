ALTER TABLE agents ADD COLUMN tool_perms TEXT NOT NULL DEFAULT '{"shell_enabled":false,"delete_enabled":true}';
ALTER TABLE agents ADD COLUMN approval_policy TEXT NOT NULL DEFAULT 'cautious';

UPDATE agents
SET
  tool_perms = '{"shell_enabled":true,"delete_enabled":true}',
  approval_policy = 'cautious'
WHERE id = 'agent-code-helper' AND tool_perms = '{"shell_enabled":false,"delete_enabled":true}';
