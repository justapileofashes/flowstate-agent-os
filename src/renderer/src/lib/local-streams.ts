// Streams this window's chat views are subscribed to. Tool approvals for
// those are shown by the chat view itself; the app shell shows the rest
// (team-run tasks, routines, schedules — runs nobody is watching).
export const localStreamIds = new Set<string>();
