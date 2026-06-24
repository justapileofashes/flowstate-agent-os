/* =========================================================
   devtools-ipc.js — stub IPC for the vibe-dev feature pack.

   In the real app these are typed in src/renderer/src/lib/ipc.ts
   as ipc.devtools.* and implemented in the main process. Here
   they're simulated so the prototype behaves identically:
   canceled/empty results are silent no-ops, thrown errors
   surface in the existing hint/error style.

   Plain script — no React. Loaded before the jsx.
   ========================================================= */
(function () {
  window.ipc = window.ipc || {};
  window.ipc.devtools = window.ipc.devtools || {};
  window.ipc.files = window.ipc.files || {};

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  /* ---- seed state (lives only for the session) ---- */
  let SNIPPETS = [
    { id: "s1", name: "pr-review",  label: "PR review",      body: "Review this PR for {{focus|correctness}}. List issues by severity, worst first. Repo: {{repo}}." },
    { id: "s2", name: "commit-msg", label: "Commit message", body: "Write a conventional commit for the staged diff. Scope: {{scope|auth}}. One line, imperative mood." },
    { id: "s3", name: "standup",    label: "Daily standup",  body: "Summarize everything that changed since {{date}} as terse standup bullets. Flag anything blocked." },
    { id: "s4", name: "explain",    label: "Explain file",   body: "Walk me through {{path}} top to bottom. Call out anything surprising or risky." }
  ];

  let COMMANDS = [
    { cmd: "/plan",    label: "Plan",        hint: "Draft a step plan before editing", template: "Make a numbered, minimal plan for: {{input}}\nDo not write any code yet — wait for my go-ahead." },
    { cmd: "/tidy",    label: "Tidy diff",   hint: "Clean up the working changes",     template: "Review the current diff and tidy it: naming, dead code, stray logs. Keep behavior identical.\n{{input}}" },
    { cmd: "/explain", label: "Explain",     hint: "Explain selection or topic",       template: "Explain this clearly, with one short example: {{input}}" }
  ];

  /* simulated real spend (USD) read by the budget guard */
  const USAGE = { perChatUsd: 4.12, perDayUsd: 18.40 };
  let CAPS = { perChatUsd: 5, perDayUsd: 25 };

  let PINS = ["Today-0"]; // chat ids (matches sidebar `${date}-${i}`)

  let HISTORY = [
    "Add replay-attack tests for the rotation flow",
    "Why is the migration backfill slow on prod?",
    "Draft the rollout guide section for auth.md"
  ];

  const WORKSPACE = [
    "server/auth/refresh.py",
    "server/auth/session.py",
    "server/auth/models.py",
    "server/db/migrations/0042_rotation.py",
    "server/middleware/ratelimit.py",
    "tests/test_refresh.py",
    "tests/conftest.py",
    "AGENTS.md",
    "README.md",
    "package.json",
    "src/app.tsx"
  ];

  /* ============ Surface 1 · prompt snippets ============ */
  window.ipc.devtools.listSnippets = async () => {
    await wait(120);
    return { snippets: SNIPPETS.map((s) => ({ ...s })) };
  };
  window.ipc.devtools.saveSnippet = async ({ id, name, label, body }) => {
    await wait(220);
    name = (name || "").trim();
    if (!name) return { ok: false, error: "Name is required." };
    if (!KEBAB.test(name)) return { ok: false, error: "Name must be lowercase-kebab (e.g. pr-review)." };
    if (!(body || "").trim()) return { ok: false, error: "Body can’t be empty." };
    const clash = SNIPPETS.find((s) => s.name === name && s.id !== id);
    if (clash) return { ok: false, error: `“${name}” is already taken.` };
    if (id) {
      const i = SNIPPETS.findIndex((s) => s.id === id);
      if (i >= 0) SNIPPETS[i] = { id, name, label: label || name, body };
    } else {
      SNIPPETS.push({ id: "s" + Date.now(), name, label: label || name, body });
    }
    return { ok: true };
  };
  window.ipc.devtools.deleteSnippet = async (id) => {
    await wait(160);
    SNIPPETS = SNIPPETS.filter((s) => s.id !== id);
    return { ok: true };
  };

  /* ============ Surface 2 · custom slash commands ============ */
  window.ipc.devtools.listCommands = async () => {
    await wait(120);
    return { commands: COMMANDS.map((c) => ({ ...c })) };
  };
  window.ipc.devtools.saveCommands = async (commands) => {
    await wait(240);
    for (const c of commands || []) {
      if (!/^\/[a-z][a-z0-9-]*$/i.test((c.cmd || "").trim()))
        return { ok: false, error: `“${c.cmd || "—"}” isn’t a valid command (use /name).` };
      if (!(c.template || "").trim())
        return { ok: false, error: `${c.cmd} needs a template.` };
    }
    COMMANDS = (commands || []).map((c) => ({
      cmd: c.cmd.trim(), label: (c.label || "").trim() || c.cmd.trim(),
      hint: (c.hint || "").trim(), template: c.template
    }));
    return { ok: true };
  };

  /* ============ Surface 3 · spend budget guard ============ */
  window.ipc.devtools.getBudgetCaps = async () => {
    await wait(100);
    return { ...CAPS };
  };
  window.ipc.devtools.setBudgetCaps = async (perChatUsd, perDayUsd) => {
    await wait(180);
    CAPS = {
      perChatUsd: Math.max(0, Number(perChatUsd) || 0),
      perDayUsd: Math.max(0, Number(perDayUsd) || 0)
    };
    return { ok: true };
  };
  window.ipc.devtools.evaluateBudget = async (/* chatId */) => {
    await wait(130);
    const ratios = [];
    if (CAPS.perChatUsd > 0) ratios.push({ scope: "chat", r: USAGE.perChatUsd / CAPS.perChatUsd, used: USAGE.perChatUsd, cap: CAPS.perChatUsd });
    if (CAPS.perDayUsd > 0)  ratios.push({ scope: "day",  r: USAGE.perDayUsd  / CAPS.perDayUsd,  used: USAGE.perDayUsd,  cap: CAPS.perDayUsd });
    if (!ratios.length) return { level: "ok" };
    const worst = ratios.sort((a, b) => b.r - a.r)[0];
    const money = (n) => "$" + n.toFixed(2);
    const span = worst.scope === "chat" ? "this chat" : "today";
    const poss = worst.scope === "chat" ? "this chat’s" : "today’s";
    if (worst.r >= 1)
      return { level: "block", scope: worst.scope, message: `Spend cap reached for ${span} — ${money(worst.used)} of ${money(worst.cap)}.` };
    if (worst.r >= 0.8)
      return { level: "warn", scope: worst.scope, message: `${Math.round(worst.r * 100)}% of ${poss} budget used — ${money(worst.used)} of ${money(worst.cap)}.` };
    return { level: "ok" };
  };

  /* ============ Surface 4 · @file mentions ============ */
  window.ipc.files.list = async (/* agentId */) => {
    await wait(90);
    return { files: WORKSPACE.slice() };
  };
  window.ipc.devtools.resolveMentions = async (agentId, text) => {
    await wait(160);
    const raw = [...String(text || "").matchAll(/(?:^|\s)@([^\s]+)/g)].map((m) => m[1]);
    const paths = [];
    for (const r of raw) {
      const hit = WORKSPACE.find((f) => f === r || f.endsWith("/" + r) || f.split("/").pop() === r);
      if (hit && !paths.includes(hit)) paths.push(hit);
    }
    const contextBlock = paths.length
      ? "<workspace-context>\n" + paths.map((p) => `# ${p}\n…(${p.split("/").pop()} contents)…`).join("\n\n") + "\n</workspace-context>\n\n"
      : "";
    return { paths, contextBlock };
  };

  /* ============ Surface 5 · project conventions ============ */
  window.ipc.devtools.loadProjectContext = async (/* agentId */) => {
    await wait(140);
    return {
      files: ["AGENTS.md", "README.md"],
      preamble:
        "House style (from AGENTS.md): conventional commits; pytest for tests; " +
        "no print() debugging; migrations are append-only. Prefer async DB calls."
    };
  };

  /* ============ Surface 6 · token preflight ============ */
  const CTX = { "claude-sonnet-4.5": 200000, "claude-opus-4": 200000, "qwen2.5-coder:32b": 32768, "qwen2.5:32b": 32768, "deepseek-r1:14b": 65536 };
  window.ipc.devtools.preflight = async (text, contextChars, model) => {
    await wait(80);
    const chars = String(text || "").length + (Number(contextChars) || 0);
    const estTokens = Math.ceil(chars / 4);
    const window_ = CTX[model] || (model ? 128000 : 0);
    if (!window_) return { estTokens, level: "unknown" };
    const r = estTokens / window_;
    const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
    if (r >= 1) return { estTokens, level: "over", message: `~${k(estTokens)} tokens exceeds ${model}’s ${k(window_)} window.` };
    if (r >= 0.75) return { estTokens, level: "warn", message: `~${k(estTokens)} tokens — close to ${model}’s ${k(window_)} limit.` };
    return { estTokens, level: "ok" };
  };

  /* ============ Surface 7 · environment doctor ============ */
  window.ipc.devtools.runDoctor = async () => {
    await wait(1150);
    const checks = [
      { id: "ollama",   label: "Ollama daemon",       status: "pass", detail: "v0.3.12 · responding on 127.0.0.1:11434" },
      { id: "models",   label: "Default models present", status: "pass", detail: "qwen2.5:32b, qwen2.5-coder:32b installed" },
      { id: "vram",     label: "GPU headroom",        status: "warn", detail: "7.4 / 24 GB VRAM in use", hint: "Close other GPU apps before large parallel runs." },
      { id: "disk",     label: "Disk space",          status: "pass", detail: "1.2 TB free of 4 TB" },
      { id: "cloud",    label: "Cloud keys",          status: "warn", detail: "Anthropic connected · 4 providers unconfigured", hint: "Add keys in Settings → Cloud models to route overflow." },
      { id: "workspace",label: "Workspace writable",  status: "pass", detail: "C:\\Users\\bryce\\Flowstate" },
      { id: "mcp",      label: "MCP servers",         status: "pass", detail: "github-mcp, filesystem-mcp running" }
    ];
    const overall = checks.some((c) => c.status === "fail") ? "fail"
      : checks.some((c) => c.status === "warn") ? "warn" : "pass";
    return { overall, checks };
  };

  /* ============ Surface 8 · pinned chats ============ */
  window.ipc.devtools.listPins = async () => {
    await wait(80);
    return { pinned: PINS.slice() };
  };
  window.ipc.devtools.togglePin = async (chatId) => {
    await wait(120);
    PINS = PINS.includes(chatId) ? PINS.filter((p) => p !== chatId) : [...PINS, chatId];
    return { pinned: PINS.slice() };
  };

  /* ============ Surface 9 · composer prompt history ============ */
  window.ipc.devtools.getHistory = async () => {
    await wait(70);
    return { history: HISTORY.slice() };
  };
  window.ipc.devtools.pushHistory = async (entry) => {
    await wait(60);
    entry = String(entry || "").trim();
    if (entry) HISTORY = [entry, ...HISTORY.filter((h) => h !== entry)].slice(0, 50);
    return { history: HISTORY.slice() };
  };

  /* ---- shared client helper: expand snippet/command vars for preview/insert.
     (Real expansion is the backend's job at send; this mirrors it so the
     prototype can show the resolved text.) ---- */
  window.devtoolsExpand = function (body, vars) {
    vars = vars || {};
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const builtins = { date, time, datetime: `${date} ${time}` };
    return String(body || "").replace(/\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_, name, def) => {
      name = name.trim();
      if (name in builtins) return builtins[name];
      if (vars[name] != null && vars[name] !== "") return vars[name];
      return def != null ? def : "";
    });
  };
  /* parse var descriptors from a body: [{name, def}] (builtins excluded) */
  window.devtoolsVars = function (body) {
    const out = [];
    const seen = new Set();
    const builtins = new Set(["date", "time", "datetime"]);
    const re = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;
    let m;
    while ((m = re.exec(String(body || "")))) {
      const name = m[1].trim();
      if (builtins.has(name) || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, def: m[2] != null ? m[2].trim() : "" });
    }
    return out;
  };
})();
