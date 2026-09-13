#!/usr/bin/env node
/**
 * MCP stdio server exposing the knowledge vault as retrieval tools.
 *
 * Tools appear in the harness as `mcp__kb__kb_search` and so on. The server
 * answers `tools/list` immediately and loads the index (and warms the
 * embedding model) in the background, so harness startup is never blocked by
 * a 40 MB index read or a model load; a tool call issued before the warm-up
 * finishes simply awaits it.
 *
 * Nothing may be written to stdout except MCP protocol frames — all logging
 * goes to stderr.
 */

import { existsSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { KnowledgeIndex } from './lib/search.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const CACHE_DIR = path.join(HERE, '.model-cache');
const STUDIO_CONFIG = path.join(homedir(), '.dsh', 'knowledge-studio.json');

function resolveIndexDir(root) {
  const visible = path.join(root, 'index');
  const hidden = path.join(root, '.kb', 'index');
  if (existsSync(path.join(visible, 'manifest.json'))) return visible;
  if (existsSync(path.join(hidden, 'manifest.json'))) return hidden;
  return visible;
}

const log = (...a) => console.error('[kb]', ...a);

/** Last successfully loaded vault index. */
let loaded = null;

async function readActiveVault() {
  try {
    const raw = JSON.parse(await readFile(STUDIO_CONFIG, 'utf8'));
    const vaults = Array.isArray(raw.vaults) ? raw.vaults : [];
    const active = vaults.find((vault) => vault.id === raw.activeId) || vaults[0];
    if (active && typeof active.root === 'string' && active.root.startsWith('/')) {
      const root = path.resolve(active.root);
      return {
        id: active.id || 'active',
        name: active.name || '知识库',
        root,
        indexDir: resolveIndexDir(root),
      };
    }
  } catch {
    // fall back to the shipped knowledge/ vault
  }
  return {
    id: 'default',
    name: '知识库',
    root: DEFAULT_ROOT,
    indexDir: resolveIndexDir(DEFAULT_ROOT),
  };
}

async function manifestBuiltAt(indexDir) {
  try {
    const manifest = JSON.parse(await readFile(path.join(indexDir, 'manifest.json'), 'utf8'));
    return manifest.builtAt || '';
  } catch {
    return '';
  }
}

/**
 * Load index and warm the model; resolved once and reused by every call.
 *
 * A failed load must NOT be cached. This process outlives index rebuilds: it
 * started at 5am while a rebuild was still running, saw "no index", and cached
 * that rejection — leaving the tools permanently broken until the harness was
 * restarted by hand. Clearing the cached promise on failure lets the next call
 * retry and pick up an index that has since appeared.
 */
function init() {
  const run = (async () => {
    const vault = await readActiveVault();
    const builtAt = await manifestBuiltAt(vault.indexDir);
    const key = `${vault.root}::${vault.indexDir}::${builtAt}`;
    if (loaded?.key === key) return loaded.handle;

    const t0 = Date.now();
    const index = await KnowledgeIndex.load({
      root: vault.root,
      indexDir: vault.indexDir,
      cacheDir: CACHE_DIR,
    });
    index.vaultName = vault.name;
    log(
      `index loaded (${vault.name}): ${index.chunks.length} chunks x ${index.dims} dims in ${Date.now() - t0}ms`,
    );

    const tb = Date.now();
    index.buildBm25();
    log(`bm25 built in ${Date.now() - tb}ms`);

    index
      .getExtractor(index.manifest.model, CACHE_DIR)
      .then(() => log('embedding model warm'))
      .catch((e) => log(`model warm failed (lexical-only until fixed): ${e.message}`));

    loaded = { key, handle: index };
    return index;
  })().catch((e) => {
    log(`index load failed (will retry on next call): ${e.message}`);
    loaded = null;
    throw e;
  });
  return run;
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'kb_search',
    description:
      'Search the currently selected knowledge base. Do NOT call this when the user message already contains a <knowledge_context> block — those passages were already retrieved. Do not grep index files. Only use this if there is no knowledge_context at all.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural-language question or keywords. Chinese or English both work; a descriptive question retrieves better than a single word.',
        },
        k: {
          type: 'number',
          description: 'Number of passages to return (default 8, max 30).',
        },
        kind: {
          type: 'string',
          enum: ['skill', 'skill-index', 'github', 'doc', 'root'],
          description:
            'Restrict results: "skill" = skill bodies, "github" = project pages, "doc" = hand-written docs.',
        },
        path_prefix: {
          type: 'string',
          description:
            'Restrict to a vault-relative path prefix, e.g. "skills/vault/06-SEO-GEO-本地/".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'kb_read',
    description:
      'Read a vault source file after kb_search. Do not call this when <knowledge_context> is already in the user message. Never read index/, chunks.jsonl, or vectors.f32.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Vault-relative path exactly as returned by kb_search, e.g. "skills/INDEX.md".',
        },
        start_line: { type: 'number', description: 'First line (1-based).' },
        end_line: { type: 'number', description: 'Last line, inclusive.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'kb_status',
    description:
      'Report knowledge-vault index statistics: chunk and file counts, embedding model, when the index was built, and whether files changed since (stale). Call this when search results look outdated or before rebuilding.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ── Server wiring ───────────────────────────────────────────────────────────

const server = new Server(
  { name: 'knowledge-vault', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

/** Render a search hit for the model. */
function formatHit(m, i, root) {
  const head = m.heading ? `\n${m.heading}` : '';
  const desc = m.description ? `\n${m.description}` : '';
  let abs = path.resolve(root, m.path);
  try {
    abs = realpathSync(abs);
  } catch {
    // keep unresolved path
  }
  const open = pathToFileURL(abs).href;
  return [
    `── [${i + 1}] ${m.path}:${m.startLine}-${m.endLine}  (${m.kind}, score ${m.score})${head}${desc}`,
    `open: ${open}`,
    '',
    m.text,
    '',
  ].join('\n');
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    if (name === 'kb_status') {
      const index = await init();
      const s = await index.status();
      return {
        content: [
          {
            type: 'text',
            text: [
              `vault: ${index.vaultName || '知识库'}`,
              `root: ${s.root}`,
              `model: ${s.model} (${s.dims} dims)`,
              `weights: ${s.dtype ?? 'fp32'}`,
              `quantization note: dtype is recorded at build time; a query must use the same weights as the index`,
              `chunks: ${s.chunks} from ${s.files} files`,
              `kinds: ${JSON.stringify(s.byKind)}`,
              `built: ${s.builtAt}`,
              `files now: ${s.currentFiles}`,
              // "content changed" and "this process holds an older index than
              // the one on disk" need different fixes, so say which it is.
              s.newerIndexOnDisk
                ? `NOTE: a newer index is on disk (${s.builtAt}) than this process loaded ` +
                  `(${s.loadedBuiltAt}) — restart the MCP server (or reload the DSH profile) to use it`
                : '',
              s.stale
                ? `STALE: vault changed ${s.staleSinceMinutes} min after the index was built — rebuild with "node build-index.mjs"`
                : 'fresh: no file is newer than the index',
            ].filter(Boolean).join('\n'),
          },
        ],
      };
    }

    if (name === 'kb_read') {
      const index = await init();
      if (!args.path) throw new Error('path is required');
      const r = await index.read(args.path, args.start_line, args.end_line);
      return {
        content: [
          {
            type: 'text',
            text: `${r.path} (lines ${r.startLine}-${r.endLine} of ${r.totalLines})\n\n${r.text}`,
          },
        ],
      };
    }

    if (name === 'kb_search') {
      const index = await init();
      if (!args.query) throw new Error('query is required');
      const k = Math.min(Math.max(Number(args.k) || 8, 1), 30);
      const t0 = Date.now();
      const sourceFiles = new Set(
        index.chunks
          .filter((chunk) => chunk.path && !/(^|\/)(INDEX|README|AGENTS)\.md$/i.test(chunk.path))
          .map((chunk) => chunk.path),
      ).size;
      const scoped = Boolean(args.kind || args.path_prefix);
      const res = scoped
        ? await index.search(args.query, {
            k,
            kind: args.kind,
            pathPrefix: args.path_prefix,
            cacheDir: CACHE_DIR,
            collapse: sourceFiles > 8,
          })
        : await index.retrieve(args.query, {
            k,
            cacheDir: CACHE_DIR,
            collapse: sourceFiles > 8,
          });
      const ms = Date.now() - t0;

      // RRF scores are tiny and not comparable across queries, but their
      // magnitude does separate signal from noise on this corpus: real
      // questions land around 0.024-0.033 while gibberish tops out near 0.016.
      // Flagging the weak band stops a confident-looking list of irrelevant
      // passages from being read as an answer.
      const top = res.matches[0]?.score ?? 0;
      const confidence =
        top >= 0.022 ? null : top > 0 ? 'low (weak match — treat these as hints, not answers)' : null;

      const header = [
        `${res.matches.length} passages in "${index.vaultName || '知识库'}" for "${res.query}" (${ms}ms, hybrid=${res.dense ? 'semantic+keyword' : 'keyword-only'})`,
        confidence ? `confidence: ${confidence}` : '',
        res.denseError ? `note: semantic half unavailable (${res.denseError})` : '',
        '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text:
              header +
              (res.matches.length
                ? res.matches.map((match, i) => formatHit(match, i, index.root)).join('\n')
                : 'No matches. Try broader keywords, drop the kind/path_prefix filter, or call kb_status to check the index.'),
          },
        ],
      };
    }

    throw new Error(`unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `kb error: ${err.message}` }],
    };
  }
});

await server.connect(new StdioServerTransport());
log('connected on stdio');
// Kick off the load immediately so the first real query is warm.
init().catch(() => {});
