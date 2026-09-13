/**
 * Walk the knowledge vault and produce the chunk + vector index.
 *
 * Incremental by default: unchanged files (mtime + size) keep their chunks and
 * vectors. Only new or edited files are extracted and embedded. `--force`
 * ignores the previous index; the app UI does not expose that.
 *
 *   node build-index.mjs            # scan + patch
 *   node build-index.mjs --force    # rebuild everything
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunkMarkdown, embedText } from './lib/chunk.mjs';
import { extractText } from './lib/extract.mjs';
import { walkMarkdown, classify } from './lib/walk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.KB_ROOT || path.resolve(HERE, '..'));
function defaultIndexDir(root) {
  const visible = path.join(root, 'index');
  const hidden = path.join(root, '.kb', 'index');
  if (existsSync(path.join(visible, 'manifest.json'))) return visible;
  if (existsSync(path.join(hidden, 'manifest.json'))) return hidden;
  return visible;
}
const INDEX_DIR = path.resolve(process.env.KB_INDEX_DIR || defaultIndexDir(ROOT));
const MODEL = process.env.KB_MODEL ?? 'Xenova/multilingual-e5-large';
/**
 * ONNX weight precision. `q8` (int8) is the default because it was measured
 * against `fp32` on this corpus: identical 5/5 gold-vs-junk separation with
 * essentially the same margin (0.0050 vs 0.0059), at 2.7x the throughput
 * (12.2 vs 4.5 chunks/s). fp32 would have taken ~5 hours to build instead of
 * ~0.6. Set KB_DTYPE=fp32 to trade the time back for a hair more precision.
 */
const DTYPE = process.env.KB_DTYPE ?? 'q8';
const FORCE = process.argv.includes('--force');

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

async function loadPrevious() {
  const empty = { byHash: new Map(), byPath: new Map(), stamps: {}, dims: 0, builtAt: 0 };
  if (FORCE) return empty;
  const chunksPath = path.join(INDEX_DIR, 'chunks.jsonl');
  const vecPath = path.join(INDEX_DIR, 'vectors.f32');
  const manifestPath = path.join(INDEX_DIR, 'manifest.json');
  if (!existsSync(chunksPath) || !existsSync(vecPath) || !existsSync(manifestPath)) return empty;

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const buf = await readFile(vecPath);
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const byHash = new Map();
  const byPath = new Map();
  const lines = (await readFile(chunksPath, 'utf8')).split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = JSON.parse(lines[i]);
    const vector = flat.subarray(i * manifest.dims, (i + 1) * manifest.dims);
    byHash.set(c.hash, vector);
    const list = byPath.get(c.path) || [];
    list.push({ chunk: c, vector });
    byPath.set(c.path, list);
  }
  console.log(`previous index: ${byHash.size} chunks, ${byPath.size} files`);
  return {
    byHash,
    byPath,
    stamps: manifest.fileStamps && typeof manifest.fileStamps === 'object' ? manifest.fileStamps : {},
    dims: manifest.dims || 0,
    builtAt: Date.parse(manifest.builtAt) || 0,
  };
}

function stampEq(a, b) {
  return Boolean(a && b && a.mtimeMs === b.mtimeMs && a.size === b.size);
}

function progress(phase, done, total) {
  const safe = Math.max(1, Number(total) || 0);
  const pct = Math.min(100, Math.round((Number(done) / safe) * 100));
  process.stdout.write(`progress ${phase} ${done}/${total} ${pct}%\n`);
}

console.log(`vault: ${ROOT}`);
console.log(`model: ${MODEL}`);

const files = await walkMarkdown(ROOT);
console.log(`found ${files.length} files`);
progress('extract', 0, files.length);

const previous = await loadPrevious();
const fileStamps = {};
const chunks = [];
const reusedVectors = [];
let skipped = 0;
let unchangedFiles = 0;
let changedFiles = 0;

let scanned = 0;
for (const rel of files) {
  scanned += 1;
  let stamp;
  try {
    const info = await stat(path.join(ROOT, rel));
    stamp = { mtimeMs: Math.round(info.mtimeMs), size: info.size };
  } catch {
    skipped++;
    progress('extract', scanned, files.length);
    continue;
  }
  fileStamps[rel] = stamp;
  const priorStamp = previous.stamps[rel];
  const priorChunks = previous.byPath.get(rel);
  const untouched =
    !FORCE &&
    priorChunks?.length &&
    (stampEq(priorStamp, stamp) || (!priorStamp && previous.builtAt && stamp.mtimeMs <= previous.builtAt));
  if (untouched) {
    unchangedFiles++;
    for (const row of priorChunks) {
      chunks.push({ ...row.chunk, etext: null });
      reusedVectors.push(row.vector);
    }
    if (scanned === files.length || scanned % 8 === 0) progress('extract', scanned, files.length);
    continue;
  }

  changedFiles++;
  let text;
  try {
    text = await extractText(path.join(ROOT, rel));
  } catch (error) {
    console.warn(`skip ${rel}: ${error?.message ?? error}`);
    skipped++;
    progress('extract', scanned, files.length);
    continue;
  }
  if (!text.trim()) {
    skipped++;
    progress('extract', scanned, files.length);
    continue;
  }
  const parts = chunkMarkdown(text);
  for (const p of parts) {
    const etext = embedText(p, rel);
    chunks.push({
      path: rel,
      kind: classify(rel),
      heading: p.heading,
      name: p.name,
      description: p.description,
      startLine: p.startLine,
      endLine: p.endLine,
      text: p.text,
      hash: sha1(etext),
      etext,
    });
    reusedVectors.push(null);
  }
  progress('extract', scanned, files.length);
}

const removedFiles = [...previous.byPath.keys()].filter((rel) => !fileStamps[rel]).length;
console.log(
  `scan: ${unchangedFiles} unchanged, ${changedFiles} to patch, ${removedFiles} removed, ${skipped} skipped`,
);

let dims = previous.dims || 0;
const vectors = new Array(chunks.length);
const todo = [];
for (let i = 0; i < chunks.length; i++) {
  const cached = reusedVectors[i] || previous.byHash.get(chunks[i].hash);
  if (cached) {
    vectors[i] = cached;
    dims = cached.length;
  } else {
    todo.push(i);
  }
}
console.log(`reusing ${chunks.length - todo.length} cached vectors, embedding ${todo.length}`);

if (todo.length > 0) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = process.env.KB_CACHE_DIR || path.join(HERE, '.model-cache');
  env.allowLocalModels = false;
  console.log('loading embedding model…');
  progress('load', 0, 1);
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: DTYPE });
  progress('load', 1, 1);

  const BATCH = 32;
  const started = Date.now();
  for (let b = 0; b < todo.length; b += BATCH) {
    const slice = todo.slice(b, b + BATCH);
    const out = await extractor(
      slice.map((i) => chunks[i].etext),
      { pooling: 'mean', normalize: true },
    );
    dims = out.dims[1];
    const rows = out.tolist();
    for (let k = 0; k < slice.length; k++) vectors[slice[k]] = Float32Array.from(rows[k]);

    const done = Math.min(b + BATCH, todo.length);
    const secs = (Date.now() - started) / 1000;
    const rate = done / Math.max(secs, 0.001);
    const eta = (todo.length - done) / rate;
    progress('embed', done, todo.length);
    if (done === todo.length || done % (BATCH * 4) === 0) {
      console.log(
        `  ${done}/${todo.length}  ${rate.toFixed(1)}/s  eta ${Math.round(eta)}s`,
      );
    }
  }
} else if (!dims) {
  console.log('nothing to index');
  process.exit(0);
}

const stampsMissing = Object.keys(previous.stamps).length === 0 && files.length > 0;
if (
  !FORCE &&
  previous.dims &&
  changedFiles === 0 &&
  removedFiles === 0 &&
  chunks.length > 0 &&
  todo.length === 0 &&
  !stampsMissing
) {
  console.log('index is current, nothing to write');
  process.exit(0);
}

// ── Pass 3: write ───────────────────────────────────────────────────────────
progress('write', 0, 1);
const started = Date.now();
await mkdir(INDEX_DIR, { recursive: true });

const flat = new Float32Array(chunks.length * dims);
for (let i = 0; i < chunks.length; i++) flat.set(vectors[i], i * dims);
await writeFile(path.join(INDEX_DIR, 'vectors.f32'), Buffer.from(flat.buffer));

const meta = chunks.map(({ etext, ...rest }) => rest);
await writeFile(
  path.join(INDEX_DIR, 'chunks.jsonl'),
  meta.map((c) => JSON.stringify(c)).join('\n') + '\n',
);

const byKind = {};
for (const c of chunks) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

await writeFile(
  path.join(INDEX_DIR, 'manifest.json'),
  JSON.stringify(
    {
      builtAt: new Date().toISOString(),
      root: ROOT,
      model: MODEL,
      dtype: DTYPE,
      dims,
      chunks: chunks.length,
      files: files.length,
      byKind,
      fileStamps,
    },
    null,
    2,
  ) + '\n',
);

progress('write', 1, 1);
console.log(`\nwrote index: ${chunks.length} chunks x ${dims} dims`);
console.log(`  ${(flat.byteLength / 1024 / 1024).toFixed(1)} MB vectors`);
console.log(`  kinds: ${JSON.stringify(byKind)}`);
console.log(`  total ${((Date.now() - started) / 1000).toFixed(0)}s`);
