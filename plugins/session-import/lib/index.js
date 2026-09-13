/**
 * Host half of the session importer.
 *
 * Two surfaces share one implementation:
 *
 * - `/import` and `/imports` in the composer, for driving an import without
 *   leaving the conversation;
 * - `/session-import/*` routes, which the sidebar's Import dialog calls.
 *
 * Both go through the same {@link createImporter}, so the numbers the dialog
 * shows are the numbers the import writes.
 *
 * @module @alex/dsh-session-import
 */

import { createImporter, SOURCE_IDS, SOURCES, formatListLine, summarizeListing } from './library.js';
import { verifyArtifact } from './build.js';
import { ledgerPath, readLedger, forgetImport } from './ledger.js';
import { isAbsolute } from 'node:path';

export { createImporter } from './library.js';
export { createImporter as create } from './library.js';

/** Cordis plugin name. */
export const name = 'session-import';

/**
 * Services required before activation.
 *
 * `workspaceRegistry` is optional on purpose: importing sessions must work in a
 * deployment that has no workspace concept, it just will not group the imported
 * sessions under their original directory.
 */
export const inject = ['webServer', 'commands'];

const DISCOVER_ROUTE = '/session-import/discover';
const PREVIEW_ROUTE = '/session-import/preview';
const RUN_ROUTE = '/session-import/run';
const LEDGER_ROUTE = '/session-import/ledger';

/** Cap on one request body. */
const MAX_BODY_BYTES = 1 << 20;

/**
 * Register the routes and commands.
 * @param ctx - host context carrying the webserver and command registry.
 */
export function apply(ctx) {
  const importer = createImporter();

  ctx.inject(['workspaceRegistry'], (bound) => {
    void reconcileImportedSessions(bound).catch(() => {});
    return () => {};
  });

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: DISCOVER_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'GET' && req.method !== 'POST') {
            sendJson(res, 405, { code: 'method-not-allowed' });
            return;
          }
          const body = req.method === 'POST' ? await readJsonBody(req) : { value: {} };
          if (body.error !== undefined) {
            sendJson(res, 400, { code: body.error });
            return;
          }
          try {
            const listing = await importer.list({
              sources: body.value?.sources,
              workspace: body.value?.workspace,
              query: body.value?.query,
              limit: body.value?.limit ?? Number.MAX_SAFE_INTEGER,
            });
            sendJson(res, 200, {
              ok: true,
              sources: SOURCE_IDS.map((id) => SOURCES[id]),
              paths: { sessionsRoot: importer.paths.sessionsRoot, ledger: importer.paths.ledger },
              summaries: summarizeListing(listing.items),
              total: listing.total,
            });
          } catch (error) {
            sendJson(res, 500, { ok: false, code: 'discover-failed', message: messageOf(error) });
          }
        },
      }),
    `session-import: ${DISCOVER_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PREVIEW_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { code: 'method-not-allowed' });
            return;
          }
          const body = await readJsonBody(req);
          if (body.error !== undefined) {
            sendJson(res, 400, { code: body.error });
            return;
          }
          const { source, id } = body.value ?? {};
          const preview = await importer.preview({ source, id });
          if (!preview.ok) {
            sendJson(res, 200, { ok: false, reason: preview.reason });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            summary: preview.summary,
            transcript: preview.plan.events
              .filter((event) => event.type === 'user/message' || event.type === 'assistant/message')
              .slice(0, 40)
              .map((event) => transcriptRow(event)),
          });
        },
      }),
    `session-import: ${PREVIEW_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: RUN_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { code: 'method-not-allowed' });
            return;
          }
          const body = await readJsonBody(req);
          if (body.error !== undefined) {
            sendJson(res, 400, { code: body.error });
            return;
          }
          const request = body.value ?? {};
          if (!Array.isArray(request.sources) || request.sources.length !== 1 || !SOURCE_IDS.includes(request.sources[0])) {
            sendJson(res, 400, { ok: false, code: 'source-required', message: '请先选择一个会话来源' });
            return;
          }
          try {
            const result = await importer.run({
              sources: request.sources,
              workspace:
                typeof request.workspace === 'string' && isAbsolute(request.workspace) ? request.workspace : undefined,
              ids: request.ids,
              query: request.query,
              limit: request.limit,
              force: request.force === true,
            });
            const workspaces = await registerWorkspaces(ctx, result.results);
            sendJson(res, 200, { ok: true, ...result, workspaces });
          } catch (error) {
            sendJson(res, 500, { ok: false, code: 'import-failed', message: messageOf(error) });
          }
        },
      }),
    `session-import: ${RUN_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: LEDGER_ROUTE,
        handler: async (req, res) => {
          if (req.method === 'GET') {
            const ledger = await readLedger(importer.paths.ledger);
            sendJson(res, 200, { ok: true, path: ledgerPath(importer.paths.home), entries: ledger.entries });
            return;
          }
          if (req.method === 'DELETE') {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const source = url.searchParams.get('source');
            const id = url.searchParams.get('id');
            if (source === null || id === null) {
              sendJson(res, 400, { code: 'missing-source-or-id' });
              return;
            }
            const removed = await forgetImport(source, id, importer.paths.ledger);
            sendJson(res, 200, { ok: true, removed });
            return;
          }
          sendJson(res, 405, { code: 'method-not-allowed' });
        },
      }),
    `session-import: ${LEDGER_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'imports',
        description: 'List external agent sessions (Cursor, Claude Code, Codex) available to import',
        input: { hint: '[query]' },
        handler: async (invocation) => {
          const query = invocation.rawInput.trim();
          const listing = await importer.list({ query, limit: 25 });
          if (listing.total === 0) {
            return {
              kind: 'success',
              text:
                query.length > 0
                  ? `No external sessions match "${query}".`
                  : 'No importable sessions found in Cursor, Claude Code, or Codex.',
            };
          }
          const importable = listing.items.filter((item) => !item.imported);
          const lines = [
            `${listing.total} external session${listing.total === 1 ? '' : 's'} found; ${importable.length} not imported yet.`,
            '✓ = already imported. Use /import <source> [n] to bring the newest ones in.',
            '',
            ...listing.items.map((item) => formatListLine(item)),
          ];
          return { kind: 'success', text: lines.join('\n') };
        },
      }),
    'session-import: /imports',
  );

  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'import',
        description: 'Import Cursor, Claude Code, or Codex sessions and their workspaces into the sidebar',
        input: { hint: '<source> [count] [--force]' },
        handler: async (invocation) => {
          const parsed = parseImportArgs(invocation.rawInput);
          if (!parsed.ok) return { kind: 'error', text: parsed.reason };
          const run = await importer.run({
            sources: parsed.sources,
            query: parsed.query,
            limit: parsed.limit,
            force: parsed.force,
          });
          if (run.considered === 0) {
            return {
              kind: 'error',
              text: `No ${parsed.sources.join(' / ')} sessions matched. Run /imports to list what is available.`,
            };
          }
          await registerWorkspaces(ctx, run.results);
          const lines = [
            `Imported ${run.imported}, skipped ${run.skipped} already-imported, ${run.failed} failed.`,
            '',
            ...run.results.map((result) =>
              result.ok === false
                ? `✗ ${result.source} ${String(result.id).slice(0, 8)} — ${result.reason}`
                : `${result.skipped ? '•' : '✓'} ${result.source} · ${truncate(result.title ?? result.id, 70)}${result.cwd ? ` → ${result.cwd}` : ''}${result.skipped && result.reason !== 'already imported' ? ` (${result.reason})` : ''}`,
            ),
          ];
          if (run.imported > 0) {
            lines.push('', 'The imported sessions are grouped under their original workspace in the sidebar.');
          }
          return { kind: 'success', text: lines.join('\n') };
        },
      }),
    'session-import: /import',
  );
}

/**
 * Parse `/import` arguments.
 *
 * The grammar is deliberately small and forgiving, because it is typed by hand:
 * an optional source list, an optional count, and two flags.
 * @param rawInput - text following the command name.
 * @returns a normalized request, or why it was rejected.
 */
export function parseImportArgs(rawInput) {
  const tokens = String(rawInput ?? '')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const sources = [];
  let limit;
  let force = false;
  let query = '';
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === '--all' || lower === '-a') {
      limit = Number.MAX_SAFE_INTEGER;
      continue;
    }
    if (lower === '--force' || lower === '-f') {
      force = true;
      continue;
    }
    if (SOURCE_IDS.includes(lower) || lower === 'all') {
      if (lower === 'all') sources.push(...SOURCE_IDS);
      else sources.push(lower);
      continue;
    }
    if (/^\d+$/.test(lower)) {
      const value = Number.parseInt(lower, 10);
      if (value === 0) return { ok: false, reason: 'the count must be at least 1' };
      limit = value;
      continue;
    }
    query = query.length === 0 ? token : `${query} ${token}`;
  }
  const unique = [...new Set(sources)];
  if (unique.length === 0) {
    return {
      ok: false,
      reason: '请先指定来源：/import cursor|claude|codex。',
    };
  }
  return {
    ok: true,
    sources: unique,
    limit,
    force,
    query,
  };
}

/**
 * Put imported sessions into the sidebar under their original folder.
 *
 * Writing the artifact is not enough. The sidebar only lists a session once
 * the host has seen it, and it only sits under a workspace after
 * `attachSession`. Creating the folder alone produced empty workspace rows.
 * @param ctx - host context.
 * @param results - import results carrying `sessionId` and `cwd`.
 * @returns the workspace titles that received at least one session.
 */
async function registerWorkspaces(ctx, results) {
  const registry = ctx.get('workspaceRegistry');
  if (registry === undefined) return [];
  const claimed = results.filter(
    (result) =>
      result.ok !== false &&
      typeof result.sessionId === 'string' &&
      result.sessionId.length > 0 &&
      typeof result.cwd === 'string' &&
      result.cwd.length > 0,
  );
  const workspaces = new Map();
  const titles = [];
  for (const result of claimed) {
    try {
      let workspace = workspaces.get(result.cwd);
      if (workspace === undefined) {
        workspace = await registry.create(result.cwd);
        workspaces.set(result.cwd, workspace);
        titles.push(workspace?.title ?? result.cwd.split('/').at(-1) ?? result.cwd);
      }
      await workspace.attachSession(result.sessionId);
    } catch {
      // A missing directory or a cwd the registry cannot resolve is not an import failure.
    }
  }
  await hydrateImportedSessions(ctx, claimed.map((result) => result.sessionId));
  await publishImportedSessions(ctx, claimed.map((result) => result.sessionId));
  return titles;
}

/**
 * Fold each imported log into the projection cache so the sidebar can show
 * the conversation title instead of the workspace folder name.
 *
 * Cold list rows only read cached projections. A file written outside the
 * harness has no cache row, so `displayTitle` falls back to the cwd basename.
 * @param ctx - host context.
 * @param sessionIds - imported harness session ids.
 */
async function hydrateImportedSessions(ctx, sessionIds) {
  const cache = ctx.get('sessionProjectionCache');
  if (cache === undefined || typeof cache.coldSnapshot !== 'function') return;
  const ledger = await readLedger();
  const byId = new Map(
    Object.values(ledger.entries)
      .filter((entry) => typeof entry?.sessionId === 'string' && typeof entry?.artifact === 'string')
      .map((entry) => [entry.sessionId, entry]),
  );
  for (const sessionId of sessionIds) {
    const entry = byId.get(sessionId);
    if (entry === undefined) continue;
    try {
      const verified = await verifyArtifact(entry.artifact);
      cache.coldSnapshot(verified.header, 0, verified.events);
      await waitForCachedTitle(cache, verified.header, 1500);
    } catch {
      // Title appears the next time the user opens the session.
    }
  }
}

/** Wait until the cache has a title row, or the timeout elapses. */
function waitForCachedTitle(cache, header, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const snapshot = typeof cache.cachedSnapshot === 'function' ? cache.cachedSnapshot(header, 0) : undefined;
      if (typeof snapshot?.values?.title === 'string' || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

/**
 * Tell the live sidebar about sessions that were written as files.
 *
 * `session/created` never fires for a foreign write, so the client list stays
 * stale until we emit the same `api-session/added` row the controller uses
 * when it creates a session itself.
 * @param ctx - host context.
 * @param sessionIds - imported harness session ids.
 */
async function publishImportedSessions(ctx, sessionIds) {
  const wanted = new Set(sessionIds);
  if (wanted.size === 0) return;
  const controller = ctx.get('sessionController');
  if (controller === undefined || typeof controller.list !== 'function') return;
  try {
    const listed = await controller.list({}, AbortSignal.timeout(30_000));
    const items = Array.isArray(listed?.items) ? listed.items : [];
    for (const summary of items) {
      if (wanted.has(summary.sessionId)) ctx.emit('api-session/added', summary);
    }
  } catch {
    // A list failure leaves the files on disk; the next reload still picks them up.
  }
}

/**
 * Attach sessions from an earlier import that only created empty folders.
 * @param ctx - host context.
 */
async function reconcileImportedSessions(ctx) {
  const ledger = await readLedger();
  const results = Object.values(ledger.entries).flatMap((entry) => {
    if (typeof entry?.sessionId !== 'string' || typeof entry?.cwd !== 'string') return [];
    return [{ ok: true, sessionId: entry.sessionId, cwd: entry.cwd }];
  });
  if (results.length === 0) return;
  await registerWorkspaces(ctx, results);
}

/** One transcript row for the preview list. */
function transcriptRow(event) {
  const message = event.data.message ?? event.data;
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const reasoning = blocks
    .filter((block) => block.type === 'reasoning')
    .map((block) => block.text)
    .join('\n');
  return {
    role: message.role === 'assistant' ? 'assistant' : 'user',
    text: truncate(text, 400),
    reasoningChars: reasoning.length,
    time: event.time,
  };
}

/** Truncate with an ellipsis, preserving the tail marker for the reader. */
function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Write one JSON response. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Read and parse a bounded JSON request body. */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return { error: 'body-too-large' };
    chunks.push(chunk);
  }
  if (total === 0) return { value: {} };
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { value: parsed === null || typeof parsed !== 'object' ? {} : parsed };
  } catch {
    return { error: 'invalid-json' };
  }
}

/** Message text of an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
