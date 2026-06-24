// Issue a Flowstate license key. Run this after a buyer pays (crypto), then send
// them the printed key — they paste it into Settings -> Redeem license key.
//
//   node scripts/issue-license.mjs --tier power --days 365 --email buyer@example.com
//   node scripts/issue-license.mjs --tier pro                # no expiry
//
// Reads the private key from license-keys/issuer-private.jwk (created once by
// scripts/gen-issuer-key.mjs). NEVER commit or share that file.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signLicense } from './lib/license-sign.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KID = 'flowstate-license-1';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const tier = arg('tier', 'pro');
const days = Number(arg('days', '0'));
const email = arg('email', '');
const keyPath = resolve(root, arg('key', 'license-keys/issuer-private.jwk'));

if (!['pro', 'power'].includes(tier)) {
  console.error(`--tier must be "pro" or "power" (got "${tier}")`);
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`Private key not found: ${keyPath}`);
  console.error('Run: node scripts/gen-issuer-key.mjs');
  process.exit(1);
}

const privateJwk = JSON.parse(readFileSync(keyPath, 'utf8'));
const token = signLicense({ privateJwk, tier, email: email || undefined, days, kid: KID });

console.log(`\nLicense key (tier=${tier}${days ? `, ${days}d` : ', no expiry'}${email ? `, ${email}` : ''}):\n`);
console.log(token);
console.log('\nSend this to the buyer. They paste it in Settings -> Redeem license key.');
