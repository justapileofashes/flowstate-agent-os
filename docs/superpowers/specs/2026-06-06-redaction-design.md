# Phase 1d — Sensitive-data Redaction — Design

Date: 2026-06-06
Branch: session/connector-hardening
Builds on: 1a audit log (summarizeArgs).

## Goal
Make sure the governance/audit layer never persists secrets or PII. A reusable local
`redactSensitive(text)` masks emails, tokens/keys, credit-card / SSN-like numbers, and
private-key blocks. Applied to the audit log's arg summaries.

## Scope decision
- "Bias detection" from the original ask needs a model judgment, not regex — deferred (noted in
  the roadmap). This slice does the tractable, high-value part: deterministic PII/secret
  redaction, fully local.
- We redact the audit log (a record) — NOT the content the agent reads/edits. Redacting tool
  inputs/outputs the agent operates on would corrupt its work; that stays out of scope.

## Components
- `services/redaction.ts` (pure):
  - `redactSensitive(text: string): string` — runs an ordered detector list (specific →
    generic) and replaces matches with `<email>`, `<token>`, `<card>`, `<ssn>`, `<key>`,
    `<secret>`. Never throws; returns input unchanged when nothing matches.
  - Detectors: email; `-----BEGIN … PRIVATE KEY-----` blocks; AWS access-key (`AKIA…`);
    bearer/authorization tokens; `key=…` / `token=…` / `secret=…` / `password=…` assignments;
    13–19 digit card-like runs; `NNN-NN-NNNN` SSN; long (≥24) hex/base64 token blobs.
- `services/audit-logger.ts`: `summarizeArgs` pipes each kept plain string value through
  `redactSensitive` before it is stored. Blob keys stay length-hinted as before.

## Error handling / false positives
- Order detectors specific-first so an email isn't half-masked by the token rule.
- The long-blob rule requires ≥24 chars to avoid masking ordinary identifiers; card/SSN use
  boundaries. Over-redaction in an audit summary is acceptable (the summary is a hint, not data).

## Testing (local, no sqlite)
- `tests/main/services/redaction.test.ts`: each detector masks its target; plain text and
  file paths pass through unchanged; a shell command with an inline bearer token is masked;
  idempotent (running twice changes nothing).
- extend `audit-logger.test.ts`: a `command` containing a token comes out masked in the summary.

## Verification
Typecheck clean (node + web); redaction + logger tests green. Manual: audit a tool call whose
args include an email/token, confirm the Audit log shows `<email>` / `<token>`, not the value.
