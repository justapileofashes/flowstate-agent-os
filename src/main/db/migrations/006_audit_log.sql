-- Agent audit log: a queryable record of every tool call, approval decision,
-- and workspace rollback. Foundation of the governance/explainability layer.
CREATE TABLE IF NOT EXISTS audit_log (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  agent_id    TEXT NOT NULL,
  chat_id     TEXT,
  stream_id   TEXT,
  event_type  TEXT NOT NULL,
  tool_name   TEXT,
  decision    TEXT,
  ok          INTEGER,
  duration_ms INTEGER,
  arg_summary TEXT,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_chat ON audit_log(chat_id, ts DESC);
