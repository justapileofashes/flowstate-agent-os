/**
 * Human-readable message for an error thrown by an `ipcRenderer.invoke` call.
 * Electron wraps main-process errors as
 * "Error invoking remote method 'stocks:analyze': MarketDataError: HTTP 403";
 * users should only see the last part.
 */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:[A-Z][A-Za-z]*Error|Error):\s*/, '');
}
