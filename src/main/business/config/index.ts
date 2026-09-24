// Business agent — feature flags, defaults, version, and tunable limits. One
// place to read every magic number the loop, gateway, and scheduler use.

export const BUSINESS_AGENT_VERSION = '2.0.0';

/** Settings KV keys (global, not per company). */
export const BIZ_SETTINGS = {
  /** Emergency stop: '0' pauses every scheduled job and aborts running cycles. */
  enabled: 'business_agent_enabled',
  legacyImported: 'business_legacy_imported',
} as const;

/** 1 credit = $0.01 of cloud spend. */
export const CREDITS_PER_USD = 100;
/** Local (free) models still consume credits so loops stay bounded. */
export const LOCAL_TOKENS_PER_CREDIT = 4_000;

export const LIMITS = {
  cycleWallClockMs: 45 * 60_000,
  runWallClockMs: 15 * 60_000,
  noProgressWindow: 3,
  ceoMaxIterations: 12,
  defaultMaxIterations: 8,
  maxPlanItems: 8,
  feedCapPerCompany: 2_000,
  knowledgeCapPerCompany: 5_000,
  promptSnippetChars: 600,
  stepContentChars: 2_000,
  stepResultChars: 2_000,
  toolResultForModelChars: 12_000,
  approvalBacklogWarn: 10,
  approvalStaleMs: 48 * 60 * 60_000,
  schedulerTickMs: 30_000,
  leaseMarginMs: 5 * 60_000,
  executionStaleMs: 10 * 60_000,
} as const;

export const GATEWAY = {
  retryAttempts: 3,
  retryBaseDelayMs: 400,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 60_000,
} as const;
