// Flowstate — full agent roster + session data
// Each agent has: name, model, tags, group, workshop (mascot's home),
// optional "deployed" flag for the live worldview.

const AGENTS = [
  // ============ CODE CORE ============
  { name: "Code Helper",          model: "claude-sonnet-4.5",   tags: ["edit", "code"],     group: "Code",       workshop: "programming",    glyph: "{}" },
  { name: "Code Reviewer",        model: "claude-opus-4",        tags: ["review"],            group: "Code",       workshop: "programming",    glyph: "✓" },
  { name: "Bug Hunter",           model: "deepseek-r1:14b",      tags: ["debug", "trace"],    group: "Code",       workshop: "programming",    glyph: "⊘" },
  { name: "Test Writer",          model: "qwen2.5-coder:14b",    tags: ["tests"],             group: "Code",       workshop: "programming",    glyph: "T" },
  { name: "Git Helper",           model: "llama3.1:8b",          tags: ["git", "vcs"],        group: "Code",       workshop: "programming",    glyph: "↗" },
  { name: "Regex Wizard",         model: "qwen2.5-coder:32b",    tags: ["regex"],             group: "Code",       workshop: "programming",    glyph: "/.*/" },
  { name: "Migration Helper",     model: "qwen2.5-coder:32b",    tags: ["db", "migrate"],     group: "Code",       workshop: "programming",    glyph: "→" },
  { name: "Performance Profiler", model: "deepseek-r1:14b",      tags: ["perf"],              group: "Code",       workshop: "programming",    glyph: "↻" },

  // ============ STACK ============
  { name: "Frontend Specialist",  model: "claude-sonnet-4.5",    tags: ["ui", "web"],         group: "Stack",      workshop: "infrastructure", glyph: "▣" },
  { name: "Backend Architect",    model: "claude-opus-4",        tags: ["api", "arch"],       group: "Stack",      workshop: "infrastructure", glyph: "▤" },
  { name: "SQL Helper",           model: "qwen2.5-coder:32b",    tags: ["sql", "db"],         group: "Stack",      workshop: "infrastructure", glyph: "≡" },
  { name: "Mobile Dev",           model: "claude-sonnet-4.5",    tags: ["ios", "android"],    group: "Stack",      workshop: "infrastructure", glyph: "▯" },
  { name: "Auth Specialist",      model: "claude-sonnet-4.5",    tags: ["auth"],              group: "Stack",      workshop: "infrastructure", glyph: "⊕" },
  { name: "Cloud Architect",      model: "claude-opus-4",        tags: ["aws", "cloud"],      group: "Stack",      workshop: "infrastructure", glyph: "☁" },
  { name: "Docker Helper",        model: "qwen2.5:14b",          tags: ["docker"],            group: "Stack",      workshop: "infrastructure", glyph: "⊟" },
  { name: "Kubernetes Wrangler",  model: "claude-sonnet-4.5",    tags: ["k8s"],               group: "Stack",      workshop: "infrastructure", glyph: "⎈" },

  // ============ KNOWLEDGE ============
  { name: "Researcher",           model: "claude-opus-4",        tags: ["search", "synth"],   group: "Knowledge",  workshop: "research",       glyph: "◎" },
  { name: "Tutor",                model: "claude-sonnet-4.5",    tags: ["teach"],             group: "Knowledge",  workshop: "research",       glyph: "?" },
  { name: "Brainstormer",         model: "claude-opus-4",        tags: ["ideate"],            group: "Knowledge",  workshop: "research",       glyph: "✻" },
  { name: "Writer",               model: "claude-sonnet-4.5",    tags: ["prose"],             group: "Knowledge",  workshop: "research",       glyph: "✎" },
  { name: "Doc Writer",           model: "llama3.1:8b",          tags: ["docs", "md"],        group: "Knowledge",  workshop: "research",       glyph: "¶" },
  { name: "Copywriter",           model: "claude-opus-4",        tags: ["marketing"],         group: "Knowledge",  workshop: "research",       glyph: "✦" },

  // ============ DESIGN / VIBE ============
  { name: "Vibe Designer",        model: "claude-opus-4",        tags: ["aesthetic"],         group: "Design",     workshop: "design",         glyph: "◐" },
  { name: "Component Crafter",    model: "claude-sonnet-4.5",    tags: ["components"],        group: "Design",     workshop: "design",         glyph: "▢" },
  { name: "Demo Animator",        model: "claude-sonnet-4.5",    tags: ["motion"],            group: "Design",     workshop: "design",         glyph: "▶" },
  { name: "Sketch to Code",       model: "claude-opus-4",        tags: ["convert"],           group: "Design",     workshop: "design",         glyph: "↳" },
  { name: "Theme Wizard",         model: "claude-sonnet-4.5",    tags: ["theme"],             group: "Design",     workshop: "design",         glyph: "◑" },
  { name: "Landing Page Pro",     model: "claude-opus-4",        tags: ["marketing", "ui"],   group: "Design",     workshop: "design",         glyph: "▭" },
  { name: "Image Editor",         model: "gemma3:12b",           tags: ["image"],             group: "Design",     workshop: "design",         glyph: "▦" },
  { name: "PDF Specialist",       model: "claude-opus-4",        tags: ["pdf"],               group: "Design",     workshop: "design",         glyph: "❑" },

  // ============ AUTOMATION ============
  { name: "Workflow Architect",   model: "claude-sonnet-4.5",    tags: ["flow"],              group: "Automation", workshop: "automation",     glyph: "⫶" },
  { name: "Scheduler",            model: "llama3.1:8b",          tags: ["cron"],              group: "Automation", workshop: "automation",     glyph: "⧖" },
  { name: "Webhook Wrangler",     model: "claude-sonnet-4.5",    tags: ["webhook"],           group: "Automation", workshop: "automation",     glyph: "⤴" },
  { name: "API Integrator",       model: "claude-sonnet-4.5",    tags: ["api"],               group: "Automation", workshop: "automation",     glyph: "⇄" },
  { name: "Browser Automator",    model: "claude-opus-4",        tags: ["puppeteer"],         group: "Automation", workshop: "automation",     glyph: "◧" },
  { name: "File Watcher",         model: "llama3.1:8b",          tags: ["fs"],                group: "Automation", workshop: "automation",     glyph: "◔" },
  { name: "Notifier",             model: "llama3.1:8b",          tags: ["push"],              group: "Automation", workshop: "automation",     glyph: "✉" },
  { name: "Pipeline Builder",     model: "claude-sonnet-4.5",    tags: ["ci"],                group: "Automation", workshop: "automation",     glyph: "▰" },
  { name: "GitHub Actions Architect", model: "claude-opus-4",    tags: ["ci", "gh"],          group: "Automation", workshop: "automation",     glyph: "⛁" },
  { name: "Bot Crafter",          model: "claude-sonnet-4.5",    tags: ["bot"],               group: "Automation", workshop: "automation",     glyph: "⌬" },
  { name: "Web Scraper",          model: "claude-sonnet-4.5",    tags: ["scrape"],            group: "Automation", workshop: "automation",     glyph: "◍" },
  { name: "AI Chain Builder",     model: "claude-opus-4",        tags: ["chain"],             group: "Automation", workshop: "automation",     glyph: "⫭" },

  // ============ OPS ============
  { name: "Ops",                  model: "claude-sonnet-4.5",    tags: ["ops"],               group: "Ops",        workshop: "terminal",       glyph: "$" },
  { name: "CLI Crafter",          model: "claude-sonnet-4.5",    tags: ["cli"],               group: "Ops",        workshop: "terminal",       glyph: ">_" },
  { name: "Config Wizard",        model: "llama3.1:8b",          tags: ["config"],            group: "Ops",        workshop: "terminal",       glyph: "⚙" },
  { name: "Observability Engineer", model: "claude-opus-4",      tags: ["logs"],              group: "Ops",        workshop: "terminal",       glyph: "⊙" },
  { name: "Security Auditor",     model: "claude-opus-4",        tags: ["security"],          group: "Ops",        workshop: "terminal",       glyph: "⚿" },

  // ============ BUILD / DATA ============
  { name: "Data Analyst",         model: "claude-sonnet-4.5",    tags: ["data", "stats"],     group: "Build",      workshop: "data",           glyph: "∑" },
  { name: "Project Planner",      model: "claude-opus-4",        tags: ["plan"],              group: "Build",      workshop: "data",           glyph: "◇" },
  { name: "Prototype Builder",    model: "claude-sonnet-4.5",    tags: ["proto"],             group: "Build",      workshop: "data",           glyph: "▢" },
  { name: "Mock API Builder",     model: "qwen2.5-coder:32b",    tags: ["mock", "api"],       group: "Build",      workshop: "data",           glyph: "⊞" },
  { name: "Game Jammer",          model: "claude-opus-4",        tags: ["game"],              group: "Build",      workshop: "data",           glyph: "♛" },

  // ============ OTHER ============
  { name: "Payment Integrator",   model: "claude-sonnet-4.5",    tags: ["stripe", "pay"],     group: "Other",      workshop: "workshop",       glyph: "$" },
  { name: "Accessibility Auditor",model: "claude-opus-4",        tags: ["a11y"],              group: "Other",      workshop: "workshop",       glyph: "◑" },
  { name: "SEO Helper",           model: "claude-sonnet-4.5",    tags: ["seo"],               group: "Other",      workshop: "workshop",       glyph: "▿" },
  { name: "i18n Helper",          model: "qwen2.5:14b",          tags: ["i18n"],              group: "Other",      workshop: "workshop",       glyph: "⇄" },
];

window.FLOW_DATA = {
  agents: AGENTS,

  // Currently deployed/running agents — drives the mascot worldview.
  // Each entry refs an agent name. Mascots only appear for these.
  deployed: ["Code Helper", "Researcher", "Vibe Designer", "Workflow Architect", "Ops"],

  sessions: [
    { date: "Today",
      items: [
        { title: "Wire the auth refactor",        agent: "Backend Architect", glyph: "▤", streaming: true,  sub: "Sketching tradeoffs..." },
        { title: "Migrate Postgres → Litestream", agent: "Migration Helper",  glyph: "→",                    sub: "Schema diff ready" },
        { title: "Stripe webhook idempotency",    agent: "Bug Hunter",        glyph: "⊘",                    sub: "Found race in handler" }
      ]},
    { date: "Yesterday",
      items: [
        { title: "Q3 OKRs draft",            agent: "Project Planner", glyph: "◇", sub: "Round 2 with you" },
        { title: "Polish landing copy",      agent: "Copywriter",      glyph: "✦", sub: "Cut intro to 1 paragraph" },
        { title: "Mascot motion notes",      agent: "Vibe Designer",   glyph: "◐", sub: "Idle/streaming pass" }
      ]},
    { date: "Wed, May 13",
      items: [
        { title: "Tax export script",                        agent: "Code Helper", glyph: "{}", sub: "Run @11 today" },
        { title: "Read: Designing Data-Intensive Apps",      agent: "Researcher",  glyph: "◎",  sub: "Ch. 5 summary" },
        { title: "Telegram bot scaffold",                    agent: "Bot Crafter", glyph: "⌬", sub: "Polling vs webhook" }
      ]}
  ],

  models: {
    hardware: [
      { label: "GPU",       value: "RTX 4090",  sub: "24 GB VRAM" },
      { label: "Memory",    value: "64 GB",     sub: "DDR5 6400" },
      { label: "CPU",       value: "9950X",     sub: "16 cores" },
      { label: "Disk free", value: "1.2 TB",    sub: "of 4 TB" }
    ],
    reccos: [
      { slot: "Best overall",  name: "qwen2.5:32b",       size: "20.0 GB", speed: 0.74, quality: 0.86, fit: "Excellent" },
      { slot: "Best for code", name: "qwen2.5-coder:32b", size: "18.5 GB", speed: 0.71, quality: 0.92, fit: "Excellent" },
      { slot: "Fastest",       name: "llama3.1:8b",       size: "4.7 GB",  speed: 0.96, quality: 0.62, fit: "Easy"     }
    ],
    list: [
      { name: "deepseek-r1:14b",    size: "9.0 GB",  speed: 0.65, quality: 0.81, fit: "Good", installed: true },
      { name: "gemma3:12b",         size: "7.6 GB",  speed: 0.68, quality: 0.74, fit: "Good", installed: true },
      { name: "qwen2.5-coder:14b",  size: "9.0 GB",  speed: 0.70, quality: 0.82, fit: "Good", installed: true },
      { name: "phi4:14b",           size: "8.4 GB",  speed: 0.67, quality: 0.78, fit: "Good", installed: false, progress: 0.42 },
      { name: "llama3.3:70b",       size: "40 GB",   speed: 0.22, quality: 0.94, fit: "Tight", installed: false },
      { name: "mistral-small:24b",  size: "14 GB",   speed: 0.62, quality: 0.79, fit: "Good", installed: false }
    ]
  },

  connectors: [
    { name: "GitHub",   glyph: "G",  desc: "Read repos, open PRs, comment on issues.",            state: "Installed" },
    { name: "Drive",    glyph: "D",  desc: "Browse and edit your Drive files in chat.",            state: "Installed" },
    { name: "Notion",   glyph: "N",  desc: "Capture to databases, read pages.",                    state: "Available" },
    { name: "Gmail",    glyph: "M",  desc: "Draft, send, and read your inbox.",                    state: "Installed" },
    { name: "Slack",    glyph: "S",  desc: "Read channels, post replies, run slash commands.",     state: "Available" },
    { name: "Discord",  glyph: "•",  desc: "Read DMs and channels you own; reply on your behalf.", state: "Available" },
    { name: "Telegram", glyph: "T",  desc: "Talk to agents from your phone.",                       state: "Available" },
    { name: "Linear",   glyph: "L",  desc: "Open issues, triage backlog.",                          state: "Installed" },
    { name: "Calendar", glyph: "◔",  desc: "Schedule, find time, draft invites.",                   state: "Available" }
  ],

  teamRun: {
    goal: "Migrate /api/auth to refresh-token rotation, write tests, document the rollout.",
    plan: [
      { name: "Backend Architect", task: "Design rotation protocol & list affected files", tools: ["read_file","grep"],          stream: "Looking at auth.py, session.py, middleware/...\nThe current refresh flow re-uses the same JWT — we need a one-time rotation.\nDrafting protocol now.", status: "streaming" },
      { name: "Code Helper",       task: "Apply rotation in auth handler",                 tools: ["read_file","edit_file"],      stream: "Waiting on protocol.\nQueued: auth.py, session.py.", status: "queued" },
      { name: "Test Writer",       task: "Add rotation tests + replay-attack guards",      tools: ["read_file","run_tests"],      stream: "Drafting unit tests for rotation race.\nWill add pytest fixtures.", status: "streaming" },
      { name: "Doc Writer",        task: "Update auth.md & write rollout guide",           tools: ["read_file","write_file"],     stream: "", status: "queued" }
    ]
  }
};
