// Sign a Flowstate license key (ES256 JWT) with the issuer private key.
// Shared by scripts/issue-license.mjs and the unit test so the format the issuer
// produces is exactly what the app verifies.
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {object}  opts
 * @param {object}  opts.privateJwk  EC P-256 private JWK (with d).
 * @param {'free'|'pro'|'power'} opts.tier
 * @param {string} [opts.email]      buyer identity (optional, informational).
 * @param {number} [opts.days]       validity in days; omit/0 = no expiry.
 * @param {string} [opts.kid]        key id to stamp in the header.
 * @param {number} [opts.now]        issue time ms (for tests).
 * @returns {string} signed JWT license key.
 */
export function signLicense({ privateJwk, tier, email, days, kid, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const header = { alg: 'ES256', typ: 'JWT', ...(kid ? { kid } : {}) };
  const payload = {
    app_metadata: { tier },
    ...(email ? { email } : {}),
    iat,
    ...(days && days > 0 ? { exp: iat + Math.round(days * 86400) } : {}),
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' });
  // JWT ES256 wants raw r||s (IEEE P1363), not DER.
  const sig = cryptoSign('SHA256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}
