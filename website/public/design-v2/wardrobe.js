/* =========================================================
   Wardrobe + state spec for the mascot.
   - CATEGORY_PRESETS: per-category visual/motion vocabulary
   - AGENT_PROPS: per-agent prop icon (drawn next to body)
   - AGENT_BADGE_OVERRIDE: per-agent badge accent (rare)
   ========================================================= */

// We re-use these palette tokens (must match pixel-mascot.jsx PX):
const W_BONE = "#e8e3d5";
const W_INK  = "#0e0d0c";
const W_SHADOW = "#c8c2b3";
const W_BRIGHT = "#f0ece2";
const W_CLAY = "#a08278";
const W_DIM = "#8b8377";
const W_INKFAINT = "#5c574f";

// CATEGORY → visual+motion preset (used by drawCreature + buildSprite)
const CATEGORY_PRESETS = {
  Code:       { badge: W_INK,      lensTint: W_BRIGHT,  motion: "precise",   workTask: "typing" },
  Stack:      { badge: W_SHADOW,   lensTint: W_BONE,    motion: "grounded",  workTask: "wrenching" },
  Knowledge:  { badge: W_BRIGHT,   lensTint: W_BONE,    motion: "calm",      workTask: "reading" },
  Design:     { badge: W_CLAY,     lensTint: W_BRIGHT,  motion: "fluid",     workTask: "painting" },
  Automation: { badge: W_DIM,      lensTint: W_SHADOW,  motion: "rhythmic",  workTask: "wrenching" },
  Ops:        { badge: W_INK,      lensTint: W_SHADOW,  motion: "alert",     workTask: "searching" },
  Build:      { badge: W_SHADOW,   lensTint: W_BRIGHT,  motion: "energetic", workTask: "checking" },
  Other:      { badge: W_DIM,      lensTint: W_BONE,    motion: "gentle",    workTask: "checking" },
  Default:    { badge: W_DIM,      lensTint: W_BONE,    motion: "calm",      workTask: "idle" }
};

// Lookup category preset for an agent
function vibeFor(agent) {
  if (!agent) return CATEGORY_PRESETS.Default;
  if (typeof agent === "string") {
    const found = (window.FLOW_DATA && window.FLOW_DATA.agents || []).find(a => a.name === agent);
    if (!found) return CATEGORY_PRESETS.Default;
    return CATEGORY_PRESETS[found.group] || CATEGORY_PRESETS.Default;
  }
  return CATEGORY_PRESETS[agent.group] || CATEGORY_PRESETS.Default;
}

// Per-agent prop icon name. Resolved by PROP_ICONS in pixel-mascot.jsx.
const AGENT_PROPS = {
  // CODE CORE
  "Code Helper":         "cursor",
  "Code Reviewer":       "magnifier",
  "Bug Hunter":          "bug",
  "Test Writer":         "check",
  "Git Helper":          "branch",
  "Regex Wizard":        "braces",
  "Migration Helper":    "stack",
  "Performance Profiler":"speedo",
  // STACK
  "Frontend Specialist": "brush",
  "Backend Architect":   "blueprint",
  "SQL Helper":          "cylinder",
  "Mobile Dev":          "phone",
  "Auth Specialist":     "key",
  "Cloud Architect":     "cloud",
  "Docker Helper":       "container",
  "Kubernetes Wrangler": "wheel",
  // KNOWLEDGE
  "Researcher":          "papers",
  "Tutor":               "pointer",
  "Brainstormer":        "thoughts",
  "Writer":              "typewriter",
  "Doc Writer":          "doc",
  "Copywriter":          "speech",
  // DESIGN
  "Vibe Designer":       "prism",
  "Component Crafter":   "puzzle",
  "Demo Animator":       "play",
  "Sketch to Code":      "pencil",
  "Theme Wizard":        "palette",
  "Landing Page Pro":    "frame",
  "Image Editor":        "photo",
  "PDF Specialist":      "doc",
  // AUTOMATION
  "Workflow Architect":  "conveyor",
  "Scheduler":           "clock",
  "Webhook Wrangler":    "bolt",
  "API Integrator":      "pipe",
  "Browser Automator":   "browser",
  "File Watcher":        "fileWatch",
  "Notifier":            "bell",
  "Pipeline Builder":    "pipeline",
  "GitHub Actions Architect": "ci",
  "Bot Crafter":         "bot",
  "Web Scraper":         "net",
  "AI Chain Builder":    "chain",
  // OPS
  "Ops":                 "dashboard",
  "CLI Crafter":         "terminal",
  "Config Wizard":       "toggle",
  "Observability Engineer": "radar",
  "Security Auditor":    "shield",
  // BUILD
  "Data Analyst":        "chart",
  "Project Planner":     "timeline",
  "Prototype Builder":   "proto",
  "Mock API Builder":    "mock",
  "Game Jammer":         "controller",
  // OTHER
  "Payment Integrator":  "coin",
  "Accessibility Auditor": "eye",
  "SEO Helper":          "magnet",
  "i18n Helper":         "globe"
};

// State machine: task → animation state.
// Each state has timing + motion profile. The motion profile gets
// modulated by the category's `motion` vocabulary in buildSprite.
const STATE_SPEC = {
  idle:        { fps: 6,  bobAmp: 1, breathPeriod: 24 },
  listening:   { fps: 8,  bobAmp: 1, breathPeriod: 18 },
  thinking:    { fps: 8,  bobAmp: 1, breathPeriod: 24 },
  working:     { fps: 8,  bobAmp: 1, breathPeriod: 12 },
  success:     { fps: 14, bobAmp: 2, breathPeriod: 8  },
  error:       { fps: 6,  bobAmp: 1, breathPeriod: 24 },
  loading:     { fps: 5,  bobAmp: 1, breathPeriod: 32 },
  walking:     { fps: 10, bobAmp: 1, breathPeriod: 4  },
  climbing:    { fps: 8,  bobAmp: 1, breathPeriod: 6  },
};

// Map raw task strings to abstract state names so we have one source of truth.
function stateOf(task) {
  switch (task) {
    case "walking":    return "walking";
    case "climbing":   return "climbing";
    case "thinking":   return "thinking";
    case "celebrating":return "success";
    case "sleeping":   return "loading";
    case "exiting":    return "walking";
    case "typing":
    case "writing":
    case "reading":
    case "wrenching":
    case "painting":
    case "checking":
    case "searching":  return "working";
    case "listening":  return "listening";
    case "error":      return "error";
    case "idle":
    default:           return "idle";
  }
}

Object.assign(window, {
  CATEGORY_PRESETS, AGENT_PROPS, STATE_SPEC,
  vibeFor, stateOf,
  W_BONE, W_INK, W_SHADOW, W_BRIGHT, W_CLAY, W_DIM, W_INKFAINT
});
