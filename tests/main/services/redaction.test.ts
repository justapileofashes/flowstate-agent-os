import { describe, it, expect } from 'vitest';
import { redactSensitive } from '@main/services/redaction';

describe('redactSensitive', () => {
  it('masks email addresses', () => {
    const r = redactSensitive('contact me at jane.doe+test@example.co.uk please');
    expect(r).toContain('<email>');
    expect(r).not.toContain('example.co.uk');
  });

  it('masks SSNs', () => {
    expect(redactSensitive('ssn 123-45-6789')).toBe('ssn <ssn>');
  });

  it('masks credit-card-like numbers', () => {
    expect(redactSensitive('card 4111 1111 1111 1111 end')).toContain('<card>');
  });

  it('masks AWS access keys', () => {
    expect(redactSensitive('AKIAIOSFODNN7EXAMPLE')).toBe('<token>');
  });

  it('masks bearer tokens in a shell command', () => {
    const r = redactSensitive("curl -H 'authorization: Bearer abc123DEF456ghi' https://x");
    expect(r).toContain('Bearer <token>');
    expect(r).not.toContain('abc123DEF456ghi');
  });

  it('masks key/secret assignments', () => {
    const r = redactSensitive('api_key=sk-supersecretvalue1234 token=zzz');
    expect(r).not.toContain('supersecretvalue');
    expect(r.toLowerCase()).toContain('<secret>');
  });

  it('masks PEM private key blocks', () => {
    const pem =
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(redactSensitive(pem)).toBe('<key>');
  });

  it('leaves ordinary text and paths unchanged', () => {
    expect(redactSensitive('read src/main/index.ts line 42')).toBe('read src/main/index.ts line 42');
    expect(redactSensitive('ls -la /tmp')).toBe('ls -la /tmp');
  });

  it('is idempotent', () => {
    const once = redactSensitive('mail a@b.com ssn 111-22-3333');
    expect(redactSensitive(once)).toBe(once);
  });

  it('returns empty string untouched', () => {
    expect(redactSensitive('')).toBe('');
  });
});
