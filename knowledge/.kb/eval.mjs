#!/usr/bin/env node
/**
 * Retrieval quality harness.
 *
 * Design notes, learned by getting this wrong twice:
 *
 * 1. Ground truth is verified against the vault, not guessed. Two early cases
 *    expected files that never mention the query at all.
 *
 * 2. Expectations are narrow enough to fail. Substrings like "seo-" (181
 *    files), "cloudflare" (397) or "github/" (37) pass on almost any hit and
 *    inflate the score without measuring anything.
 *
 * 3. Expectation lists accept every defensible home. "怎么给视频加字幕" is
 *    answered by embedded-captions (the specialist) but also by
 *    yt-story-script / yt-novel-series, whose Chinese bodies genuinely cover
 *    subtitle generation. Scoring only the specialist measured the eval's
 *    narrowness, not retrieval quality.
 *
 * 4. A run reports both exact-file hits and family hits. The gap between them
 *    is the interesting number: family hits mean "found the right area, not
 *    the best document".
 *
 *   node eval.mjs            # summary
 *   node eval.mjs --verbose  # top hits for every miss
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { KnowledgeIndex } from './lib/search.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CACHE_DIR = path.join(HERE, '.model-cache');
const VERBOSE = process.argv.includes('--verbose');
const K = 10;

/**
 * `expect` = documents that fully answer the question.
 * `family` = documents that are on-topic but not the best answer; counted
 *            separately so a near miss is visible rather than a flat failure.
 * A leading "^" anchors to the start of the vault-relative path.
 */
const CASES = [
  // ── Chinese question → English skill body: the cross-lingual core case ──
  { q: '怎么做 App Store 截图', expect: ['app-store-screenshots'], label: 'zh→en' },
  { q: 'Google Business Profile 被暂停了怎么恢复', expect: ['gbp-suspension-recovery'], label: 'zh→en' },
  { q: '怎么给视频加字幕', expect: ['embedded-captions'],
    family: ['yt-story-script', 'yt-novel-series', 'audio-subtitles'], label: 'zh→en' },
  { q: '小红书图片怎么做', expect: ['baoyu-xhs-images', 'baoyu-infographic'],
    family: ['xiaohongshu-ops', 'xhs-'], label: 'zh→zh' },
  { q: '怎么让内容被 AI 搜索引用', expect: ['geo-citability'],
    family: ['geo-cold-start', 'geo-'], label: 'zh→en' },
  { q: '怎么用 Cloudflare 部署 Worker', expect: ['wrangler'],
    family: ['cloudflare', 'durable-objects'], label: 'zh→en' },
  { q: '怎么写博客文章', expect: ['blog-write'],
    family: ['05-博客写作包/blog/', 'blog-outline', 'blog-brief'], label: 'zh→en' },
  { q: '怎么做关键词研究', expect: ['local-keyword-research'],
    family: ['local-content-strategy', 'seo-'], label: 'zh→en' },
  { q: '怎么做外链建设', expect: ['local-link-building'],
    family: ['seo-backlinks', 'backlink'], label: 'zh→en' },
  { q: '怎么给视频配音', expect: ['embedded-captions'],
    family: ['yt-story-script', 'yt-novel-series', 'higgsfield'], label: 'zh→en' },
  { q: '怎么做应用商店上架', expect: ['asc-release-flow'],
    family: ['iosship', 'asc-'], label: 'zh→en' },
  { q: '怎么防止表单被机器人提交', expect: ['turnstile-spin'],
    family: ['turnstile', 'cloudflare'], label: 'zh→en' },

  // ── Exact identifier lookups: the lexical half's job ────────────────────
  { q: 'gbp-suspension-recovery', expect: ['gbp-suspension-recovery'], label: 'exact name' },
  { q: 'baoyu-cover-image', expect: ['baoyu-cover-image'], label: 'exact name' },
  { q: 'asc-submission-health', expect: ['asc-submission-health'], label: 'exact name' },
  { q: 'App Store 拒审怎么申诉', expect: ['app-store-review', 'asc-submission-health'],
    family: ['asc-', 'iosship'], label: 'exact-ish' },

  // ── Vault / project meta layers ─────────────────────────────────────────
  { q: '我有哪些 GitHub 仓库', expect: ['github/INDEX.md'], label: 'project index' },
  { q: '知识库怎么维护，怎么重新同步', expect: ['^README.md'], label: 'vault meta' },
  { q: 'skill 一共分几类', expect: ['skills/INDEX.md'], label: 'skill taxonomy' },
  { q: 'alexsignal 是什么', expect: ['github/projects/alexsignal'], label: 'project lookup' },
];

const index = await KnowledgeIndex.load({ root: ROOT, indexDir: path.join(HERE, 'index') });
console.log(`model ${index.manifest.model} / ${index.manifest.dtype} / ${index.dims}d / ${index.chunks.length} chunks\n`);

const match = (p, e) => (e.startsWith('^') ? p.startsWith(e.slice(1)) : p.includes(e));

let pass = 0;
let familyOnly = 0;
let mrr = 0;
let msTotal = 0;
const failures = [];

for (const c of CASES) {
  const t0 = Date.now();
  const res = await index.search(c.q, { k: K, cacheDir: CACHE_DIR });
  const ms = Date.now() - t0;
  msTotal += ms;

  const rank = res.matches.findIndex((m) => c.expect.some((e) => match(m.path, e)));
  const famRank = c.family
    ? res.matches.findIndex((m) => c.family.some((e) => match(m.path, e)))
    : -1;

  let badge;
  if (rank >= 0) {
    badge = `hit@${rank + 1}`;
    pass++;
    mrr += 1 / (rank + 1);
  } else if (famRank >= 0) {
    badge = `family@${famRank + 1}`;
    familyOnly++;
    mrr += 0.5 / (famRank + 1);
  } else {
    badge = 'MISS';
    failures.push({ ...c, res });
  }

  console.log(`${badge.padEnd(10)} ${String(ms).padStart(5)}ms  ${c.label.padEnd(15)} "${c.q}"`);
  if (rank >= 0) console.log(`           → ${res.matches[rank].path}:${res.matches[rank].startLine}`);
  else if (famRank >= 0) console.log(`           ~ ${res.matches[famRank].path} (right area, not the best doc)`);
}

console.log(
  `\nexact ${pass}/${CASES.length}   family-inclusive ${pass + familyOnly}/${CASES.length}   ` +
    `MRR ${(mrr / CASES.length).toFixed(3)}   avg ${Math.round(msTotal / CASES.length)}ms/query`,
);

if (failures.length && VERBOSE) {
  console.log('\n── misses in detail ──');
  for (const f of failures) {
    console.log(`\n"${f.q}"  expected: ${f.expect.join(' | ')}`);
    for (const m of f.res.matches.slice(0, 5)) console.log(`   ${m.score}  ${m.path}:${m.startLine}`);
  }
}
