/**
 * Session discovery for the external agents DeepSeek Harness can import from.
 *
 * Every scanner answers the same question with the same shape: which sessions
 * exist on this machine, where their bytes live, and what workspace each one
 * belongs to. Parsing is deliberately left to the `sources/*` modules — a scan
 * must stay cheap enough to run on every `/import` invocation, and Cursor's
 * store alone holds thousands of conversation rows.
 *
 * @module @alex/dsh-session-import/scan
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { plainTextOf, promptTitle, toMillis, usableTitle } from './conversation.js';

/** The agents this plugin knows how to read. */
export const SOURCE_IDS = ['cursor', 'claude', 'codex'];

/**
 * Import listing window. Discover, `/import`, and the settings picker all
 * share this: a scan that is not given an explicit `sinceMs` only returns
 * conversations touched in the last 30 days. Identity lookups (`find`,
 * repair, prune) pass `sinceMs: 0` so an already-imported older session can
 * still be opened by id.
 */
export const DEFAULT_IMPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Resolve the earliest `updatedAt` a listing should keep.
 *
 * `sinceMs === 0` or `windowMs === 0` means no window. Any other missing
 * value falls back to "now minus {@link DEFAULT_IMPORT_WINDOW_MS}".
 * @param options - optional `sinceMs`, `windowMs`, and `now`.
 * @returns epoch milliseconds, or `0` for an unbounded scan.
 */
export function importSinceMs(options = {}) {
  if (options.sinceMs === 0 || options.windowMs === 0) return 0;
  if (Number.isFinite(options.sinceMs) && options.sinceMs > 0) return options.sinceMs;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const windowMs =
    Number.isFinite(options.windowMs) && options.windowMs > 0 ? options.windowMs : DEFAULT_IMPORT_WINDOW_MS;
  return now - windowMs;
}

/** True when `time` is inside the listing window (or the window is off). */
export function isWithinImportWindow(time, sinceMs) {
  if (!Number.isFinite(sinceMs) || sinceMs <= 0) return true;
  return Number(time) >= sinceMs;
}

/** Display metadata for the picker and the CLI listing. */
export const SOURCES = {
  cursor: {
    id: 'cursor',
    label: 'Cursor',
    hint: 'Cursor sidebar chats (composerHeaders, not archived)',
  },
  claude: {
    id: 'claude',
    label: 'Claude Code',
    hint: '~/.claude/projects/<project>/<session>.jsonl',
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    hint: '~/.codex/sessions/**/rollout-*.jsonl',
  },
};

/**
 * One discovered session, before its messages are read.
 *
 * `messages` is intentionally absent: a scan returns the index, and
 * {@link readMessages} turns one entry into a conversation. Keeping the two
 * apart is what lets the UI list two thousand Cursor tabs without decoding
 * two thousand transcripts.
 */
export function sessionRef(source, id, options) {
  return {
    source,
    id,
    title: options.title ?? '',
    cwd: options.cwd ?? undefined,
    createdAt: options.createdAt ?? 0,
    updatedAt: options.updatedAt ?? options.createdAt ?? 0,
    locator: options.locator,
    meta: options.meta ?? {},
  };
}

/** Resolve the home directory a scan should read from. */
export function homeDir() {
  return process.env.DSH_IMPORT_HOME ?? homedir();
}

/**
 * Enumerate every session group a source keeps, in newest-first order.
 *
 * Unless `sinceMs` is `0`, only conversations whose `updatedAt` falls inside
 * {@link importSinceMs} are returned. That is the import window — listing and
 * `/import` share it so an older Claude or Codex rollout cannot slip through
 * a UI that only hid the count.
 * @param source - one of {@link SOURCE_IDS}.
 * @param options - optional root override, `sinceMs`, `windowMs`, and `now`.
 * @returns discovered session references.
 */
export function scanSource(source, options = {}) {
  if (source === 'claude') return scanClaude(options);
  if (source === 'codex') return scanCodex(options);
  if (source === 'cursor') return scanCursor(options);
  throw new Error(`unknown session source: ${source}`);
}

/** Recursively collect files whose basename matches a predicate. */
function walkFiles(root, match, out = [], depth = 0) {
  if (depth > 8 || !existsSync(root)) return out;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkFiles(path, match, out, depth + 1);
      continue;
    }
    if (entry.isFile() && match(entry.name)) out.push(path);
  }
  return out;
}

/** Modification time in epoch milliseconds, or 0 when unreadable. */
function mtimeMs(path) {
  try {
    return Math.round(statSync(path).mtimeMs);
  } catch {
    return 0;
  }
}

/** Default listing scan: 2 MiB, 512 records. Huge plugin catalogs are skipped. */
const HEAD_BYTE_LIMIT = 2 << 20;
const HEAD_RECORD_LIMIT = 512;
const HEAD_LINE_LIMIT = 512 << 10;

/**
 * Walk the opening JSONL records of a session file without loading it all.
 *
 * Claude and Codex put workspace and identity near the head, but Codex desktop
 * often writes a multi-hundred-kilobyte `<recommended_plugins>` user-role dump
 * before the prompt the person typed. A fixed 256 KiB window stops on that
 * line and the listing title becomes empty. This walker skips an oversized
 * line and keeps going until the visitor stops, or the byte / record caps.
 * @param path - the session file.
 * @param visit - called with each parsed record; return `false` to stop.
 * @param options - optional `byteLimit` and `recordLimit`.
 */
export function scanJsonlHead(path, visit, options = {}) {
  const byteLimit = options.byteLimit ?? HEAD_BYTE_LIMIT;
  const recordLimit = options.recordLimit ?? HEAD_RECORD_LIMIT;
  let fd;
  try {
    fd = openSync(path, 'r');
    const chunk = Buffer.allocUnsafe(65536);
    let leftover = '';
    let offset = 0;
    let records = 0;
    while (offset < byteLimit && records < recordLimit) {
      const wanted = Math.min(chunk.length, byteLimit - offset);
      const read = readSync(fd, chunk, 0, wanted, offset);
      if (read === 0) break;
      offset += read;
      leftover += chunk.subarray(0, read).toString('utf8');
      const lines = leftover.split('\n');
      leftover = lines.pop() ?? '';
      if (leftover.length > HEAD_LINE_LIMIT) leftover = '';
      for (const line of lines) {
        if (line.trim().length === 0) continue;
        if (line.length > HEAD_LINE_LIMIT) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        records += 1;
        if (visit(record) === false) return;
        if (records >= recordLimit) return;
      }
    }
  } catch {
    // Unreadable files are treated as empty listings.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Parse the opening JSONL records of a session file.
 *
 * Prefer {@link scanJsonlHead} when the caller only needs a title or cwd —
 * this helper still exists for tests and for callers that want the raw head.
 * @param path - the session file.
 * @param limit - maximum records to return.
 * @returns the parsed head records, in file order.
 */
export function readHeadRecords(path, limit = 256) {
  const out = [];
  scanJsonlHead(
    path,
    (record) => {
      out.push(record);
      return out.length < limit;
    },
    { recordLimit: limit },
  );
  return out;
}

/**
 * Claude Code keeps one JSONL per session under a directory named after the
 * project path. The directory name is lossy, so the authoritative workspace is
 * read out of the session's own records by the parser; the directory only
 * orders the scan.
 * @param options - optional `{ claudeRoot }` override.
 * @returns discovered Claude sessions, newest first.
 */
export function scanClaude(options = {}) {
  const root = options.claudeRoot ?? join(homeDir(), '.claude', 'projects');
  const sinceMs = importSinceMs(options);
  const files = walkFiles(root, (name) => name.endsWith('.jsonl'));
  const refs = [];
  for (const path of files) {
    const updatedAt = mtimeMs(path);
    if (!isWithinImportWindow(updatedAt, sinceMs)) continue;
    const facts = claudeHeadFacts(path);
    if (facts.empty) continue;
    refs.push(
      sessionRef('claude', path.slice(0, -'.jsonl'.length).split('/').pop(), {
        locator: { path },
        title: facts.title,
        cwd: facts.cwd,
        updatedAt,
        createdAt: facts.createdAt || updatedAt,
        meta: { projectDir: path.slice(root.length + 1).split('/')[0], gitBranch: facts.gitBranch },
      }),
    );
  }
  refs.sort((left, right) => right.updatedAt - left.updatedAt);
  return refs;
}

/**
 * Codex writes `rollout-<iso>-<uuid>.jsonl` under `sessions/YYYY/MM/DD/`, plus a
 * flat `archived_sessions/` for threads the user archived. The uuid in the file
 * name is the session id the rollout itself carries.
 * @param options - optional `{ codexRoot }` override.
 * @returns discovered Codex sessions, newest first.
 */
export function scanCodex(options = {}) {
  const root = options.codexRoot ?? join(homeDir(), '.codex');
  const sinceMs = importSinceMs(options);
  const files = [
    ...walkFiles(join(root, 'sessions'), (name) => name.startsWith('rollout-') && name.endsWith('.jsonl')),
    ...walkFiles(join(root, 'archived_sessions'), (name) => name.startsWith('rollout-') && name.endsWith('.jsonl')),
  ];
  const refs = [];
  for (const path of files) {
    const updatedAt = mtimeMs(path);
    if (!isWithinImportWindow(updatedAt, sinceMs)) continue;
    const name = path.split('/').pop();
    const facts = codexHeadFacts(path);
    if (facts.empty) continue;
    const id =
      typeof facts.sessionId === 'string' && facts.sessionId.length > 0
        ? facts.sessionId
        : name.replace(/^rollout-/, '').replace(/\.jsonl$/, '').replace(/^\d{4}-\d{2}-\d{2}T[\d-]+-/, '');
    refs.push(
      sessionRef('codex', id, {
        locator: { path },
        title: facts.title,
        cwd: facts.cwd,
        updatedAt,
        createdAt: facts.createdAt || updatedAt,
        meta: { archived: path.includes('/archived_sessions/'), originator: facts.originator },
      }),
    );
  }
  refs.sort((left, right) => right.updatedAt - left.updatedAt);
  return refs;
}

/**
 * Cursor's sidebar is the non-archived, non-draft `composerHeaders` rows.
 * Agent-transcript JSONL is only used as a fallback when a sidebar chat has
 * no SQLite bubbles. Disk history that never appears in the sidebar is
 * ignored, so an import matches what Cursor itself lists.
 *
 * The database is opened read-only and never written. Cursor may be running:
 * SQLite readers do not block the IDE's writes, and rows written while the scan
 * walks are simply not seen.
 * @param options - optional `{ cursorDb }` override.
 * @returns discovered Cursor conversations, newest first.
 */
export function scanCursor(options = {}) {
  const path =
    options.cursorDb ??
    join(homeDir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  const sinceMs = importSinceMs(options);
  const byId = new Map();
  if (existsSync(path)) {
    const db = openCursorDb(path);
    try {
      const rows = db.prepare('SELECT composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, value FROM composerHeaders').all();
      for (const row of rows) {
        if (row.isSubagent === 1 || row.isArchived === 1) continue;
        const updatedAt = Number(row.lastUpdatedAt) || Number(row.createdAt) || 0;
        if (!isWithinImportWindow(updatedAt, sinceMs)) continue;
        let header = {};
        try {
          header = JSON.parse(row.value);
        } catch {
          header = {};
        }
        if (header.isDraft === true || header.isBestOfNSubcomposer === true) continue;
        if (header.isArchived === true) continue;
        const cwd = header?.workspaceIdentifier?.uri?.fsPath || header?.workspaceIdentifier?.uri?.path;
        const named = usableTitle(typeof header.name === 'string' ? header.name : '', cwd);
        const hasBubbles = composerHasBubbles(db, row.composerId);
        if (named.length === 0 && !hasBubbles) continue;
        byId.set(
          row.composerId,
          sessionRef('cursor', row.composerId, {
            title: named,
            cwd: typeof cwd === 'string' && cwd.startsWith('/') ? cwd.replace(/\/+$/, '') : undefined,
            createdAt: Number(row.createdAt) || 0,
            updatedAt,
            locator: { path, composerId: row.composerId },
            meta: {
              subtitle: typeof header.subtitle === 'string' ? header.subtitle : '',
              unifiedMode: typeof header.unifiedMode === 'string' ? header.unifiedMode : '',
              archived: row.isArchived === 1,
              hasBubbles,
            },
          }),
        );
      }
    } finally {
      db.close();
    }
  }
  attachCursorTranscripts(byId, options);
  const refs = [...byId.values()].filter((ref) => ref.title.length > 0 || ref.meta.hasBubbles === true);
  refs.sort((left, right) => right.updatedAt - left.updatedAt);
  return refs;
}

/**
 * Open Cursor's key-value store read-only.
 *
 * `node:sqlite` is used rather than a dependency because it ships with the
 * Node the harness already runs on; the store is opened without WAL recovery so
 * a running Cursor cannot make the import mutate the IDE's database.
 * @param path - absolute path to `state.vscdb`.
 * @returns an open read-only handle.
 */
export function openCursorDb(path) {
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  return new DatabaseSync(path, { readOnly: true });
}

/**
 * Collect Claude listing facts while skipping folder-name titles and empty files.
 * @param path - session JSONL.
 * @returns title, cwd, and whether the file has no conversation.
 */
function claudeHeadFacts(path) {
  let cwd;
  let gitBranch = null;
  let createdAt = 0;
  let aiTitle = '';
  let customTitle = '';
  let firstPrompt = '';
  let sawTurn = false;
  scanJsonlHead(path, (record) => {
    if (typeof record.cwd === 'string' && record.cwd.startsWith('/')) {
      cwd = record.cwd;
      if (typeof record.gitBranch === 'string') gitBranch = record.gitBranch;
    }
    if (createdAt === 0) createdAt = toMillis(record.timestamp, 0);
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') aiTitle = record.aiTitle;
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') customTitle = record.customTitle;
    if (record.type === 'user' && record.isSidechain !== true && record.isMeta !== true) {
      const titled = promptTitle(plainTextOf(record.message?.content), cwd);
      if (titled.length > 0) {
        sawTurn = true;
        if (firstPrompt.length === 0) firstPrompt = titled;
      }
    }
    if (record.type === 'assistant' && record.isSidechain !== true && record.isMeta !== true) sawTurn = true;
    return usableTitle(aiTitle, cwd).length === 0;
  });
  const title = usableTitle(aiTitle, cwd) || usableTitle(customTitle, cwd) || firstPrompt;
  return { title, cwd, createdAt, gitBranch, empty: !sawTurn && title.length === 0 && isTinyFile(path) };
}

/**
 * Collect Codex listing facts. The first user-role item is usually scaffolding;
 * skip it and keep walking until a real prompt or an empty realtime thread.
 * @param path - rollout JSONL.
 * @returns title, cwd, session id, and whether the file has no conversation.
 */
function codexHeadFacts(path) {
  let sessionId;
  let cwd;
  let createdAt = 0;
  let originator = null;
  let title = '';
  let sawTurn = false;
  scanJsonlHead(path, (record) => {
    const payload = record.payload;
    if (record.type === 'session_meta' && payload && typeof payload === 'object') {
      if (sessionId === undefined && typeof payload.session_id === 'string') sessionId = payload.session_id;
      if (typeof payload.cwd === 'string' && payload.cwd.startsWith('/')) cwd = payload.cwd;
      createdAt = toMillis(payload.timestamp, createdAt);
      if (typeof payload.originator === 'string') originator = payload.originator;
      return;
    }
    if (record.type !== 'response_item' || payload?.type !== 'message') return;
    if (payload.role === 'assistant') sawTurn = true;
    if (payload.role === 'user' && title.length === 0) {
      title = promptTitle(plainTextOf(payload.content), cwd);
      if (title.length > 0) sawTurn = true;
    }
    return title.length === 0;
  });
  return { title, cwd, sessionId, createdAt, originator, empty: !sawTurn && title.length === 0 && isTinyFile(path) };
}

/** True when a session file is small enough that a head scan has seen all of it. */
function isTinyFile(path) {
  try {
    return statSync(path).size < 32768;
  } catch {
    return true;
  }
}

/**
 * Attach a transcript file to a sidebar chat when SQLite has no bubbles.
 *
 * Transcripts that do not belong to a current sidebar header stay out of
 * the index — those are Cursor's on-disk leftovers, not what the IDE lists.
 * @param byId - composer id → session ref, mutated in place.
 * @param options - optional cursorProjects root override.
 */
function attachCursorTranscripts(byId, options = {}) {
  if (byId.size === 0) return;
  const root = options.cursorProjects ?? join(homeDir(), '.cursor', 'projects');
  const files = walkFiles(root, (name) => name.endsWith('.jsonl'));
  for (const file of files) {
    if (!file.includes('/agent-transcripts/')) continue;
    const id = file.slice(0, -'.jsonl'.length).split('/').pop();
    if (!id || id.startsWith('task-')) continue;
    const existing = byId.get(id);
    if (existing === undefined) continue;
    existing.locator.transcript = file;
    if (existing.title.length === 0) existing.title = firstTranscriptTitle(file, existing.cwd);
  }
}

/**
 * Turn a Cursor project slug back into a workspace path.
 *
 * Slugs replace `/` with `-`, so `Users-alex-projects-x-scheduler` has to be
 * matched against real directories, longest segment first.
 * @param slug - the project folder name under `~/.cursor/projects`.
 * @returns an existing absolute path, or undefined.
 */
export function cwdFromCursorProjectSlug(slug) {
  if (typeof slug !== 'string' || slug.length === 0) return undefined;
  if (/^\d+$/.test(slug) || slug === 'empty-window' || slug.startsWith('var-folders-')) return undefined;
  const parts = slug.split('-').filter((part) => part.length > 0);
  if (parts[0] !== 'Users' || parts.length < 2) return undefined;
  let current = join('/', 'Users', parts[1]);
  if (!existsSync(current)) return undefined;
  let index = 2;
  while (index < parts.length) {
    let next = '';
    let consumed = 0;
    for (let end = parts.length; end > index; end--) {
      const candidate = join(current, parts.slice(index, end).join('-'));
      if (existsSync(candidate)) {
        next = candidate;
        consumed = end - index;
        break;
      }
    }
    if (!next) break;
    current = next;
    index += consumed;
  }
  return current;
}

/** First human prompt in a Cursor transcript, for the listing title. */
function firstTranscriptTitle(path, cwd) {
  let title = '';
  scanJsonlHead(
    path,
    (record) => {
      if (record.role !== 'user') return;
      title = promptTitle(plainTextOf(record.message?.content), cwd);
      return title.length === 0;
    },
    { byteLimit: 262144, recordLimit: 40 },
  );
  return title;
}

/** True when Cursor stored at least one bubble for this composer. */
function composerHasBubbles(db, composerId) {
  const prefix = `bubbleId:${composerId}:`;
  return (
    db.prepare('SELECT 1 FROM cursorDiskKV WHERE key >= ? AND key < ? LIMIT 1').get(prefix, `${prefix.slice(0, -1)};`) !==
    undefined
  );
}
