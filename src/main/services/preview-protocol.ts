// Serves agent-generated HTML previews (HTML artifacts, the 3D model viewer)
// from a dedicated `flowstate-preview:` scheme.
//
// They used to be srcdoc iframes, but a srcdoc document inherits the app's
// Content-Security-Policy (`script-src 'self'` in the packaged build), so any
// preview script — inline or from a CDN — was silently blocked. Documents on
// this scheme get their own, preview-only CSP instead. The renderer still
// frames them with sandbox="allow-scripts" (no same-origin), so a preview
// can't reach the app or IPC.

import { ipcMain, protocol } from 'electron';
import { randomUUID } from 'node:crypto';
import { CHANNELS, schemas } from '@shared/ipc-channels';

export const PREVIEW_SCHEME = 'flowstate-preview';

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'unsafe-inline' https:",
  'img-src data: blob: https:',
  'font-src data: https:',
  'media-src data: blob: https:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const MAX_PREVIEWS = 200;
const previews = new Map<string, string>();

/** Must run before `app.whenReady()`. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/** Store HTML and return the URL an iframe can load it from. */
export function registerPreview(html: string): string {
  const id = randomUUID();
  previews.set(id, html);
  // Map iteration is insertion-ordered: drop the oldest beyond the cap.
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value!);
  return `${PREVIEW_SCHEME}://view/${id}`;
}

export function isPreviewUrl(url: string): boolean {
  return url.startsWith(`${PREVIEW_SCHEME}:`);
}

/** Call once the app is ready. */
export function installPreviewProtocol(): void {
  protocol.handle(PREVIEW_SCHEME, (req) => {
    const id = new URL(req.url).pathname.replace(/^\/+/, '');
    const html = previews.get(id);
    if (html === undefined) return new Response('Preview expired', { status: 404 });
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': PREVIEW_CSP,
        'x-content-type-options': 'nosniff',
      },
    });
  });

  ipcMain.handle(CHANNELS.PREVIEW_REGISTER, (_e, raw) => {
    const { html } = schemas.previewRegisterRequest.parse(raw);
    return { url: registerPreview(html) };
  });
}
