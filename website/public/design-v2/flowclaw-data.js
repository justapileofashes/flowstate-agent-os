/* =========================================================
   flowclaw — control-plane data for self-hosted agent gateways.
   In the real app this comes from ipc.flowclaw.* (see notes at bottom).
   Here it's seeded so the prototype is interactive.
   ========================================================= */

window.FLOWCLAW_DATA = {
  // Local Ollama models already on this machine (Flowstate runs Ollama)
  localModels: [
    "qwen2.5:32b", "qwen2.5-coder:32b", "qwen2.5-coder:14b",
    "deepseek-r1:14b", "llama3.1:8b", "gemma3:12b"
  ],

  // Models a gateway advertises (merged with local in the picker)
  gatewayModels: {
    openclaw: ["claude-sonnet-4.5", "claude-opus-4", "qwen2.5:32b"],
    hermes:   ["gpt-5", "gpt-4.1", "o4-mini", "llama3.1:8b"]
  },

  connections: [
    {
      id: "oc-local",
      kind: "openclaw",
      label: "OpenClaw · local",
      host: "127.0.0.1",
      port: 18789,
      scheme: "ws",
      auth: "bearer",
      hasSecret: true,
      model: "claude-sonnet-4.5",
      status: "connected",        // connected | connecting | error | disabled
      latencyMs: 12,
      lastChecked: "32s ago"
    },
    {
      id: "hermes-prod",
      kind: "hermes",
      label: "Hermes · workstation",
      host: "192.168.1.42",
      port: 8080,
      scheme: "http",
      auth: "apikey",
      hasSecret: true,
      model: "llama3.1:8b",
      status: "error",
      error: "gateway unreachable — connection refused",
      lastChecked: "1m ago"
    },
    {
      id: "hermes-local",
      kind: "hermes",
      label: "Hermes · laptop",
      host: "127.0.0.1",
      port: 8080,
      scheme: "http",
      auth: "apikey",
      hasSecret: true,
      model: "llama3.1:8b",
      status: "connected",
      latencyMs: 9,
      lastChecked: "12s ago"
    },
    {
      id: "oc-pi",
      kind: "openclaw",
      label: "OpenClaw · home server",
      host: "10.0.0.7",
      port: 18789,
      scheme: "ws",
      auth: "bearer",
      hasSecret: true,
      model: "qwen2.5:32b",
      status: "disabled",
      lastChecked: "—"
    }
  ],

  tasks: [
    {
      id: "t-standup",
      name: "Morning standup digest",
      backend: "openclaw",
      connectionId: "oc-local",
      model: "claude-sonnet-4.5",
      schedule: "0 9 * * 1-5",
      scheduleLabel: "Weekdays · 9:00 AM",
      nextRun: "Tomorrow 9:00 AM",
      lastStatus: "ok",          // ok | failed | running | never
      lastRun: "Today 9:00 AM"
    },
    {
      id: "t-deps",
      name: "Nightly dependency audit",
      backend: "local",
      connectionId: null,
      model: "qwen2.5-coder:32b",
      schedule: "0 2 * * *",
      scheduleLabel: "Daily · 2:00 AM",
      nextRun: "Tonight 2:00 AM",
      lastStatus: "failed",
      lastRun: "Today 2:00 AM"
    },
    {
      id: "t-inbox",
      name: "Triage support inbox",
      backend: "hermes",
      connectionId: "hermes-prod",
      model: "llama3.1:8b",
      schedule: "*/30 * * * *",
      scheduleLabel: "Every 30 min",
      nextRun: "in 18 min",
      lastStatus: "running",
      lastRun: "12 min ago"
    },
    {
      id: "t-backup",
      name: "Weekly vault summary",
      backend: "openclaw",
      connectionId: "oc-local",
      model: "claude-opus-4",
      schedule: "0 18 * * 5",
      scheduleLabel: "Fridays · 6:00 PM",
      nextRun: "Fri 6:00 PM",
      lastStatus: "ok",
      lastRun: "Last Fri"
    }
  ],

  // a sample live run log (streamed line-by-line in the prototype)
  runLog: [
    { t: "09:00:00", level: "info", msg: "run started · task=Morning standup digest" },
    { t: "09:00:00", level: "info", msg: "backend=openclaw ws://127.0.0.1:18789 model=claude-sonnet-4.5" },
    { t: "09:00:01", level: "dim",  msg: "→ POST /v1/chat/completions (stream)" },
    { t: "09:00:01", level: "dim",  msg: "tool: read_calendar(range=today)" },
    { t: "09:00:02", level: "out",  msg: "Pulled 6 events, 3 PRs awaiting review, 2 blockers." },
    { t: "09:00:03", level: "dim",  msg: "tool: read_linear(filter=assigned)" },
    { t: "09:00:04", level: "out",  msg: "Drafting digest…" },
    { t: "09:00:05", level: "out",  msg: "## Standup — Wed May 14" },
    { t: "09:00:05", level: "out",  msg: "Focus: ship auth rotation behind flag." },
    { t: "09:00:06", level: "good", msg: "✓ delivered to #standup · 412 tokens · $0.0021" },
    { t: "09:00:06", level: "info", msg: "run complete in 6.2s" }
  ]
};
