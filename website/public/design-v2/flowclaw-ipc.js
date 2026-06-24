/* =========================================================
   flowclaw-ipc.js — stub for window.flowstate.flowclaw.*

   The 7 agent capabilities flowclaw drives over OpenClaw / Hermes
   gateways. In the real app these are typed in ipc.ts and implemented
   over the gateway; here they're simulated so the prototype behaves
   identically (latency, pending, error + empty states).

   Plain script — loaded before the jsx. Matches the typed contract:
     runTask · listAutomations · createAutomation · deleteAutomation ·
     toggleAutomation · listSkills · installSkill · memoryGet · memorySet ·
     listFiles · readFile · search · sendMessage
   ========================================================= */
(function () {
  window.flowstate = window.flowstate || {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();
  const MIN = 60000;

  /* ---------- #1 autonomous task execution ---------- */
  async function runTask(connectionId, prompt, model) {
    await wait(1400 + Math.random() * 700);
    const p = String(prompt || "").trim();
    if (!p) return { ok: false, error: "Prompt is empty — nothing to run." };
    if (/\bfail\b/i.test(p)) return { ok: false, error: "Gateway returned 502 — upstream model timed out after 30s." };
    const m = model || "claude-sonnet-4.5";
    const text =
      `▸ task accepted · model=${m}\n` +
      `▸ planning… 3 steps\n\n` +
      `1. Parsed request: “${p.length > 64 ? p.slice(0, 64) + "…" : p}”\n` +
      `2. Ran 2 tools (read_workspace, search) · 6 results\n` +
      `3. Synthesized answer\n\n` +
      `Done. The gateway completed the task autonomously and wrote a summary to ` +
      `/reports/last-run.md. 412 tokens · $0.0021 · 5.9s.`;
    return { ok: true, text };
  }

  /* ---------- #2 scheduled automations (cron) ---------- */
  let AUTOMATIONS = [
    { id: "au-standup", connectionId: "oc-local", label: "Morning standup digest",
      prompt: "Summarize my calendar, open PRs and blockers into a terse standup. Post to #standup.",
      intervalMinutes: 1440, enabled: true, deliverTo: "#standup",
      createdAt: now() - 9 * 24 * 60 * MIN, nextRunAt: now() + 47 * MIN, lastRunAt: now() - 19 * 60 * MIN,
      lastResult: "Posted digest to #standup — 6 events, 3 PRs awaiting review, 2 blockers flagged." },
    { id: "au-inbox", connectionId: "oc-local", label: "Triage support inbox",
      prompt: "Read new support emails, label by urgency, draft replies for the top 3.",
      intervalMinutes: 30, enabled: true, deliverTo: "#support",
      createdAt: now() - 3 * 24 * 60 * MIN, nextRunAt: now() + 12 * MIN, lastRunAt: now() - 18 * MIN,
      lastResult: "9 new tickets · 2 urgent · drafted 3 replies for review." },
    { id: "au-deps", connectionId: "oc-local", label: "Nightly dependency audit",
      prompt: "Run npm audit + pip-audit across repos, summarize new CVEs by severity.",
      intervalMinutes: 1440, enabled: false, deliverTo: "",
      createdAt: now() - 21 * 24 * 60 * MIN, nextRunAt: now() + 6 * 60 * MIN, lastRunAt: now() - 26 * 60 * MIN,
      lastResult: "FAILED — registry timeout on 2 of 5 repos. Retried, still 1 failure." },
    { id: "au-hermes", connectionId: "hermes-prod", label: "Weekly metrics rollup",
      prompt: "Pull weekly product metrics and write a one-paragraph exec summary.",
      intervalMinutes: 10080, enabled: true, deliverTo: "email:team@",
      createdAt: now() - 30 * 24 * 60 * MIN, nextRunAt: now() + 3 * 24 * 60 * MIN, lastRunAt: now() - 4 * 24 * 60 * MIN,
      lastResult: "Sent rollup to team@ — WAU +4.2%, latency p95 down 11%." }
  ];
  async function listAutomations() { await wait(180); return { automations: AUTOMATIONS.map((a) => ({ ...a })) }; }
  async function createAutomation({ connectionId, label, prompt, intervalMinutes, deliverTo }) {
    await wait(280);
    const iv = Math.max(1, Math.round(Number(intervalMinutes) || 0));
    if (!label || !prompt || !iv) return { ok: false, error: "Label, prompt and interval are all required." };
    AUTOMATIONS = [...AUTOMATIONS, {
      id: "au-" + now(), connectionId, label, prompt, intervalMinutes: iv,
      enabled: true, deliverTo: deliverTo || "", createdAt: now(),
      nextRunAt: now() + iv * MIN, lastRunAt: null, lastResult: null
    }];
    return { ok: true };
  }
  async function deleteAutomation(id) { await wait(180); AUTOMATIONS = AUTOMATIONS.filter((a) => a.id !== id); return { ok: true }; }
  async function toggleAutomation(id, enabled) {
    await wait(160);
    AUTOMATIONS = AUTOMATIONS.map((a) => (a.id === id ? { ...a, enabled, nextRunAt: enabled ? now() + a.intervalMinutes * MIN : a.nextRunAt } : a));
    return { ok: true };
  }

  /* ---------- #3 skills (ClawHub) ---------- */
  let SKILLS = [
    { id: "sk-gh",      name: "GitHub",            description: "Open PRs, review diffs, manage issues and releases.", installed: true },
    { id: "sk-linear",  name: "Linear",            description: "Read and update issues, cycles and projects.", installed: true },
    { id: "sk-slack",   name: "Slack",             description: "Post messages, read channels, summarize threads.", installed: false },
    { id: "sk-gcal",    name: "Google Calendar",   description: "Read availability, schedule and move events.", installed: true },
    { id: "sk-notion",  name: "Notion",            description: "Query databases, append blocks, sync notes.", installed: false },
    { id: "sk-jira",    name: "Jira",              description: "Triage tickets, transition statuses, log work.", installed: false },
    { id: "sk-pg",      name: "Postgres",          description: "Run read-only queries against a connected DB.", installed: false },
    { id: "sk-stripe",  name: "Stripe",            description: "Look up customers, invoices and subscription state.", installed: false },
    { id: "sk-aws",     name: "AWS",               description: "Inspect S3, CloudWatch logs and ECS services.", installed: false },
    { id: "sk-pdf",     name: "PDF tools",         description: "Extract text, split and merge documents.", installed: true },
    { id: "sk-web",     name: "Web scraper",       description: "Fetch and clean pages into markdown.", installed: false },
    { id: "sk-yt",      name: "YouTube transcript", description: "Pull and summarize video transcripts.", installed: false },
    { id: "sk-fig",     name: "Figma",             description: "Read frames, export assets, inspect tokens.", installed: false },
    { id: "sk-sheets",  name: "Google Sheets",     description: "Read ranges, append rows, run lightweight reports.", installed: false }
  ];
  async function listSkills(connectionId, query) {
    await wait(360);
    const q = String(query || "").trim().toLowerCase();
    let out = SKILLS.map((s) => ({ ...s }));
    if (q) out = out.filter((s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q));
    return { skills: out };
  }
  async function installSkill(connectionId, skillId) {
    await wait(700);
    SKILLS = SKILLS.map((s) => (s.id === skillId ? { ...s, installed: true } : s));
    return { ok: true };
  }

  /* ---------- #4 long-term memory ---------- */
  const MEMORY = {
    "user.timezone": "America/Los_Angeles",
    "user.name": "Bryce",
    "project.repo": "github.com/flowstate/app",
    "standup.channel": "#standup",
    "tone.preference": "terse, no preamble, lead with the answer"
  };
  async function memoryGet(connectionId, key) {
    await wait(220);
    const k = String(key || "").trim();
    return { value: Object.prototype.hasOwnProperty.call(MEMORY, k) ? MEMORY[k] : null };
  }
  async function memorySet(connectionId, key, value) {
    await wait(260);
    const k = String(key || "").trim();
    if (!k) return { ok: false, error: "Key is required." };
    MEMORY[k] = String(value == null ? "" : value);
    return { ok: true };
  }

  /* ---------- #5 cloud file workspace (40GB) ---------- */
  const TREE = {
    "/": [
      { path: "/reports", kind: "dir" },
      { path: "/datasets", kind: "dir" },
      { path: "/models", kind: "dir" },
      { path: "/notes.md", kind: "file", size: 4120 },
      { path: "/standup-2026-06.md", kind: "file", size: 18840 },
      { path: "/budget.csv", kind: "file", size: 920 }
    ],
    "/reports": [
      { path: "/reports/q2-summary.md", kind: "file", size: 31200 },
      { path: "/reports/audit.log", kind: "file", size: 220400 },
      { path: "/reports/last-run.md", kind: "file", size: 2240 }
    ],
    "/datasets": [
      { path: "/datasets/users.parquet", kind: "file", size: 84934656 },
      { path: "/datasets/events.parquet", kind: "file", size: 1288490188 },
      { path: "/datasets/raw", kind: "dir" }
    ],
    "/datasets/raw": [
      { path: "/datasets/raw/2026-06-12.jsonl", kind: "file", size: 9437184 },
      { path: "/datasets/raw/2026-06-13.jsonl", kind: "file", size: 10485760 }
    ],
    "/models": [
      { path: "/models/classifier.gguf", kind: "file", size: 4831838208 },
      { path: "/models/embeddings.bin", kind: "file", size: 268435456 }
    ]
  };
  const FILE_CONTENT = {
    "/notes.md": "# Working notes\n\n- Ship auth rotation behind a flag this week.\n- Migrate Postgres → Litestream for the read replica.\n- Flowclaw: wire the 7 capability panels.\n",
    "/standup-2026-06.md": "# Standup — June\n\n## Wed 06/13\nFocus: ship auth rotation behind flag.\n- 6 calendar events\n- 3 PRs awaiting review\n- 2 blockers (CI flake, staging DB)\n",
    "/budget.csv": "month,cloud_usd,local_kwh\n2026-04,182.40,61\n2026-05,201.10,68\n2026-06,93.80,40\n",
    "/reports/q2-summary.md": "# Q2 summary\n\nWAU up 4.2% QoQ. p95 latency down 11% after the caching change.\nCloud spend trended down as more runs moved to local Ollama.\n",
    "/reports/audit.log": "[ok]   2026-06-13 02:00  npm audit · 0 new criticals\n[warn] 2026-06-13 02:01  pip-audit · 1 high (urllib3)\n[ok]   2026-06-13 02:02  done in 41s\n",
    "/reports/last-run.md": "# Last run\n\nTask completed autonomously. Summary written here by the gateway.\n"
  };
  function dirOf(p) { return p; }
  async function listFiles(connectionId, path) {
    await wait(300);
    const key = !path || path === "" ? "/" : path.replace(/\/+$/, "") || "/";
    const files = TREE[key] || [];
    return { files: files.map((f) => ({ ...f })) };
  }
  async function readFile(connectionId, path) {
    await wait(360);
    const content = FILE_CONTENT[path] != null
      ? FILE_CONTENT[path]
      : `// ${path}\n// Binary or large file — preview not available in this workspace stub.\n`;
    return { content };
  }

  /* ---------- #6 live search ---------- */
  async function search(connectionId, query, source) {
    await wait(620);
    const q = String(query || "").trim();
    if (!q) return { results: [] };
    const src = source || "Web";
    if (src === "Yahoo Finance") {
      return { results: [
        { title: `${q.toUpperCase()} — Quote · Yahoo Finance`, url: `https://finance.yahoo.com/quote/${encodeURIComponent(q)}`, snippet: "Real-time price, market cap, P/E, and after-hours movement." },
        { title: `${q.toUpperCase()} Analyst Ratings`, url: "https://finance.yahoo.com/", snippet: "12-month price targets and the latest upgrades and downgrades." },
        { title: `${q.toUpperCase()} Financials`, url: "https://finance.yahoo.com/", snippet: "Quarterly revenue, margins and free cash flow trend." }
      ] };
    }
    if (src === "X/Twitter") {
      return { results: [
        { title: `Latest posts about “${q}”`, url: `https://x.com/search?q=${encodeURIComponent(q)}`, snippet: "Top and most-recent posts, ranked by engagement in the last 24h." },
        { title: `People discussing ${q}`, url: "https://x.com/", snippet: "Accounts driving the conversation and their reach." }
      ] };
    }
    return { results: [
      { title: `${q} — overview`, url: `https://www.google.com/search?q=${encodeURIComponent(q)}`, snippet: `A concise, sourced overview of ${q} pulled live from the open web.` },
      { title: `${q}: documentation`, url: "https://example.com/docs", snippet: "Official docs and reference for getting started quickly." },
      { title: `Discussion: ${q}`, url: "https://news.ycombinator.com/", snippet: "Community threads weighing tradeoffs and real-world experience." },
      { title: `${q} — recent news`, url: "https://example.com/news", snippet: "The latest developments from the past week, summarized." }
    ] };
  }

  /* ---------- #7 chat integrations ---------- */
  async function sendMessage(connectionId, channel, text) {
    await wait(420);
    if (!channel || !String(channel).trim()) return { ok: false, error: "Pick a channel to send to." };
    if (!text || !String(text).trim()) return { ok: false, error: "Message is empty." };
    if (/\boffline\b/i.test(channel)) return { ok: false, error: "Channel’s messaging app is disconnected at the gateway." };
    return { ok: true };
  }

  window.flowstate.flowclaw = {
    runTask, listAutomations, createAutomation, deleteAutomation, toggleAutomation,
    listSkills, installSkill, memoryGet, memorySet, listFiles, readFile, search, sendMessage
  };
})();
