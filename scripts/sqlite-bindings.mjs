// Install better-sqlite3 prebuilt binaries for BOTH runtimes side by side.
//
// This machine has no Visual Studio toolchain, so node-gyp can never compile
// better-sqlite3 — every binary must come from a published prebuild. The stock
// layout keeps ONE binary in build/Release, which can serve Electron (app
// works, vitest db tests break) or Node (tests work, app breaks), never both.
//
// better-sqlite3 loads via the `bindings` package, whose search list includes
// the ABI-specific path lib/binding/node-v{ABI}-{platform}-{arch}/. So we
// download the prebuild for each runtime, install each into its own ABI dir,
// and remove build/ so the shared path can't shadow them. Electron and Node
// then resolve different binaries from the same node_modules.
//
// Run after npm install (which recreates build/Release) or whenever either
// runtime version changes: `node scripts/sqlite-bindings.mjs`

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, existsSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('better-sqlite3/package.json'));
const version = require('better-sqlite3/package.json').version;
const electronVersion = require('electron/package.json').version;
const { getAbi } = require('node-abi'); // transitive dep of @electron/rebuild

const { platform, arch } = process;

const targets = [
  { name: 'node', abi: process.versions.modules },
  { name: 'electron', abi: getAbi(electronVersion, 'electron') },
];

async function install({ name, abi }) {
  const destDir = join(pkgDir, 'lib', 'binding', `node-v${abi}-${platform}-${arch}`);
  const dest = join(destDir, 'better_sqlite3.node');
  if (existsSync(dest)) {
    console.log(`[sqlite-bindings] ${name} (ABI ${abi}) already installed`);
    return;
  }
  const asset = `better-sqlite3-v${version}-${name}-v${abi}-${platform}-${arch}.tar.gz`;
  const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`;
  console.log(`[sqlite-bindings] fetching ${asset}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `No prebuild for ${name} ABI ${abi} (HTTP ${res.status}). ` +
        `Check https://github.com/WiseLibs/better-sqlite3/releases/tag/v${version} ` +
        `for a ${name}-v${abi}-${platform}-${arch} asset, or change the ${name} version.`,
    );
  }
  const tmp = mkdtempSync(join(tmpdir(), 'bs3-'));
  const tarPath = join(tmp, asset);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tarPath, buf);
  execFileSync('tar', ['-xzf', tarPath, '-C', tmp]); // tarball root: build/Release/better_sqlite3.node
  mkdirSync(destDir, { recursive: true });
  copyFileSync(join(tmp, 'build', 'Release', 'better_sqlite3.node'), dest);
  console.log(`[sqlite-bindings] installed ${name} ABI ${abi} -> ${dest}`);
}

for (const target of targets) await install(target);

// The shared build/ dir shadows lib/binding in the bindings search order —
// remove it so each runtime falls through to its own ABI dir.
const buildDir = join(pkgDir, 'build');
if (existsSync(buildDir)) {
  rmSync(buildDir, { recursive: true, force: true });
  console.log('[sqlite-bindings] removed shared build/ dir');
}
console.log('[sqlite-bindings] done — Electron app and Node tests can now run side by side');
