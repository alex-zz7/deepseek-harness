#!/usr/bin/env node
/**
 * Command-line front end for the knowledge index — the same retrieval the MCP
 * server exposes, for testing and for use outside an agent session.
 *
 *   node kb.mjs "怎么写博客 SEO"            # hybrid search
 *   node kb.mjs "GBP suspension" --kind skill -k 5
 *   node kb.mjs --status
 *   node kb.mjs --read skills/INDEX.md --lines 1-40
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KnowledgeIndex } from './lib/search.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const INDEX_DIR = path.join(HERE, 'index');
const CACHE_DIR = path.join(HERE, '.model-cache');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const index = await KnowledgeIndex.load({ root: ROOT, indexDir: INDEX_DIR });

if (has('status')) {
  console.log(JSON.stringify(await index.status(), null, 2));
  process.exit(0);
}

if (has('read')) {
  const p = flag('read');
  const [a, b] = (flag('lines', '') || '').split('-').map(Number);
  const r = await index.read(p, a, b);
  console.log(`${r.path} (lines ${r.startLine}-${r.endLine} of ${r.totalLines})\n`);
  console.log(r.text);
  process.exit(0);
}

const query = argv.filter((a) => !a.startsWith('--') && a !== flag('kind') && a !== flag('k'))[0];
if (!query) {
  console.error('usage: node kb.mjs "<query>" [--kind skill] [-k 8] [--status] [--read PATH]');
  process.exit(1);
}

const res = await index.search(query, {
  k: Number(flag('k', 8)),
  kind: flag('kind'),
  pathPrefix: flag('path-prefix'),
  cacheDir: CACHE_DIR,
});

console.log(
  `${res.matches.length} matches (dense=${res.dense}, dense=${res.candidates.dense}, lexical=${res.candidates.lexical})\n`,
);
for (const [i, m] of res.matches.entries()) {
  console.log(`[${i + 1}] ${m.score}  ${m.path}:${m.startLine}-${m.endLine}  (${m.kind})`);
  if (m.heading) console.log(`     ${m.heading}`);
  console.log(
    '     ' + m.text.replace(/\s+/g, ' ').slice(0, 200) + (m.text.length > 200 ? '…' : ''),
  );
  console.log();
}
