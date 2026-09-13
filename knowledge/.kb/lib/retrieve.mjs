/**
 * Conversation retrieve: resolve a document entity, then read inside it.
 *
 * Skills, project pages, and handbooks are the same hop — an entity card
 * (title / aliases / description). Passage search runs only when no entity
 * wins, or the question is inventory/maintenance.
 */

import { buildEntities, classifyQuery } from './catalog.mjs';
import { skillName } from './walk.mjs';

const TOPIC_K = 8;
const ENTITY_K = 6;
const REFUSE_LOW = 0.022;

function entitiesOf(handle) {
  if (!handle._entities) handle._entities = buildEntities(handle.chunks);
  return handle._entities;
}

function firstEntityChunk(handle, row) {
  if (row.skillPath) {
    const hit = handle.chunks.find((c) => c.path === row.skillPath);
    if (hit) return hit;
  }
  if (row.type === 'skill') {
    return handle.chunks.find((c) => skillName(c.path) === row.name && /SKILL\.md$/i.test(c.path));
  }
  return handle.chunks.find((c) => c.path === row.dir);
}

function matchFromChunk(chunk, score) {
  return {
    score: Number(score.toFixed(5)),
    path: chunk.path,
    kind: chunk.kind,
    heading: chunk.heading,
    name: chunk.name,
    description: chunk.description,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    text: chunk.text,
  };
}

async function loadResolved(handle, query, row, opts) {
  const scoped = await handle.search(query, {
    ...opts,
    k: ENTITY_K,
    pathPrefix: row.dir,
    collapse: false,
    excludeNav: true,
    demoteNav: false,
  });
  const matches = [...scoped.matches];
  const intro = firstEntityChunk(handle, row);
  if (intro && !matches.some((m) => m.path === intro.path && m.startLine === intro.startLine)) {
    matches.unshift(matchFromChunk(intro, 1));
  }
  return {
    query,
    intent: row.type === 'skill' ? 'skill' : 'doc',
    resolved: row.name,
    matches: matches.slice(0, ENTITY_K),
    refuse: matches.length === 0,
    dense: scoped.dense,
    denseError: scoped.denseError,
    candidates: scoped.candidates,
  };
}

export async function retrieveFromIndex(handle, query, opts = {}) {
  const entities = entitiesOf(handle);
  const { intent, resolved } = classifyQuery(query, entities);

  if (resolved?.row && (intent === 'skill' || intent === 'doc')) {
    return loadResolved(handle, query, resolved.row, opts);
  }

  if (intent === 'meta') {
    const result = await handle.search(query, {
      ...opts,
      k: opts.k ?? TOPIC_K,
      excludeNav: false,
      demoteNav: false,
      navOnly: true,
    });
    const top = result.matches[0]?.score ?? 0;
    return {
      ...result,
      intent: 'meta',
      resolved: null,
      refuse: result.matches.length === 0 || top < REFUSE_LOW,
    };
  }

  const result = await handle.search(query, {
    ...opts,
    k: opts.k ?? TOPIC_K,
    excludeNav: true,
    demoteNav: true,
  });
  const top = result.matches[0]?.score ?? 0;
  return {
    ...result,
    intent: 'topic',
    resolved: null,
    refuse: result.matches.length === 0 || top < REFUSE_LOW,
  };
}
