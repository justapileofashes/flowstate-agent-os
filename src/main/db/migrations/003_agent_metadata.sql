ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN specialty_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#d97757';

UPDATE agents
SET
  description = 'A focused coding assistant with file tools.',
  specialty_tags = '["coding","files"]'
WHERE id = 'agent-code-helper' AND description = '';
