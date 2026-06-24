// Zoom Server-to-Server OAuth credentials, persisted in the settings KV with
// the client secret encrypted via SecretStore (identical treatment to flowclaw
// connection tokens): write-only across IPC, decrypted only in main.

import type { SecretStore } from './secret-store';
import type { SettingsKV } from './flowclaw-store';
import type { ZoomCreds } from './zoom-service';

export const ZOOM_CREDS_KEY = 'zoom_credentials';

export class ZoomCredsStore {
  constructor(
    private readonly settings: SettingsKV,
    private readonly secrets: SecretStore,
  ) {}

  save(creds: ZoomCreds): void {
    this.settings.set(
      ZOOM_CREDS_KEY,
      JSON.stringify({
        accountId: creds.accountId,
        clientId: creds.clientId,
        clientSecret: this.secrets.encryptValue(creds.clientSecret),
      }),
    );
  }

  load(): ZoomCreds | null {
    const raw = this.settings.get(ZOOM_CREDS_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const accountId = typeof p['accountId'] === 'string' ? p['accountId'] : '';
      const clientId = typeof p['clientId'] === 'string' ? p['clientId'] : '';
      const secret = typeof p['clientSecret'] === 'string' ? p['clientSecret'] : '';
      if (!accountId || !clientId || !secret) return null;
      return { accountId, clientId, clientSecret: this.secrets.decryptValue(secret) };
    } catch {
      return null;
    }
  }
}
