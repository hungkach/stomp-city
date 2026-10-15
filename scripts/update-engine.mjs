// Pull a new copy of rep-engine from a local body-arcade checkout, record
// exactly which commit it came from, and rebuild the game.
//
//   node scripts/update-engine.mjs ../body-arcade
//
// The game only changes engines when you run this, so a fix made for one
// game never reaches another until you choose to take it. Run npm test and
// play the game before pushing.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from '../build/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(process.argv[2] || join(ROOT, '..', 'body-arcade'));
const srcEngine = join(from, 'engine');
if (!existsSync(join(srcEngine, 'manifest.json'))) {
  console.error(`No engine/manifest.json under ${from}. Pass the path to a body-arcade checkout.`);
  process.exit(1);
}

const git = (...args) => execFileSync('git', ['-C', from, ...args], { encoding: 'utf8' }).trim();
let commit = 'unknown';
let dirty = false;
try {
  commit = git('log', '-1', '--format=%H', '--', 'engine');
  dirty = git('status', '--porcelain', '--', 'engine') !== '';
} catch (_) { /* not a git checkout; keep "unknown" */ }

const manifest = JSON.parse(readFileSync(join(srcEngine, 'manifest.json'), 'utf8'));
const dest = join(ROOT, 'engine');
const previous = existsSync(join(dest, 'SOURCE.json')) ? JSON.parse(readFileSync(join(dest, 'SOURCE.json'), 'utf8')) : null;

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
copyFileSync(join(srcEngine, 'manifest.json'), join(dest, 'manifest.json'));
for (const f of manifest.files) copyFileSync(join(srcEngine, f), join(dest, f));
writeFileSync(join(dest, 'SOURCE.json'), JSON.stringify({
  repo: 'hungkach/body-arcade',
  commit,
  version: manifest.version,
  uncommittedChanges: dirty,
  copiedAt: new Date().toISOString(),
}, null, 2) + '\n');

build();
const was = previous ? `${previous.version} (${previous.commit.slice(0, 7)})` : 'none';
console.log(`engine ${was} -> ${manifest.version} (${commit.slice(0, 7)})${dirty ? ' with uncommitted engine changes' : ''}`);
