// Build step: inline this repo's locked copy of rep-engine (engine/) into
// src/index.html and write the playable page to index.html at the repo root,
// which GitHub Pages serves.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = '<!-- rep-engine:inline -->';

export function engineSource() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'engine', 'manifest.json'), 'utf8'));
  const source = JSON.parse(readFileSync(join(ROOT, 'engine', 'SOURCE.json'), 'utf8'));
  const parts = manifest.files.map((file) => {
    const src = readFileSync(join(ROOT, 'engine', file), 'utf8');
    return `// ---- engine/${file} ----\n${src.trim()}\n`;
  });
  const banner = `/* rep-engine ${manifest.version} from ${source.repo}@${source.commit.slice(0, 7)}, inlined by build/build.mjs. Edit engine/ via scripts/update-engine.mjs, not this copy. */\n`;
  return banner + parts.join('\n');
}

export function build({ quiet = false } = {}) {
  const engine = engineSource();
  if (engine.includes('</script')) throw new Error('engine source contains "</script", which would break inlining');
  const html = readFileSync(join(ROOT, 'src', 'index.html'), 'utf8');
  if (!html.includes(PLACEHOLDER)) throw new Error(`src/index.html is missing the ${PLACEHOLDER} placeholder`);
  const out = html.replace(PLACEHOLDER, () => `<script>\n${engine}</script>`);
  const outPath = join(ROOT, 'index.html');
  writeFileSync(outPath, out);
  if (!quiet) console.log(`built index.html (${(out.length / 1024).toFixed(1)} KB)`);
  return outPath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
