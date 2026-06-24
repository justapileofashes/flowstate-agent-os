// Composer slash commands. Each command either rewrites the user's prompt with
// extra framing before it hits the agent, or navigates to a screen. Inspired by
// Claude Code modes. Keep framings concise and imperative — they're prepended
// to whatever the user typed after the command.

/** Screens a nav command can jump to. Mirrors the App view kinds. */
export type NavTarget =
  | 'dashboard'
  | 'connectors'
  | 'models'
  | 'brain'
  | 'routines'
  | 'business'
  | 'flowclaw'
  | 'settings';

export interface SlashCommand {
  cmd: string;
  label: string;
  hint: string;
  /** Returns the rewritten prompt. Empty string for nav commands. */
  framing: (rest: string) => string;
  /** If set, no message is sent — navigate to this screen instead. */
  nav?: NavTarget;
}

/** The default "use recent changes" hint shared by review-style commands. */
const RECENT = '(default — recent changes in the workspace)';

const FRAMING_COMMANDS: SlashCommand[] = [
  {
    cmd: '/plan',
    label: 'Plan',
    hint: 'Outline steps before touching code',
    framing: (rest) => `[Planning mode]

Before writing any code or running any tools, produce a step-by-step plan
for the task below. Number each step. Identify risks, files that will be
touched, and any open questions. Wait for confirmation before executing.

Task:
${rest}`,
  },
  {
    cmd: '/explain',
    label: 'Explain',
    hint: 'Walk through code without modifying it',
    framing: (rest) => `[Explain mode]

Read the target and explain how it works, top to bottom. Use list_dir /
read_file as needed. Call out the non-obvious parts and any gotchas. Do NOT
modify any files.

Target:
${rest}`,
  },
  {
    cmd: '/eli5',
    label: 'ELI5',
    hint: 'Explain simply, no jargon',
    framing: (rest) => `[Explain-simply mode]

Explain the following in plain language, as if to a smart beginner. Use a
short analogy if it helps. Avoid jargon; define any term you must use.

Topic:
${rest}`,
  },
  {
    cmd: '/debug',
    label: 'Debug',
    hint: 'Systematic root-cause debugging',
    framing: (rest) => `[Debug mode]

Debug this systematically — do NOT guess at fixes:
1. Restate the symptom and how to reproduce it.
2. Form hypotheses; gather evidence (read_file / search_files / logs).
3. Isolate the root cause and prove it before changing anything.
4. Propose the minimal fix, then a regression test that would have caught it.

Problem:
${rest}`,
  },
  {
    cmd: '/fix',
    label: 'Fix',
    hint: 'Fix the bug + add a regression test',
    framing: (rest) => `[Fix mode]

Find and fix the bug described below. Make the smallest change that fixes the
root cause (not the symptom). Add or update a test that fails before the fix
and passes after. Run the test command to verify.

Bug:
${rest}`,
  },
  {
    cmd: '/test',
    label: 'Test',
    hint: 'Write tests for the target',
    framing: (rest) => `[Test mode]

Write tests for the target. Follow the project's existing test conventions
(check the codebase first). Cover the happy path, edge cases, and failure
modes. Run the test command after writing to verify they pass.

Target:
${rest}`,
  },
  {
    cmd: '/tdd',
    label: 'TDD',
    hint: 'Failing test first, then implement',
    framing: (rest) => `[TDD mode]

Test-driven development, strictly:
1. Write one failing test that captures the next small behavior.
2. Run it; confirm it fails for the right reason.
3. Write the minimal code to make it pass.
4. Run all tests; refactor; repeat.
Do not write implementation before its test.

Feature:
${rest}`,
  },
  {
    cmd: '/review',
    label: 'Review',
    hint: 'Senior code review of changes',
    framing: (rest) => `[Review mode]

Act as a senior reviewer. Scan for:
- Logic bugs and edge cases
- Security vulnerabilities
- Style violations vs project rules
- Missing tests
- Performance concerns

Cite file:line. Produce a prioritized report. Do NOT modify files.

Focus area:
${rest || RECENT}`,
  },
  {
    cmd: '/ultrareview',
    label: 'Ultra review',
    hint: 'Deep, multi-pass review (slower)',
    framing: (rest) => `[Ultra-review mode — high effort]

You are a principal engineer doing a final pre-ship review. Do MULTIPLE passes:

1. Security pass — auth flaws, injection, secret leakage, unsafe IPC
2. Correctness pass — edge cases, off-by-one, race conditions
3. Architecture pass — coupling, layering, abstraction violations
4. Test-coverage pass — what's not tested + what should be
5. Performance pass — N+1, hot loops, missing indices

For each pass, cite file:line. Severity: blocker / major / minor / nit.

Target:
${rest || RECENT}`,
  },
  {
    cmd: '/refactor',
    label: 'Refactor',
    hint: 'Improve structure, no behavior change',
    framing: (rest) => `[Refactor mode]

Refactor the target for clarity and maintainability WITHOUT changing behavior.
Preserve the public API and all existing tests. Explain each change briefly.
Run the tests afterward to prove behavior is unchanged.

Target:
${rest}`,
  },
  {
    cmd: '/optimize',
    label: 'Optimize',
    hint: 'Performance pass',
    framing: (rest) => `[Optimize mode]

Improve performance of the target. First measure or reason about the actual
hot path — don't micro-optimize cold code. Identify N+1s, redundant work,
missing indices, unnecessary allocations. Keep behavior identical and keep
tests green.

Target:
${rest}`,
  },
  {
    cmd: '/types',
    label: 'Types',
    hint: 'Strengthen TypeScript types',
    framing: (rest) => `[Types mode]

Strengthen the typing of the target: remove \`any\`, tighten unions, add
generics where they add safety, and surface invalid states as unrepresentable.
Do not change runtime behavior. Confirm \`tsc\` passes.

Target:
${rest}`,
  },
  {
    cmd: '/security',
    label: 'Security',
    hint: 'Security audit (read-only)',
    framing: (rest) => `[Security audit mode]

Audit the target for security issues: injection, auth/authz gaps, secret
leakage, unsafe deserialization, path traversal, SSRF, unsafe IPC, and
dependency risks. Rate each finding (critical/high/medium/low) with a concrete
exploit scenario and a fix. Do NOT modify files.

Scope:
${rest || RECENT}`,
  },
  {
    cmd: '/docs',
    label: 'Docs',
    hint: 'Write documentation / comments',
    framing: (rest) => `[Docs mode]

Write clear documentation for the target — doc comments, a README section, or
usage examples as appropriate. Explain the why, not just the what. Match the
project's existing doc style.

Target:
${rest}`,
  },
  {
    cmd: '/commit',
    label: 'Commit message',
    hint: 'Draft a commit message for current changes',
    framing: (rest) => `[Commit mode]

Inspect the current uncommitted changes (use git tools / read the diff) and
write a single Conventional Commits message: a concise \`type(scope): subject\`
line under ~72 chars, then a body explaining what changed and why. Do not
commit — just output the message.

Extra context:
${rest || '(none)'}`,
  },
  {
    cmd: '/pr',
    label: 'PR description',
    hint: 'Draft a pull-request description',
    framing: (rest) => `[PR mode]

Draft a pull-request description for the current branch's changes: a summary,
a bulleted list of what changed, the testing done, and any risks or follow-ups.
Read the diff to ground it. Output markdown only.

Extra context:
${rest || '(none)'}`,
  },
  {
    cmd: '/scaffold',
    label: 'Scaffold',
    hint: 'Generate boilerplate for a feature',
    framing: (rest) => `[Scaffold mode]

Generate the boilerplate for the described feature following this project's
existing structure and conventions (find a similar existing feature and mirror
its layout, naming, and wiring). List the files you create. Leave clear TODOs
where real logic belongs.

Feature:
${rest}`,
  },
  {
    cmd: '/todo',
    label: 'Find TODOs',
    hint: 'Surface tech debt + TODOs',
    framing: (rest) => `[Tech-debt scan]

Search the target for TODO / FIXME / HACK markers and obvious tech debt
(dead code, duplicated logic, missing error handling, stale comments). Produce
a prioritized list with file:line and a suggested action for each. Do NOT
modify files.

Scope:
${rest || RECENT}`,
  },
  {
    cmd: '/summarize',
    label: 'Summarize',
    hint: 'Summarize a file or this chat',
    framing: (rest) => `[Summarize mode]

Produce a tight summary of the target. Lead with the one-line gist, then the
key points as bullets. If it's code, cover what it does, its inputs/outputs,
and any caveats.

Target:
${rest || '(this conversation so far)'}`,
  },
  {
    cmd: '/name',
    label: 'Naming',
    hint: 'Suggest better names',
    framing: (rest) => `[Naming mode]

Suggest clearer names for the thing described below (variable / function /
type / module). Offer 3–5 options, each with a one-line rationale, and flag the
one you'd pick. Match the project's naming conventions.

Target:
${rest}`,
  },
];

const NAV_COMMANDS: SlashCommand[] = [
  navCmd('/dashboard', 'Dashboard', 'Open the Dashboard', 'dashboard'),
  navCmd('/models', 'Models', 'Open the Models page', 'models'),
  navCmd('/brain', 'Brain', 'Open the Second Brain page', 'brain'),
  navCmd('/connectors', 'Connectors', 'Open the Connectors page', 'connectors'),
  navCmd('/mcp', 'MCP / Connectors', 'Open the Connectors page', 'connectors'),
  navCmd('/routines', 'Routines', 'Open the Routines page', 'routines'),
  navCmd('/business', 'Business', 'Open the Business page', 'business'),
  navCmd('/flowclaw', 'Flowclaw', 'Open the Flowclaw page', 'flowclaw'),
  navCmd('/settings', 'Settings', 'Open Settings', 'settings'),
];

function navCmd(cmd: string, label: string, hint: string, nav: NavTarget): SlashCommand {
  return { cmd, label, hint, framing: () => '', nav };
}

export const SLASH_COMMANDS: SlashCommand[] = [...FRAMING_COMMANDS, ...NAV_COMMANDS];

/**
 * If the input begins with a known slash command, return the rewritten prompt
 * with the corresponding framing. Longer command names are matched first so
 * `/ultrareview` wins over `/review`-style prefixes. Otherwise the input is
 * returned untouched with command: null.
 */
export function applySlashCommand(input: string): { text: string; command: SlashCommand | null } {
  const trimmed = input.trimStart();
  const byLength = [...SLASH_COMMANDS].sort((a, b) => b.cmd.length - a.cmd.length);
  for (const cmd of byLength) {
    if (trimmed === cmd.cmd || trimmed.startsWith(cmd.cmd + ' ') || trimmed.startsWith(cmd.cmd + '\n')) {
      const rest = trimmed.slice(cmd.cmd.length).trim();
      return { text: cmd.framing(rest), command: cmd };
    }
  }
  return { text: input, command: null };
}
