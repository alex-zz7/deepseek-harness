/**
 * Hybrid retrieval over the knowledge index.
 *
 * Two independent rankers run on every query and are fused with Reciprocal
 * Rank Fusion:
 *
 *   - dense: multilingual-e5 cosine over the chunk vectors. Finds paraphrase
 *     and cross-lingual matches (a Chinese question matching English prose).
 *   - lexical: BM25 over the tokenized chunk text. Finds exact identifiers,
 *     flag names, error strings and skill names, which embeddings blur.
 *
 * RRF is used instead of score normalisation because cosine and BM25 scores
 * are on incomparable scales and their distributions shift per query; only
 * the ranks are trusted.
 */

import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { extractText } from './extract.mjs';
import { tokenize, tokenizeQuery } from './tokenize.mjs';
import { walkMarkdown } from './walk.mjs';

const RRF_K = 60;
const CANDIDATES = 400; // per ranker, before fusion
const BM25_K1 = 1.2;
const BM25_B = 0.75;
/** IDF exponent: >1 sharpens the advantage of rare, specific terms. */
const BM25_IDF_POWER = 1.6;
/** Floor for the query-coverage multiplier (see bm25()). */
const BM25_COVERAGE_WEIGHT = 0.35;

/**
 * Pick the chunk within a document that best represents the query.
 *
 * The fused rank already names a winning chunk; if that chunk is tiny (a
 * heading stub) a longer sibling from the same file usually carries the
 * answer, so prefer the longest chunk when the winner is far below the file's
 * own median size.
 */
function pickBestChunk(chunks, path, chunkIdx) {
  const own = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].path === path) own.push(i);
  }
  if (own.length <= 1) return chunkIdx;
  const len = (i) => chunks[i].text.length;
  const winner = chunks[chunkIdx]?.path === path ? chunkIdx : own[0];
  const longest = own.reduce((a, b) => (len(b) > len(a) ? b : a));
  return len(winner) < len(longest) * 0.5 ? longest : winner;
}

/** Load the on-disk index and answer queries against it. */export class KnowledgeIndex {
  constructor({ root, indexDir, chunks, vectors, dims, manifest }) {
    this.root = root;
    this.indexDir = indexDir;
    this.chunks = chunks;
    this.vectors = vectors;
    this.dims = dims;
    this.manifest = manifest;
    this._bm25 = null;
    this._extractor = null;
    this._loading = null;
  }

  /** Read index files into memory. */
  static async load({ root, indexDir, model, cacheDir }) {
    const manifestPath = path.join(indexDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `no index at ${indexDir} — run "node build-index.mjs" first`,
      );
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const chunks = (await readFile(path.join(indexDir, 'chunks.jsonl'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const buf = await readFile(path.join(indexDir, 'vectors.f32'));
    const vectors = new Float32Array(
      buf.buffer,
      buf.byteOffset,
      buf.byteLength / 4,
    );
    return new KnowledgeIndex({
      root,
      indexDir,
      chunks,
      vectors,
      dims: manifest.dims,
      manifest,
      model: model ?? manifest.model,
      cacheDir,
    });
  }

  /** Lazily load the embedding model (only the dense path needs it). */
  async getExtractor(model, cacheDir) {
    if (this._extractor) return this._extractor;
    if (!this._loading) {
      this._loading = (async () => {
        const wanted = model ?? this.manifest.model;
        // A query embedded with a different model than the one that built the
        // vectors produces well-formed nonsense: no error, just meaningless
        // similarity. Refuse rather than silently return bad results.
        if (wanted !== this.manifest.model) {
          throw new Error(
            `model mismatch: index was built with "${this.manifest.model}" but ` +
              `"${wanted}" was requested — rebuild with "node build-index.mjs --force"`,
          );
        }
        const { pipeline, env } = await import('@huggingface/transformers');
        if (cacheDir) env.cacheDir = cacheDir;
        env.allowLocalModels = false;
        // The dtype must match the one that produced the stored vectors for
        // the same reason the model name must: quantized and full-precision
        // weights do not agree closely enough to mix.
        this._extractor = await pipeline('feature-extraction', wanted, {
          dtype: this.manifest.dtype ?? 'fp32',
        });
        return this._extractor;
      })();
    }
    return this._loading;
  }

  /** Build the BM25 inverted index once, from the chunk texts. */
  buildBm25() {
    if (this._bm25) return this._bm25;
    const postings = new Map(); // term -> flat [chunkIdx, tf, chunkIdx, tf, ...]
    const lengths = new Float64Array(this.chunks.length);
    let total = 0;

    for (let i = 0; i < this.chunks.length; i++) {
      const terms = tokenize(this.chunks[i].text);
      lengths[i] = terms.length;
      total += terms.length;
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const [t, n] of tf) {
        let arr = postings.get(t);
        if (!arr) postings.set(t, (arr = []));
        arr.push(i, n);
      }
    }

    this._bm25 = {
      postings,
      lengths,
      avgdl: total / (this.chunks.length || 1),
      n: this.chunks.length,
    };
    return this._bm25;
  }

  /**
   * BM25 ranking; returns [[chunkIdx, score], ...] descending.
   *
   * Plain BM25 sums over query terms, which punishes CJK badly: "怎么给视频加字幕"
   * tokenizes to 怎么/么给/给视/视频/频加/加字/字幕, where every term except 字幕
   * is noise that still scores. Two corrections are applied:
   *
   *  1. IDF is squared-ish (raised to POWER) so a rare, specific bigram like
   *     字幕 outweighs a pile of common ones.
   *  2. Scores are scaled by query coverage — the fraction of the query's
   *     total IDF mass the chunk actually matched — so a chunk matching one
   *     important term beats a chunk matching several unimportant ones.
   *
   * Without these, embedded-captions ranked 153rd for a query containing the
   * word 字幕.
   */
  bm25(query) {
    const { postings, lengths, avgdl, n } = this.buildBm25();
    const terms = tokenizeQuery(query);
    const scores = new Map();
    const idfOf = new Map();
    let totalIdf = 0;

    // Pass 1: IDF per query term, and the query's total IDF mass.
    for (const term of terms) {
      const arr = postings.get(term);
      if (!arr) continue;
      const df = arr.length / 2;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      idfOf.set(term, idf);
      totalIdf += idf;
    }
    if (!totalIdf) return [];

    // Pass 2: accumulate per-chunk score and matched IDF mass.
    const matchedIdf = new Map();
    for (const [term, idf] of idfOf) {
      const arr = postings.get(term);
      const weighted = Math.pow(idf, BM25_IDF_POWER);
      for (let j = 0; j < arr.length; j += 2) {
        const idx = arr[j];
        const freq = arr[j + 1];
        const norm = 1 - BM25_B + (BM25_B * lengths[idx]) / avgdl;
        const s = weighted * ((freq * (BM25_K1 + 1)) / (freq + BM25_K1 * norm));
        scores.set(idx, (scores.get(idx) ?? 0) + s);
        matchedIdf.set(idx, (matchedIdf.get(idx) ?? 0) + idf);
      }
    }

    // Scale by coverage, so matching the query's important terms matters more
    // than matching many incidental ones.
    const out = [];
    for (const [idx, s] of scores) {
      const coverage = matchedIdf.get(idx) / totalIdf;
      out.push([idx, s * (BM25_COVERAGE_WEIGHT + (1 - BM25_COVERAGE_WEIGHT) * coverage)]);
    }

    return out.sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES);
  }

  /** Cosine ranking against every chunk vector (brute force, ~25k x 384). */
  async dense(query, model, cacheDir) {
    const extractor = await this.getExtractor(model, cacheDir);
    const out = await extractor([`query: ${query}`], {
      pooling: 'mean',
      normalize: true,
    });
    const q = Float32Array.from(out.tolist()[0]);
    const { vectors, dims } = this;
    const n = this.chunks.length;

    // Vectors are L2-normalised at build time, so cosine == dot product.
    const scored = new Array(n);
    for (let i = 0; i < n; i++) {
      const off = i * dims;
      let dot = 0;
      for (let d = 0; d < dims; d++) dot += vectors[off + d] * q[d];
      scored[i] = [i, dot];
    }
    return scored.sort((a, b) => b[1] - a[1]).slice(0, CANDIDATES);
  }

  /**
   * Hybrid search.
   *
   * @param {string} query
   * @param {object} [opts]
   * @param {number} [opts.k] Results to return.
   * @param {string} [opts.kind] Restrict to a chunk kind ('skill', 'github', ...).
   * @param {string} [opts.pathPrefix] Restrict to a path prefix.
   * @param {boolean} [opts.dense] Set false for lexical-only.
   * @param {boolean} [opts.collapse] Fuse at file level (default true). Set
   *   false for small vaults so several passages from the same book can surface.
   */
  async search(query, opts = {}) {
    const { k = 8, kind, pathPrefix, dense = true, collapse = true } = opts;

    const allow = (i) => {
      const c = this.chunks[i];
      if (kind && c.kind !== kind) return false;
      if (pathPrefix && !c.path.startsWith(pathPrefix)) return false;
      return true;
    };

    /**
     * Navigation files need conditional demotion, not blanket demotion.
     *
     * skills/INDEX.md and the vault READMEs are Chinese, keyword-dense, and
     * list every skill's description, so on topical questions they match
     * strongly and pushed the skill that actually explains the topic out of
     * the top 10 (INDEX.md took rank 1 for most of the eval set).
     *
     * But on meta questions — "我有哪些 GitHub 仓库", "skill 一共分几类",
     * "知识库怎么维护" — the index file IS the answer. Blanket demotion broke
     * exactly those cases. So demotion applies only when the query is not
     * itself asking about the catalogue.
     */
    const NAVIGATION = /(^|\/)(INDEX\.md|README\.md)$/;
    const META_QUERY =
      /仓库|项目列表|有哪些|多少个|一共|几类|分类|索引|目录|怎么维护|怎么同步|知识库|结构|repo list|which repos/i;
    const shouldDemote = !META_QUERY.test(query);

    const demote = (list) => {
      if (!shouldDemote) return list;
      const nav = [];
      const rest = [];
      for (const hit of list) {
        (NAVIGATION.test(this.chunks[hit[0]].path) ? nav : rest).push(hit);
      }
      return [...rest, ...nav];
    };

    const lexical = demote(this.bm25(query).filter(([i]) => allow(i)));

    let denseHits = [];
    if (dense) {
      try {
        denseHits = demote(
          (await this.dense(query, opts.model, opts.cacheDir)).filter(([i]) => allow(i)),
        );
      } catch (err) {
        // A missing model or download failure degrades to lexical-only.
        this._denseError = err.message;
      }
    }

    // Reciprocal Rank Fusion, done at the DOCUMENT level.
    //
    // Fusing raw chunk ranks fails badly on this corpus: a long skill such as
    // yt-story-script contributes dozens of near-duplicate chunks that all
    // score well, so it fills every result slot and hides the file that
    // actually answers the question (embedded-captions ranked 368 in the
    // dense list but never surfaced). Collapsing each file to its single best
    // rank before fusing keeps one file to one slot and leaves room for the
    // rest of the corpus.
    const docRank = (list) => {
      const best = new Map(); // path -> {chunkIdx, rank}
      list.forEach(([idx], rank) => {
        const p = this.chunks[idx].path;
        if (!best.has(p)) best.set(p, { chunkIdx: idx, rank });
      });
      return best;
    };

    const toMatch = (score, chunkIdx) => {
      const c = this.chunks[chunkIdx];
      return {
        score: Number(score.toFixed(5)),
        path: c.path,
        kind: c.kind,
        heading: c.heading,
        name: c.name,
        description: c.description,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
      };
    };

    let ranked;
    if (collapse === false) {
      const fused = new Map();
      const addChunks = (list, weight = 1) => {
        list.forEach(([idx], rank) => {
          const entry = fused.get(idx) ?? { score: 0, chunkIdx: idx };
          entry.score += weight / (RRF_K + rank + 1);
          fused.set(idx, entry);
        });
      };
      addChunks(denseHits);
      addChunks(lexical);
      ranked = [...fused.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ score, chunkIdx }) => toMatch(score, chunkIdx));
    } else {
      const denseDocs = docRank(denseHits);
      const lexicalDocs = docRank(lexical);

      const fused = new Map();
      const add = (docs, weight = 1) => {
        for (const [p, { chunkIdx, rank }] of docs) {
          const entry = fused.get(p) ?? { score: 0, chunkIdx };
          entry.score += weight / (RRF_K + rank + 1);
          fused.set(p, entry);
        }
      };
      add(denseDocs);
      add(lexicalDocs);

      ranked = [...fused.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, k)
        .map(([p, { score, chunkIdx }]) =>
          toMatch(score, pickBestChunk(this.chunks, p, chunkIdx)),
        );
    }

    return {
      query,
      matches: ranked,
      dense: dense && !this._denseError,
      denseError: this._denseError,
      candidates: { dense: denseHits.length, lexical: lexical.length },
    };
  }

  /** Read a file, optionally clamped to a line range. */
  async read(relPath, startLine, endLine) {
    const rel = String(relPath || '').replace(/\\/g, '/');
    if (
      rel === 'chunks.jsonl' ||
      rel === 'vectors.f32' ||
      rel === 'manifest.json' ||
      rel.startsWith('index/') ||
      rel.includes('/index/') ||
      rel.startsWith('.kb/') ||
      rel.includes('/.kb/')
    ) {
      throw new Error('index files are not readable; use search hits');
    }
    const abs = path.resolve(this.root, relPath);
    if (!abs.startsWith(this.root)) throw new Error('path escapes the vault');
    const text = await extractText(abs);
    const lines = text.split('\n');
    const from = Math.max(1, startLine ?? 1);
    const to = Math.min(lines.length, endLine ?? lines.length);
    return {
      path: relPath,
      totalLines: lines.length,
      startLine: from,
      endLine: to,
      text: lines.slice(from - 1, to).join('\n'),
    };
  }

  /**
   * Index freshness against the live vault.
   *
   * Re-reads manifest.json from disk rather than trusting `this.manifest`.
   * The server caches the loaded index for the life of the process (a 100 MB
   * index must not be re-read per query), so an in-memory manifest goes stale
   * the moment `build-index.mjs` runs. Status is exactly what gets asked right
   * after a rebuild, so reporting the cached copy there would be wrong at the
   * one moment it matters — it reported a 01:20 build as current while the
   * disk already held the 01:31 one, and flagged a freshly built index STALE.
   */
  async status() {
    let manifest = this.manifest;
    try {
      manifest = JSON.parse(
        await readFile(path.join(this.indexDir, 'manifest.json'), 'utf8'),
      );
    } catch {
      // Keep the in-memory copy if the file is momentarily unreadable.
    }

    const files = await walkMarkdown(this.root);
    let newest = 0;
    for (const rel of files) {
      const m = statSync(path.join(this.root, rel)).mtimeMs;
      if (m > newest) newest = m;
    }
    const builtAt = Date.parse(manifest.builtAt);
    return {
      ...manifest,
      indexDir: this.indexDir,
      currentFiles: files.length,
      // Distinguish "files changed after the last build" from "this process is
      // holding an older index than the one on disk" — different fixes.
      loadedBuiltAt: this.manifest.builtAt,
      newerIndexOnDisk: manifest.builtAt !== this.manifest.builtAt,
      newestFileMtime: new Date(newest).toISOString(),
      stale: newest > builtAt,
      staleSinceMinutes: newest > builtAt ? Math.round((newest - builtAt) / 60000) : 0,
    };
  }
}
