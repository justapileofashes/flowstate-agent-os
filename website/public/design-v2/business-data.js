/* =========================================================
   Appliances (Zoom Meetings + Capture) + Business seed data.
   In the real app these come from ipc.zoom.*, ipc.capture.*,
   ipc.business.* — here seeded so the prototype is interactive.
   ========================================================= */

window.APPLIANCE_DATA = {
  zoom: {
    credsSaved: true,
    jobs: [
      { id: "z1", topic: "Acme — quarterly review", status: "summarizing", chatId: "c-acme", startedAt: "10:02" },
      { id: "z2", topic: "Design sync", status: "done", chatId: "c-design", path: "~/Recordings/design-sync.m4a", shareUrl: "zoom.us/rec/abc", startedAt: "Yesterday" },
      { id: "z3", topic: "Standup", status: "error", error: "host ended before join", startedAt: "Mon" }
    ]
  },
  capture: {
    transcriber: { mode: "openai", url: "https://api.openai.com/v1", model: "whisper-1" },
    jobs: [
      { id: "cap1", title: "Webinar — scaling Postgres", status: "transcribing", bytes: 18_400_000, chatId: null, startedAt: "now" },
      { id: "cap2", title: "Partner call (Meet)", status: "done", bytes: 42_100_000, chatId: "c-partner", path: "~/Captures/partner.webm", startedAt: "1h ago" }
    ]
  }
};

window.BUSINESS_DATA = {
  // set to null to see the setup wizard
  profile: {
    name: "Lumen Analytics",
    product: "A privacy-first product analytics SaaS",
    audience: "Indie SaaS founders and small product teams",
    goals: ["Hit 100 paying teams", "Ship the self-host edition", "Cut churn under 3%"],
    links: { site: "lumen.dev", repo: "github.com/lumen/app" },
    schedule: { enabled: true, time: "08:00" }
  },

  roles: [
    { id: "r-strat", role: "Strategy",  agent: "Strategy Lead",   model: "claude-opus-4" },
    { id: "r-mkt",   role: "Marketing", agent: "Growth Marketer",  model: "claude-sonnet-4.5" },
    { id: "r-ops",   role: "Ops",       agent: "Operations",       model: "qwen2.5:32b" }
  ],

  activeSprint: {
    id: "sp-204",
    status: "running",   // planning | running | wrapping | done | error
    goals: [
      "Publish the self-host launch post",
      "Email 12 churned teams a win-back offer",
      "Tighten onboarding step 3 drop-off"
    ],
    tasks: [
      { id: "t1", role: "Marketing", instruction: "Draft + schedule the self-host launch post", status: "done",    output: "Drafted 280-word post + 3 variants for X/LinkedIn." },
      { id: "t2", role: "Marketing", instruction: "Write win-back email to 12 churned teams",     status: "running", output: "" },
      { id: "t3", role: "Ops",       instruction: "Instrument onboarding step 3, find drop-off",  status: "done",    output: "Added events; 41% drop at workspace-invite." },
      { id: "t4", role: "Ops",       instruction: "Prep self-host Docker image + release notes",  status: "queued",  output: "" }
    ],
    startedAt: "08:00"
  },

  feed: [
    { id: "f1",  ts: "08:00:01", role: null,        kind: "sprint-start",    text: "Daily sprint started · sp-204" },
    { id: "f2",  ts: "08:00:02", role: "Strategy",  kind: "phase",           text: "Planning goals from profile + yesterday's briefing" },
    { id: "f3",  ts: "08:00:09", role: "Strategy",  kind: "phase",           text: "3 goals → 4 tasks dispatched to Marketing + Ops" },
    { id: "f4",  ts: "08:00:10", role: "Marketing", kind: "task-start",      text: "Draft + schedule the self-host launch post" },
    { id: "f5",  ts: "08:00:12", role: "Ops",       kind: "task-start",      text: "Instrument onboarding step 3" },
    { id: "f6",  ts: "08:00:21", role: "Ops",       kind: "task-tool",       text: "tool: read_repo(path=onboarding/)" },
    { id: "f7",  ts: "08:00:38", role: "Marketing", kind: "task-done",       text: "Launch post drafted · 3 variants" },
    { id: "f8",  ts: "08:00:39", role: "Marketing", kind: "action-proposed", text: "Proposed: publish launch post to X + LinkedIn" },
    { id: "f9",  ts: "08:00:44", role: "Ops",       kind: "task-done",       text: "Drop-off found at workspace-invite (41%)" },
    { id: "f10", ts: "08:00:51", role: "Marketing", kind: "action-proposed", text: "Proposed: send win-back email to 12 teams" }
  ],

  actions: [
    {
      id: "a1", sprintId: "sp-204", role: "Marketing", kind: "post",
      title: "Publish self-host launch post to X + LinkedIn",
      body: "Lumen is now self-hostable. Run the whole analytics stack on your own box — your data never leaves your VPC.\n\nOne Docker command. Bring your own Postgres. Same dashboards.\n\n→ lumen.dev/self-host",
      status: "proposed", createdAt: "08:00"
    },
    {
      id: "a2", sprintId: "sp-204", role: "Marketing", kind: "email",
      title: "Win-back email to 12 churned teams",
      body: "Subject: We built the thing you asked for\n\nHi {first_name} — you left because Lumen was cloud-only. It isn't anymore: you can now self-host the whole stack.\n\nWant a hand migrating? Reply and I'll set you up with 3 months free.",
      status: "proposed", createdAt: "08:01"
    },
    {
      id: "a3", sprintId: "sp-204", role: "Ops", kind: "code",
      title: "Add workspace-invite reminder nudge",
      body: "// onboarding/step3.ts\n+ if (!workspace.hasInvites && hoursSince(signup) > 24) {\n+   scheduleNudge(user.id, 'invite-teammates');\n+ }",
      status: "approved", result: "Merged to main · deploy queued", createdAt: "07:30"
    },
    {
      id: "a4", sprintId: "sp-203", role: "Marketing", kind: "post",
      title: "Reply to 3 mentions on X",
      body: "Thread replies drafted for @founderA, @devB, @teamC.",
      status: "done", result: "Posted 3 replies", createdAt: "Yesterday"
    },
    {
      id: "a5", sprintId: "sp-203", role: "Ops", kind: "other",
      title: "Rotate stale API keys",
      body: "Rotate 2 keys older than 90 days.",
      status: "failed", result: "1 of 2 rotated — vault timeout on key #2", createdAt: "Yesterday"
    }
  ],

  briefing: `## Daily briefing — sp-204

**Shipped today**
- Self-host launch post drafted (awaiting your approval to publish).
- Onboarding instrumented — found a **41% drop at workspace-invite**.

**Needs you**
- 2 actions in the approval queue (1 post, 1 email).

**Tomorrow**
- If the post lands, double down on the self-host angle.
- Fix the invite step; it's the single biggest leak in the funnel.`,

  history: [
    { id: "sp-203", date: "Yesterday", status: "done", goals: 3, tasks: 5 },
    { id: "sp-202", date: "Mon Jun 9",  status: "done", goals: 2, tasks: 4 },
    { id: "sp-201", date: "Sun Jun 8",  status: "error", goals: 3, tasks: 4, error: "Ops agent lost connection to flowclaw mid-run" }
  ]
};
