import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build/build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the locked engine copy records where it came from', () => {
  const src = JSON.parse(readFileSync(join(ROOT, 'engine', 'SOURCE.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(ROOT, 'engine', 'manifest.json'), 'utf8'));
  assert.equal(src.repo, 'hungkach/body-arcade');
  assert.match(src.commit, /^[0-9a-f]{40}$/);
  assert.equal(src.version, manifest.version);
});

test('the engine loads and runs headless', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'engine', 'manifest.json'), 'utf8'));
  const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout });
  ctx.globalThis = ctx;
  for (const f of manifest.files) vm.runInContext(readFileSync(join(ROOT, 'engine', f), 'utf8'), ctx, { filename: f });
  const engine = ctx.RepEngine.create({ headless: true });
  const s = engine.signals();
  for (const key of ['cadence_spm', 'effort', 'speed', 'lean', 'squat_depth', 'guard_up', 'confidence']) assert.ok(key in s, `signals() missing ${key}`);
});

test('build writes a self-contained index.html', () => {
  build({ quiet: true });
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('<!-- rep-engine:inline -->'));
  assert.ok(html.includes('// ---- engine/engine.js ----'));
  assert.ok(html.includes('RepEngine.create('));
});

test('the committed index.html matches a fresh build', () => {
  const before = readFileSync(join(ROOT, 'index.html'), 'utf8');
  build({ quiet: true });
  assert.equal(readFileSync(join(ROOT, 'index.html'), 'utf8'), before, 'run npm run build and commit index.html');
});
