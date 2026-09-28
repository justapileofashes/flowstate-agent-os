// Streams this window's chat views are subscribed to. Tool approvals for
// those are shown by the chat view itself; the app shell shows the rest
// (team-run tasks, routines, schedules — runs nobody is watching).
export const localStreamIds = new Set<string>();

// Approvals the user already answered. The shell picks background approvals up
// on a delay, so a quick allow/deny lands before the pickup and would
// otherwise leave a modal for a request that is already settled.
// ponytail: grows for the session; a desktop lifetime never fills it.
const resolvedApprovals = new Set<string>();

const key = (streamId: string, toolCallId: string): string => `${streamId}:${toolCallId}`;

export function markApprovalResolved(streamId: string, toolCallId: string): void {
  resolvedApprovals.add(key(streamId, toolCallId));
}

/** Show it in the shell only if no chat view owns the stream and it is unanswered. */
export function shouldShowBackgroundApproval(streamId: string, toolCallId: string): boolean {
  return !localStreamIds.has(streamId) && !resolvedApprovals.has(key(streamId, toolCallId));
}
