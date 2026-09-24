import type { Database } from 'better-sqlite3';
import type { SettingRow } from '@shared/types';

/** Transparent encrypt/decrypt backend (e.g. SecretStore over OS keychain). */
export interface SettingsSecretBackend {
  encryptValue(plain: string): string;
  decryptValue(value: string): string;
}

/**
 * Setting keys whose values are secrets and must be encrypted at rest. Anything
 * that grants account/provider access. Encryption is transparent: callers still
 * set/get plaintext; ciphertext only ever touches the SQLite file. Backward
 * compatible — pre-existing plaintext values decrypt as passthrough and are
 * re-encrypted on the next set.
 */
export const SECRET_SETTING_KEYS: ReadonlySet<string> = new Set([
  'anthropic_api_key',
  'openai_api_key',
  'gemini_api_key',
  'perplexity_api_key',
  'groq_api_key',
  'mistral_api_key',
  'xai_api_key',
  'alpaca_key_id',
  'alpaca_secret_key',
  'alpaca_live_key_id',
  'alpaca_live_secret_key',
  'trader_data_key_id',
  'trader_data_secret_key',
  'license.jwt',
  'license.refreshToken',
]);

export class SettingsService {
  private getStmt;
  private setStmt;
  private listStmt;

  constructor(
    private readonly db: Database,
    /** When provided, SECRET_SETTING_KEYS are encrypted at rest. */
    private readonly secrets?: SettingsSecretBackend,
  ) {
    this.getStmt = db.prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    );
    this.setStmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.listStmt = db.prepare<[], { key: string; value: string }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
  }

  private isSecret(key: string): boolean {
    return this.secrets !== undefined && SECRET_SETTING_KEYS.has(key);
  }

  get(key: string): string | null {
    const row = this.getStmt.get(key);
    if (row?.value == null) return null;
    return this.isSecret(key) ? this.secrets!.decryptValue(row.value) : row.value;
  }

  set(key: string, value: string): void {
    if (key.length === 0) {
      throw new Error('settings key must not be empty');
    }
    const stored = this.isSecret(key) ? this.secrets!.encryptValue(value) : value;
    this.setStmt.run(key, stored);
  }

  list(): SettingRow[] {
    // Secret values are returned as stored (ciphertext) — never bulk-decrypted.
    return this.listStmt.all();
  }
}
