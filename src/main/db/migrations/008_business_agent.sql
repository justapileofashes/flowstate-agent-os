-- Business agent ("AI that runs the business"). Every row is scoped to a
-- company; deleting a company cascades. Config is append-only versions (the
-- single source of truth), secrets live only as vault ciphertext, run_steps
-- is the redacted episodic trace, and the credits ledger + usage events meter
-- spend. See docs/superpowers/specs/2026-09-24-business-agent-design.md.

CREATE TABLE IF NOT EXISTS biz_companies (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'active',
  active_config_version INTEGER NOT NULL DEFAULT 1,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS biz_company_configs (
  company_id TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  config     TEXT NOT NULL,
  edited_by  TEXT NOT NULL DEFAULT 'user',
  note       TEXT NOT NULL DEFAULT '',
  edited_at  INTEGER NOT NULL,
  PRIMARY KEY (company_id, version)
);

CREATE TABLE IF NOT EXISTS biz_vault_keys (
  id          TEXT PRIMARY KEY,
  wrapped_dek TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  retired_at  INTEGER
);

CREATE TABLE IF NOT EXISTS biz_credentials (
  id              TEXT PRIMARY KEY,
  company_id      TEXT REFERENCES biz_companies(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  secret_enc      TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  meta            TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',
  created_at      INTEGER NOT NULL,
  last_rotated_at INTEGER NOT NULL,
  last_used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_biz_credentials_company ON biz_credentials(company_id, provider);

CREATE TABLE IF NOT EXISTS biz_agent_configs (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  role                 TEXT NOT NULL,
  enabled              INTEGER NOT NULL DEFAULT 1,
  schedule_cron        TEXT NOT NULL DEFAULT '',
  model_alias          TEXT NOT NULL,
  max_iterations       INTEGER NOT NULL DEFAULT 8,
  cost_cap_credits     REAL NOT NULL DEFAULT 60,
  auto_approve_up_to   TEXT NOT NULL DEFAULT 'none',
  standing_instruction TEXT NOT NULL DEFAULT '',
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  UNIQUE (company_id, role)
);

CREATE TABLE IF NOT EXISTS biz_cycles (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  trigger_type   TEXT NOT NULL,
  status         TEXT NOT NULL,
  role           TEXT,
  plan           TEXT,
  summary        TEXT,
  stop_reason    TEXT,
  credits_cap    REAL NOT NULL DEFAULT 0,
  usd_cap        REAL NOT NULL DEFAULT 0,
  credits_spent  REAL NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  config_version INTEGER NOT NULL DEFAULT 1,
  error          TEXT,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_biz_cycles_company ON biz_cycles(company_id, started_at DESC);

CREATE TABLE IF NOT EXISTS biz_agent_runs (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  cycle_id        TEXT,
  task_id         TEXT,
  role            TEXT NOT NULL,
  trigger_type    TEXT NOT NULL,
  status          TEXT NOT NULL,
  stop_reason     TEXT,
  goal            TEXT NOT NULL DEFAULT '',
  output          TEXT,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  credits         REAL NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_biz_runs_company ON biz_agent_runs(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_biz_runs_cycle ON biz_agent_runs(cycle_id);

CREATE TABLE IF NOT EXISTS biz_run_steps (
  id                   TEXT PRIMARY KEY,
  run_id               TEXT NOT NULL REFERENCES biz_agent_runs(id) ON DELETE CASCADE,
  seq_no               INTEGER NOT NULL,
  phase                TEXT NOT NULL,
  step_kind            TEXT NOT NULL,
  iteration            INTEGER NOT NULL DEFAULT 0,
  prompt_snippet       TEXT,
  content              TEXT,
  tool_name            TEXT,
  tool_args_redacted   TEXT,
  tool_result_redacted TEXT,
  ok                   INTEGER,
  model                TEXT,
  tokens_in            INTEGER NOT NULL DEFAULT 0,
  tokens_out           INTEGER NOT NULL DEFAULT 0,
  cost_usd             REAL NOT NULL DEFAULT 0,
  credits              REAL NOT NULL DEFAULT 0,
  duration_ms          INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  UNIQUE (run_id, seq_no)
);

CREATE TABLE IF NOT EXISTS biz_tasks (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  cycle_id          TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  assigned_role     TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 3,
  status            TEXT NOT NULL DEFAULT 'backlog',
  source            TEXT NOT NULL DEFAULT 'human',
  risk_level        TEXT NOT NULL DEFAULT 'low',
  estimated_credits REAL NOT NULL DEFAULT 0,
  approval_required INTEGER NOT NULL DEFAULT 0,
  approved_at       INTEGER,
  rejected_reason   TEXT,
  result            TEXT,
  source_run_id     TEXT,
  due_at            INTEGER,
  completed_at      INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_tasks_company ON biz_tasks(company_id, status);

CREATE TABLE IF NOT EXISTS biz_pending_actions (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  cycle_id        TEXT,
  run_id          TEXT,
  task_id         TEXT,
  role            TEXT NOT NULL,
  skill_key       TEXT NOT NULL,
  category        TEXT NOT NULL,
  risk_level      TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  args_enc        TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  gate            TEXT NOT NULL DEFAULT 'approval',
  idempotency_key TEXT NOT NULL UNIQUE,
  credits         REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'pending',
  execute_after   INTEGER,
  decided_by      TEXT,
  decided_at      INTEGER,
  decision_note   TEXT,
  result          TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_pending_company ON biz_pending_actions(company_id, status);

CREATE TABLE IF NOT EXISTS biz_skill_executions (
  idempotency_key TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  skill_key       TEXT NOT NULL,
  status          TEXT NOT NULL,
  result          TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
);

CREATE TABLE IF NOT EXISTS biz_knowledge (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  content       TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'note',
  source        TEXT NOT NULL DEFAULT '',
  source_run_id TEXT,
  confidence    REAL NOT NULL DEFAULT 0.6,
  active        INTEGER NOT NULL DEFAULT 1,
  embedding     BLOB,
  embed_model   TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_knowledge_company ON biz_knowledge(company_id, active);

CREATE TABLE IF NOT EXISTS biz_learned_rules (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  condition        TEXT NOT NULL,
  action           TEXT NOT NULL,
  rationale        TEXT NOT NULL DEFAULT '',
  polarity         TEXT NOT NULL DEFAULT 'do',
  confidence       REAL NOT NULL DEFAULT 0.5,
  source_run_id    TEXT,
  source_action_id TEXT,
  proposed_by      TEXT NOT NULL DEFAULT 'agent',
  status           TEXT NOT NULL DEFAULT 'proposed',
  created_at       INTEGER NOT NULL,
  decided_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_biz_rules_company ON biz_learned_rules(company_id, status);

-- Owner-added constitutional constraints. Agents have no write path here.
CREATE TABLE IF NOT EXISTS biz_constraints (
  id         TEXT PRIMARY KEY,
  company_id TEXT REFERENCES biz_companies(id) ON DELETE CASCADE,
  rule       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS biz_drafts (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  run_id     TEXT,
  kind       TEXT NOT NULL,
  channel    TEXT NOT NULL DEFAULT '',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_drafts_company ON biz_drafts(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS biz_leads (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL,
  company_name      TEXT NOT NULL DEFAULT '',
  source            TEXT NOT NULL DEFAULT '',
  signal            TEXT NOT NULL DEFAULT '',
  icp_reason        TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'new',
  last_contacted_at INTEGER,
  created_at        INTEGER NOT NULL,
  UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS biz_tickets (
  id             TEXT PRIMARY KEY,
  company_id     TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  customer       TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open',
  priority       TEXT NOT NULL DEFAULT 'normal',
  tags           TEXT NOT NULL DEFAULT '[]',
  draft_reply_id TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS biz_outbound_log (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,
  recipient  TEXT NOT NULL,
  ref_id     TEXT,
  sent_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_outbound_recipient ON biz_outbound_log(company_id, recipient, sent_at);
CREATE INDEX IF NOT EXISTS idx_biz_outbound_channel ON biz_outbound_log(company_id, channel, sent_at);

CREATE TABLE IF NOT EXISTS biz_kpis (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT NOT NULL DEFAULT '',
  source      TEXT NOT NULL DEFAULT '',
  captured_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_kpis_company ON biz_kpis(company_id, key, captured_at DESC);

CREATE TABLE IF NOT EXISTS biz_credits_ledger (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  delta         REAL NOT NULL,
  balance_after REAL NOT NULL,
  reason        TEXT NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  note          TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_ledger_company ON biz_credits_ledger(company_id, created_at);

CREATE TABLE IF NOT EXISTS biz_usage_events (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  cycle_id      TEXT,
  run_id        TEXT,
  role          TEXT,
  alias         TEXT,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  credits       REAL NOT NULL DEFAULT 0,
  ok            INTEGER NOT NULL DEFAULT 1,
  error         TEXT,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_usage_company ON biz_usage_events(company_id, created_at);

CREATE TABLE IF NOT EXISTS biz_audit (
  id            TEXT PRIMARY KEY,
  company_id    TEXT,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL DEFAULT '',
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id   TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_audit_company ON biz_audit(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS biz_cron_state (
  job_name        TEXT PRIMARY KEY,
  company_id      TEXT,
  last_run_at     INTEGER,
  next_run_at     INTEGER,
  lock_holder     TEXT,
  lock_expires_at INTEGER,
  succeeded       INTEGER,
  last_error      TEXT
);

CREATE TABLE IF NOT EXISTS biz_notifications (
  id           TEXT PRIMARY KEY,
  company_id   TEXT REFERENCES biz_companies(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued',
  created_at   INTEGER NOT NULL,
  sent_at      INTEGER
);

CREATE TABLE IF NOT EXISTS biz_feed (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  cycle_id   TEXT,
  run_id     TEXT,
  role       TEXT,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  credits    REAL,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_biz_feed_company ON biz_feed(company_id, ts);

CREATE TABLE IF NOT EXISTS biz_chat_sessions (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES biz_companies(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Chat with the CEO',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS biz_chat_messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES biz_chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  run_id     TEXT,
  created_at INTEGER NOT NULL
);
