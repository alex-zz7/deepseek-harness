/**
 * The importer's whole public surface: scan, preview, import.
 *
 * Both entry points — the `/import` slash command inside the app and the
 * `dsh-import-sessions` CLI — call exactly these functions, so a preview in the
 * UI and an import at the terminal can never disagree about what will happen.
 *
 * @module @alex/dsh-session-import/library
 */

import { rm } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { planImport, writePlan, verifyArtifact, planDigest, withTitleEvent } from './build.js';
import { readClaude } from './sources/claude.js';
import { readCodex } from './sources/codex.js';
import { readCursor } from './sources/cursor.js';
import { SOURCE_IDS, SOURCES, importSinceMs, scanSource } from './scan.js';
import { ledgerKey, ledgerPath, readLedger, recordImport, writeLedger } from './ledger.js';
import { harnessHome, resolveHarness, sessionsRoot as defaultSessionsRoot } from './harness.js';

export { SOURCE_IDS, SOURCES, DEFAULT_IMPORT_WINDOW_MS, importSinceMs } from './scan.js';
export { ledgerPath, readLedger, ledgerKey } from './ledger.js';
export { harnessHome, sessionsRoot, resolveHarness, candidateRoots } from './harness.js';

/**
 * Collapse a session listing into per-source workspace counts for the picker.
 * @param items - rows from {@link createImporter} `list`.
 * @returns one summary per known source.
 */
export function summarizeListing(items) {
  const buckets = Object.fromEntries(
    SOURCE_IDS.map((id) => [id, { total: 0, imported: 0, pending: 0, workspaces: new Map() }]),
  );
  for (const item of items) {
    const bucket = buckets[item.source];
    if (bucket === undefined) continue;
    bucket.total += 1;
    if (item.imported) bucket.imported += 1;
    else bucket.pending += 1;
    const path = typeof item.cwd === 'string' && item.cwd.length > 0 ? item.cwd.replace(/\/+$/, '') : '';
    const name = path.length > 0 ? basename(path) : '未分组';
    const workspace = bucket.workspaces.get(path) ?? { path, name, total: 0, pending: 0 };
    workspace.total += 1;
    if (!item.imported) workspace.pending += 1;
    bucket.workspaces.set(path, workspace);
  }
  return SOURCE_IDS.map((id) => ({
    id,
    label: SOURCES[id].label,
    total: buckets[id].total,
    imported: buckets[id].imported,
    pending: buckets[id].pending,
    workspaces: [...buckets[id].workspaces.values()].sort(
      (left, right) => right.pending - left.pending || left.name.localeCompare(right.name),
    ),
  }));
}

/** Default title length kept in listings. */
const LIST_TITLE_CHARS = 90;

/**
 * Build an importer bound to one harness home.
 *
 * Every method is safe to call repeatedly; only {@link Importer.run} touches the
 * filesystem, and only to create new session artifacts plus the ledger.
 * @param options - home, sessions root, and optional harness module override.
 * @returns the importer.
 */
export function createImporter(options = {}) {
  const home = options.home ?? harnessHome();
  const roots = {
    home,
    sessionsRoot: options.sessionsRoot ?? defaultSessionsRoot({ home }),
    sessionsRootExplicit: options.sessionsRoot !== undefined,
    claudeRoot: options.claudeRoot,
    codexRoot: options.codexRoot,
    cursorDb: options.cursorDb,
    ledger: options.ledgerPath ?? ledgerPath(home),
    harness: options.harness,
  };
  const scanOptions = { home: roots.home, claudeRoot: roots.claudeRoot, codexRoot: roots.codexRoot, cursorDb: roots.cursorDb };

  /** Which sources to touch for one request. */
  const normalizeSources = (sources) => {
    if (sources === undefined || sources === null || sources.length === 0) return [...SOURCE_IDS];
    const wanted = sources.map((source) => String(source).toLowerCase());
    for (const source of wanted) if (!SOURCE_IDS.includes(source)) throw new Error(`unknown source: ${source}`);
    return wanted;
  };

  const importer = {
    /** Resolved paths, for diagnostics and the UI. */
    paths: roots,

    /**
     * List external sessions on this machine that fall inside the import window.
     *
     * The default window is the last 30 days (`updatedAt`). Pass `sinceMs: 0`
     * to list every session the scanners can see — repair and prune do that
     * so an older ledger row is not treated as vanished.
     * @param request - optional `sources`, `limit`, `query`, `sinceMs`, `windowMs`, `now`.
     * @returns entries with `imported` marked from the ledger.
     */
    async list(request = {}) {
      const sources = normalizeSources(request.sources);
      const ledger = await readLedger(roots.ledger);
      const query = typeof request.query === 'string' ? request.query.trim().toLowerCase() : '';
      const workspace = typeof request.workspace === 'string' && request.workspace.length > 0
        ? request.workspace.replace(/\/+$/, '') || '/'
        : null;
      const sinceMs = importSinceMs(request);
      const items = [];
      for (const source of sources) {
        let refs;
        try {
          refs = scanSource(source, { ...scanOptions, sinceMs, now: request.now });
        } catch {
          refs = [];
        }
        for (const ref of refs) {
          const cwd = typeof ref.cwd === 'string' ? ref.cwd.replace(/\/+$/, '') || '/' : null;
          if (workspace !== null && cwd !== workspace) continue;
          if (query.length > 0 && !matchesQuery(ref, query)) continue;
          const entry = ledger.entries[ledgerKey(source, ref.id)];
          items.push({
            source,
            id: ref.id,
            title: entry?.title ?? (ref.title.length > 0 ? ref.title : ''),
            cwd: ref.cwd ?? entry?.cwd ?? null,
            createdAt: ref.createdAt,
            updatedAt: ref.updatedAt,
            imported: entry !== undefined,
            sessionId: entry?.sessionId ?? null,
            importedAt: entry?.importedAt ?? null,
          });
        }
      }
      items.sort((left, right) => right.updatedAt - left.updatedAt);
      const limit = Number.isInteger(request.limit) && request.limit > 0 ? request.limit : 40;
      return { total: items.length, items: items.slice(0, limit) };
    },

    /**
     * Read and normalize one external session without writing anything.
     * @param request - `source` and `id`, or a full `ref` from the scan; an
     *   optional `sessionId` reuses an existing harness session id, which is how
     *   a repair rewrites an artifact in place instead of importing a duplicate.
     * @returns the plan, or a failure describing why the session cannot be read.
     */
    async preview(request) {
      const ref = request.ref ?? (await importer.find(request.source, request.id));
      if (ref === null) return { ok: false, reason: `no such ${request.source} session: ${request.id}` };
      try {
        const conversation = importer.read(ref);
        const plan = withTitleEvent(planImport(ref, conversation, request.sessionId === undefined ? {} : { id: request.sessionId }));
        return {
          ok: true,
          plan,
          summary: {
            source: plan.source,
            externalId: plan.externalId,
            title: plan.title,
            cwd: plan.cwd ?? null,
            messages: plan.messageCount,
            events: plan.eventCount,
            createdAt: plan.createdAt,
            updatedAt: plan.updatedAt,
            model: conversation.meta.model ?? null,
            artifact: null,
          },
        };
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },

    /**
     * Import one external session.
     * @param request - `source` and `id`, optional `force`, `title`, `sessionId`,
     *   and `replace`. `sessionId` + `replace` rewrite one known session in
     *   place, which is what a repair uses: same identity, rebuilt artifact.
     * @returns a result naming the artifact written and the session it became.
     */
    async importOne(request) {
      const replacing = request.replace === true;
      if (request.force !== true && !replacing && typeof request.source === 'string' && typeof request.id === 'string') {
        const existing = (await readLedger(roots.ledger)).entries[ledgerKey(request.source, request.id)];
        if (existing !== undefined) {
          return {
            ok: true,
            skipped: true,
            source: request.source,
            id: request.id,
            sessionId: existing.sessionId,
            title: existing.title,
            reason: existing.digest === 'empty' ? 'no conversation content' : 'already imported',
          };
        }
      }
      const preview = await importer.preview(request);
      if (!preview.ok) return { ok: false, source: request.source, id: request.id, reason: preview.reason };
      const ledger = await readLedger(roots.ledger);
      const key = ledgerKey(preview.plan.source, preview.plan.externalId);
      const existing = ledger.entries[key];
      if (existing !== undefined && request.force !== true && !replacing) {
        return {
          ok: true,
          skipped: true,
          source: preview.plan.source,
          id: preview.plan.externalId,
          sessionId: existing.sessionId,
          title: existing.title,
          reason: 'already imported',
        };
      }
      if (request.title !== undefined && request.title.trim().length > 0) preview.plan.title = request.title.trim();
      if (preview.plan.messageCount === 0 && request.force !== true && !replacing) {
        await recordImport(
          {
            source: preview.plan.source,
            externalId: preview.plan.externalId,
            sessionId: '',
            title: preview.plan.title,
            cwd: preview.plan.cwd,
            eventCount: 0,
            messageCount: 0,
            artifact: null,
            digest: 'empty',
          },
          roots.ledger,
        );
        return {
          ok: true,
          skipped: true,
          source: preview.plan.source,
          id: preview.plan.externalId,
          title: preview.plan.title,
          messages: 0,
          events: 0,
          cwd: preview.plan.cwd ?? null,
          reason: 'no conversation content',
        };
      }
      const written = await writePlan(preview.plan, { sessionsRoot: roots.sessionsRoot, harness: roots.harness });
      const verified = await verifyArtifact(written.path, { harness: roots.harness });
      await recordImport(
        {
          source: preview.plan.source,
          externalId: preview.plan.externalId,
          sessionId: preview.plan.id,
          title: preview.plan.title,
          cwd: preview.plan.cwd,
          eventCount: preview.plan.eventCount,
          messageCount: preview.plan.messageCount,
          artifact: written.path,
          digest: planDigest(preview.plan),
        },
        roots.ledger,
      );
      return {
        ok: true,
        skipped: false,
        replaced: replacing,
        source: preview.plan.source,
        id: preview.plan.externalId,
        sessionId: preview.plan.id,
        title: preview.plan.title,
        cwd: preview.plan.cwd ?? null,
        artifact: written.path,
        bytes: written.bytes,
        messages: preview.plan.messageCount,
        events: verified.eventCount,
      };
    },

    /**
     * Rebuild every previously imported session from its source.
     *
     * This exists because an importer, like the format it writes, can be wrong:
     * when the harness's read rules tighten, previously written artifacts may no
     * longer load, and the only honest fix is to re-derive them from the original
     * conversation. Each session keeps its id, so the sidebar row the user
     * already has is repaired rather than duplicated. An entry whose artifact is
     * already absent, or whose source is gone, is reported instead of guessed at.
     * @param request - optional `sources`, `ids`, `limit`, and `onProgress`.
     * @returns per-session results plus totals.
     */
    async repair(request = {}) {
      const ledger = await readLedger(roots.ledger);
      const wantedSources = normalizeSources(request.sources);
      const wantedIds = Array.isArray(request.ids) && request.ids.length > 0 ? new Set(request.ids.map(String)) : null;
      const entries = Object.entries(ledger.entries).filter(([key]) => {
        const source = key.slice(0, key.indexOf(':'));
        const externalId = key.slice(key.indexOf(':') + 1);
        if (!wantedSources.includes(source)) return false;
        return wantedIds === null ? true : wantedIds.has(externalId);
      });
      const limited = Number.isInteger(request.limit) && request.limit > 0 ? entries.slice(0, request.limit) : entries;
      const results = [];
      let repaired = 0;
      let failed = 0;
      for (const [key, entry] of limited) {
        const separator = key.indexOf(':');
        const source = key.slice(0, separator);
        const externalId = key.slice(separator + 1);
        let result;
        try {
          result = await importer.importOne({ source, id: externalId, sessionId: entry.sessionId, replace: true, force: true, title: entry.title });
        } catch (error) {
          result = { ok: false, source, id: externalId, reason: error instanceof Error ? error.message : String(error) };
        }
        results.push(result);
        if (result.ok === true && result.skipped !== true) repaired++;
        else failed++;
        request.onProgress?.(result, results.length, limited.length);
      }
      return { results, repaired, failed, considered: limited.length };
    },

    /**
     * Drop imported sessions that are no longer in the source's live index.
     *
     * Cursor's disk keeps archived tabs and agent-transcript leftovers that
     * the IDE sidebar does not show. Those can be imported once and then
     * pruned so DeepSeek only keeps the chats Cursor still lists.
     * @param request - optional `sources` (defaults to `cursor`).
     * @returns removed ledger keys and how many current chats were kept.
     */
    async prune(request = {}) {
      const wantedSources = normalizeSources(request.sources ?? ['cursor']);
      const listing = await importer.list({ sources: wantedSources, limit: Number.MAX_SAFE_INTEGER, sinceMs: 0 });
      const keep = new Set(listing.items.map((item) => ledgerKey(item.source, item.id)));
      const ledger = await readLedger(roots.ledger);
      const removed = [];
      for (const [key, entry] of Object.entries(ledger.entries)) {
        const source = key.slice(0, key.indexOf(':'));
        if (!wantedSources.includes(source)) continue;
        if (keep.has(key)) continue;
        if (typeof entry?.artifact === 'string' && entry.artifact.length > 0) {
          await rm(dirname(entry.artifact), { recursive: true, force: true });
        }
        delete ledger.entries[key];
        removed.push({
          key,
          sessionId: entry?.sessionId ?? '',
          title: entry?.title ?? '',
          cwd: entry?.cwd ?? null,
        });
      }
      await writeLedger(ledger, roots.ledger);
      return { removed, kept: keep.size, considered: keep.size + removed.length };
    },

    /**
     * Import many sessions, newest first.
     * @param request - `sources`, `limit`, `query`, `force`, `ids`, and `onProgress`.
     * @returns per-session results plus totals.
     */
    async run(request = {}) {
      const listing = await importer.list({ ...request, limit: Number.MAX_SAFE_INTEGER });
      const wanted = Array.isArray(request.ids) && request.ids.length > 0 ? new Set(request.ids.map(String)) : null;
      const candidates = listing.items.filter((item) => {
        if (wanted !== null) return wanted.has(item.id);
        if (request.force === true) return true;
        return item.imported !== true;
      });
      const limit = Number.isInteger(request.limit) && request.limit > 0 ? request.limit : candidates.length;
      const results = [];
      let imported = 0;
      let skipped = 0;
      let failed = 0;
      let writes = 0;
      /** An empty conversation has nothing to import; say so instead of writing a blank session. */
      const emptyResult = (item, preview) => ({
        ok: true,
        skipped: true,
        source: item.source,
        id: item.id,
        title: preview.summary.title,
        messages: 0,
        events: 0,
        cwd: preview.summary.cwd,
        reason: 'no conversation content',
      });
      for (const item of candidates) {
        if (writes >= limit) break;
        if (request.dryRun === true) {
          const preview = await importer.preview({ source: item.source, id: item.id });
          let result;
          if (!preview.ok) result = { ok: false, source: item.source, id: item.id, reason: preview.reason };
          else if (preview.summary.messages === 0 && request.force !== true) result = emptyResult(item, preview);
          else {
            result = {
              ok: true,
              skipped: item.imported,
              source: item.source,
              id: item.id,
              title: preview.summary.title,
              messages: preview.summary.messages,
              events: preview.summary.events,
              cwd: preview.summary.cwd,
            };
          }
          results.push(result);
          if (result.ok) (result.skipped ? skipped++ : imported++);
          else failed++;
          if (!result.ok || result.reason !== 'no conversation content') writes += 1;
          request.onProgress?.(result, results.length, candidates.length);
          continue;
        }
        const result = await importer.importOne({ source: item.source, id: item.id, force: request.force });
        results.push(result);
        if (!result.ok) failed++;
        else if (result.skipped === true) skipped++;
        else imported++;
        if (!result.ok || result.reason !== 'no conversation content') writes += 1;
        request.onProgress?.(result, results.length, candidates.length);
      }
      return { results, imported, skipped, failed, considered: candidates.length };
    },

    /**
     * Locate one session's reference by source id.
     * @param source - source id.
     * @param id - the source's session id.
     * @returns the reference, or null.
     */
    async find(source, id) {
      if (typeof source !== 'string' || typeof id !== 'string') return null;
      const refs = scanSource(source, { ...scanOptions, sinceMs: 0 });
      return refs.find((ref) => ref.id === id) ?? null;
    },

    /**
     * Read one reference into the normalized conversation shape.
     * @param ref - a reference from the scan.
     * @returns the normalized conversation.
     */
    read(ref) {
      if (ref.source === 'claude') return readClaude(ref);
      if (ref.source === 'codex') return readCodex(ref);
      if (ref.source === 'cursor') return readCursor(ref);
      throw new Error(`unknown session source: ${ref.source}`);
    },

    /** The ledger as stored. */
    ledger() {
      return readLedger(roots.ledger);
    },

    /** Ensure the harness codec is importable, and report what was found. */
    async check() {
      const harness = await resolveHarness({ base: roots.harnessBase, harness: roots.harness });
      return { ok: true, currentVersion: harness.catalog.currentVersion, sessionsRoot: roots.sessionsRoot };
    },
  };
  return importer;
}

/** Case-insensitive match over the fields a person would search by. */
function matchesQuery(ref, query) {
  const haystack = `${ref.title} ${ref.cwd ?? ''} ${ref.id}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Format one listed session for a terminal or a chat message.
 * @param item - one entry from {@link createImporter} `list`.
 * @param options - `now` and `titles` control the relative age and truncation.
 * @returns one line.
 */
export function formatListLine(item, options = {}) {
  const now = options.now ?? Date.now();
  const title = (item.title.length > 0 ? item.title : '(untitled)').replace(/\s+/g, ' ');
  const clipped = title.length > LIST_TITLE_CHARS ? `${title.slice(0, LIST_TITLE_CHARS - 1)}…` : title;
  const workspace = item.cwd === null || item.cwd === undefined ? 'no workspace' : basename(item.cwd);
  const mark = item.imported ? '✓' : ' ';
  return `${mark} ${item.source.padEnd(6)} ${relativeAge(item.updatedAt, now).padEnd(9)} ${workspace.padEnd(18)} ${clipped}`;
}

/** Human-readable age from epoch milliseconds. */
export function relativeAge(time, now = Date.now()) {
  if (!Number.isFinite(time) || time <= 0) return 'unknown';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
