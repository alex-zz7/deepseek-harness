/**
 * Entity catalog — one row per document (a skill folder, a project page, a
 * handbook), ranked before any 25k-chunk passage search.
 *
 * Exact strings are only one signal. Titles, aliases, and descriptions are
 * scored with the same tokenizer as BM25, so "Gptimage" can hit gptimage2 and
 * "GEO冷启动手册" can hit a longer filename.
 */

import { skillName } from './walk.mjs';
import { tokenize, tokenizeQuery } from './tokenize.mjs';

const SKIP = new Set([
  'skill',
  'skills',
  'vault',
  'index',
  'readme',
  'knowledge',
  'studio',
  'http',
  'https',
  'file',
  'markdown',
  'docs',
  'github',
  'project',
  'projects',
]);

const QUERY_STOP = new Set([
  ...SKIP,
  '怎么',
  '什么',
  '如何',
  '哪个',
  '一下',
  '这个',
  '那个',
  '问题',
  '讲讲',
  '介绍',
  '原理',
  '文档',
  '手册',
  '资料',
  '内容',
]);

const LOOKUP = /\bskill\b|技能|原理|机制|调用方式|怎么实现|是什么|是啥|什么是|手册|这篇|那份|\.pdf\b/i;

const META_QUERY =
  /仓库|项目列表|有哪些|多少个|一共|几类|分类|索引|目录|怎么维护|怎么同步|repo list|which repos/i;

const NAV = /(^|\/)(INDEX|README|AGENTS)\.md$/i;

export function aliasesFor(name) {
  const n = String(name || '').toLowerCase();
  const out = new Set();
  if (!n) return [];
  out.add(n);
  out.add(n.replace(/-/g, ''));
  const stem = n.replace(/\d+$/, '');
  if (stem.length >= 3 && stem !== n) {
    out.add(stem);
    out.add(stem.replace(/-/g, ''));
  }
  for (const part of n.split(/[-_—–\s./]+/)) {
    if (part.length >= 4) out.add(part);
  }
  return [...out];
}

function fileStem(path) {
  return String(path || '')
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '');
}

function isNav(path) {
  return NAV.test(path);
}

function entityKey(chunk) {
  const skill = skillName(chunk.path);
  if (skill && String(chunk.path || '').startsWith('skills/vault/')) return `skill:${skill.toLowerCase()}`;
  return `file:${chunk.path}`;
}

export function buildEntities(chunks) {
  const byId = new Map();
  for (const chunk of chunks || []) {
    const path = String(chunk.path || '');
    if (!path || isNav(path)) continue;
    const key = entityKey(chunk);
    let row = byId.get(key);
    if (!row) {
      const skill = skillName(path);
      const isSkill = key.startsWith('skill:');
      const title = skill || chunk.name || fileStem(path);
      const parts = path.split('/');
      row = {
        id: key,
        type: isSkill ? 'skill' : chunk.kind || 'doc',
        name: title,
        title,
        aliases: aliasesFor(title),
        group: isSkill ? parts[2] || '' : parts[0] || '',
        dir: isSkill ? `skills/vault/${parts[2]}/${skill}/` : path,
        skillPath: '',
        description: '',
      };
      byId.set(key, row);
    }
    if (chunk.name && chunk.name.length > row.name.length && row.type !== 'skill') {
      row.name = chunk.name;
      row.title = chunk.name;
    }
    if (chunk.description && !row.description) row.description = chunk.description;
    if (/SKILL\.md$/i.test(path)) {
      if (!row.skillPath) row.skillPath = path;
      if (chunk.description && chunk.description.length > row.description.length) {
        row.description = chunk.description;
      }
    }
  }
  return [...byId.values()];
}

/** @deprecated use buildEntities — kept for the skill-shaped subset */
export function buildCatalog(chunks) {
  return buildEntities(chunks).filter((row) => row.type === 'skill');
}

function queryTerms(query) {
  return tokenizeQuery(query).filter((t) => t.length >= 2 && !QUERY_STOP.has(t));
}

function compact(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '');
}

function looksLikeLookup(query, row, token) {
  const q = String(query || '').trim();
  if (LOOKUP.test(q)) return true;
  if (compact(q) === compact(row.name) || (token && compact(q) === compact(token))) return true;
  const tokens = queryTerms(q).filter((t) => /[a-z]/.test(t) && t.length >= 4);
  return tokens.length === 1 && (tokens[0] === token || row.name.toLowerCase().startsWith(tokens[0]));
}

function entityBlob(row) {
  return [row.name, row.title, ...(row.aliases || []), row.description].filter(Boolean).join('\n');
}

/** Coverage of query terms against the entity card, not the full body. */
export function entityScore(query, row) {
  const terms = queryTerms(query);
  if (!terms.length) return 0;
  const have = new Set(tokenize(entityBlob(row)));
  let hit = 0;
  let mass = 0;
  for (const t of terms) {
    const w = Math.min(t.length, 8);
    mass += w;
    if (have.has(t)) hit += w;
  }
  const q = compact(query);
  const name = compact(row.name);
  // Short stems like "geo" must not eat "GEO冷启动手册".
  if (name.length >= 4 && q.includes(name)) hit += 8;
  else if (q.length >= 4 && name.includes(q) && q.length * 2 >= name.length) hit += 8;
  for (const alias of row.aliases || []) {
    const a = compact(alias);
    if (a.length < 4) continue;
    if (q.includes(a) && a.length >= 4) {
      hit += a.length >= 6 ? 6 : 3;
      break;
    }
  }
  return mass ? hit / mass : 0;
}

function resolveByIdentifier(query, entities) {
  const tokens = queryTerms(query).filter((t) => /[a-z]/.test(t) && t.length >= 4 && !SKIP.has(t));
  if (!tokens.length) return null;
  const hits = new Map();
  for (const token of tokens) {
    const exact = [];
    const prefix = [];
    for (const row of entities) {
      const names = [row.name.toLowerCase(), ...row.aliases];
      if (names.includes(token)) exact.push(row);
      else if (token.length >= 6 && row.name.toLowerCase().startsWith(token)) prefix.push(row);
    }
    const pick = exact.length === 1 ? exact[0] : !exact.length && prefix.length === 1 ? prefix[0] : null;
    if (!pick || !looksLikeLookup(query, pick, token)) continue;
    hits.set(pick.id, { row: pick, why: exact.length === 1 ? 'exact' : 'prefix', token });
  }
  if (hits.size !== 1) return null;
  return [...hits.values()][0];
}

function resolveByCard(query, entities) {
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const scored = entities
    .map((row) => ({ row, score: entityScore(query, row) }))
    .filter((x) => x.score >= 0.55)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const [top, next] = scored;
  if (next && top.score - next.score < 0.12) return null;
  if (!LOOKUP.test(query) && top.score < 0.8 && compact(query).length < 6) return null;
  if (!LOOKUP.test(query) && top.score < 0.72 && queryTerms(query).length >= 4) return null;
  return { row: top.row, why: 'card', score: top.score };
}

export function resolveEntity(query, entities) {
  if (!entities?.length) return null;
  return resolveByIdentifier(query, entities) || resolveByCard(query, entities);
}

export function resolveSkill(query, catalog) {
  return resolveEntity(query, catalog);
}

export function classifyQuery(query, entities) {
  const resolved = resolveEntity(query, entities);
  const meta = META_QUERY.test(query);
  if (resolved && !(meta && !LOOKUP.test(query))) {
    return { intent: resolved.row.type === 'skill' ? 'skill' : 'doc', resolved };
  }
  if (meta) return { intent: 'meta', resolved: null };
  return { intent: 'topic', resolved: null };
}
