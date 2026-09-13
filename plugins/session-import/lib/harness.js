/**
 * Lazy bridge to the installed harness format codec.
 *
 * The importer has to write the *current* session format, and the definition of
 * "current" belongs to the harness build that will read it — not to this plugin.
 * So the catalog is imported from the installed packages at run time and used
 * for every header and event this plugin emits. If the format ever moves to v4,
 * imports follow the harness instead of silently writing a stale generation.
 *
 * Resolution is by absolute path because the modules live in whichever tree the
 * harness was launched from (`~/.dsh/profiles/web`, an npx cache, a packed app),
 * not in this plugin's own `node_modules`.
 *
 * @module @alex/dsh-session-import/harness
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompress } from 'node:zlib';
import { promisify } from 'node:util';

const zstdDecompressAsync = promisify(zstdDecompress);

/** The catalog module this bridge needs; its presence identifies a candidate tree. */
const CATALOG = '@deepseek-ai/dsh-session-format-catalog/lib/index.js';
/** Session vocabulary used to adopt each decoded event. */
const SESSION = '@deepseek-ai/dsh-session/lib/index.js';

/** Modules resolved once per process. */
let cached;

/**
 * Every plausible root that could hold `@deepseek-ai/*`.
 *
 * Order matters: an explicit override wins, then the profile the harness runs
 * from, then the directory the process was started in. A packed build can point
 * `DSH_SESSION_FORMAT_BASE` at its own resources.
 * @param options - optional root hints.
 * @returns candidate directories, files first.
 */
export function candidateRoots(options = {}) {
  const roots = [];
  const add = (path) => {
    if (typeof path === 'string' && path.length > 0 && !roots.includes(path)) roots.push(path);
  };
  add(process.env.DSH_SESSION_FORMAT_BASE);
  add(options.base);
  // The machine's real home, never the overridden harness home: the packages
  // live in the tree the harness was installed into, which an import into a
  // throwaway DSH_HOME does not move.
  const home = options.systemHome ?? homedir();
  const profiles = join(home, '.dsh', 'profiles');
  if (existsSync(profiles)) {
    add(join(profiles, 'web', 'node_modules'));
    add(join(profiles, 'web'));
    add(join(profiles, 'node_modules'));
    try {
      for (const entry of readdirSync(profiles, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        add(join(profiles, entry.name, 'node_modules'));
        add(join(profiles, entry.name));
      }
    } catch {
      /* an unreadable profiles directory simply contributes nothing */
    }
  }
  add(join(home, '.dsh', 'node_modules'));
  add(join(home, '.npm', '_npx', 'node_modules'));
  add(process.cwd());
  add(options.cwd ?? process.cwd());
  return roots;
}

/**
 * Resolve the harness modules needed to encode and verify sessions.
 * @param options - optional root hints; `harness` short-circuits the search.
 * @returns the format catalog, the event adopter, and a verifying reader.
 */
export async function resolveHarness(options = {}) {
  if (cached !== undefined && options.base === undefined && options.harness === undefined) return cached;
  if (options.harness !== undefined) return options.harness;
  const tried = [];
  for (const root of candidateRoots(options)) {
    const catalogPath = join(root, CATALOG);
    const sessionPath = join(root, SESSION);
    if (!existsSync(catalogPath) || !existsSync(sessionPath)) {
      tried.push(root);
      continue;
    }
    try {
      const [catalogModule, sessionModule] = await Promise.all([
        import(pathToUrl(catalogPath)),
        import(pathToUrl(sessionPath)),
      ]);
      cached = makeHarness(catalogModule.sessionFormatCatalog, sessionModule);
      return cached;
    } catch (error) {
      tried.push(`${root} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  throw new Error(
    `session-import cannot find the harness format packages; looked in:\n  ${tried.join('\n  ')}\n` +
      'Set DSH_SESSION_FORMAT_BASE to the directory that contains @deepseek-ai/.',
  );
}

/** Convert an absolute path to an importable file URL. */
function pathToUrl(path) {
  const resolved = realpathSync(path);
  return new URL(`file://${resolved.split('\\').join('/')}`);
}

/** Close over the installed session vocabulary. */
function makeHarness(catalog, sessionModule) {
  if (catalog === undefined) throw new Error('the installed dsh-session-format-catalog exported no sessionFormatCatalog');
  const { adoptSessionEvent, Session } = sessionModule;
  if (typeof adoptSessionEvent !== 'function') throw new Error('the installed dsh-session exported no adoptSessionEvent');
  return {
    catalog,
    /**
     * Decode and validate one artifact the way the running app does.
     *
     * Three passes, each one a real boundary the harness enforces:
     *
     * 1. the physical container — frame scan and catalog restore;
     * 2. `adoptSessionEvent` for every event, the persistence read boundary;
     * 3. `Session.create` over the whole log, the seed boundary a cold session
     *    goes through when the app opens it. This is the pass that catches an
     *    `assistant/message` with no settlement `stream` — a shape the codec
     *    accepts and the session refuses, which is exactly the difference
     *    between "the file parses" and "the app can open it".
     * @param path - the JSONL artifact.
     * @returns the restored header, events, and their count.
     */
    async readArtifact(path) {
      const frames = await splitFrames(await readAll(path));
      if (frames.length === 0) throw new Error(`session artifact is empty: ${path}`);
      const lines = frames.join('').split('\n').filter((line) => line.trim().length > 0);
      if (lines.length === 0) throw new Error(`session artifact has no header line: ${path}`);
      const header = JSON.parse(lines[0]);
      const restore = catalog.createRestore(header, { recovery: 'strict', validation: 'transformed' });
      for (const line of lines.slice(1)) restore.decodeRow(JSON.parse(line));
      const artifact = restore.finish();
      for (const event of artifact.events) adoptSessionEvent(structuredClone(event));
      if (typeof Session?.create === 'function') {
        Session.create(artifact.header.id, artifact.events.map((event) => structuredClone(event)), artifact.header, 0);
      }
      return { header: artifact.header, events: artifact.events, eventCount: artifact.events.length };
    },
  };
}

/** Read a whole file as a buffer. */
async function readAll(path) {
  const { readFile } = await import('node:fs/promises');
  return readFile(path);
}

/**
 * Split concatenated Zstandard frames and decompress each one.
 *
 * The container is a sequence of independently decodable frames — the harness
 * appends one per durable batch — so the split has to follow frame structure
 * rather than search for a marker.
 * @param buffer - the complete artifact bytes.
 * @returns one decompressed string per frame, in file order.
 */
export async function splitFrames(buffer) {
  const ranges = scanFrames(buffer);
  const out = [];
  for (const range of ranges) {
    out.push((await zstdDecompressAsync(buffer.subarray(range.start, range.end))).toString('utf8'));
  }
  return out;
}

/** Frame magic, little-endian `0xFD2FB528`. */
const ZSTD_MAGIC = 4247762216;

/**
 * Locate complete frames without decompressing their blocks.
 *
 * Mirrors the harness's own scanner. A torn final frame is dropped rather than
 * guessed at: verification exists to prove the artifact is complete.
 * @param buffer - the artifact bytes.
 * @returns complete frame ranges.
 */
export function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`corrupt session artifact: invalid Zstandard frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) break;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) break;
    offset += remainingHeaderBytes;
    let complete = true;
    for (;;) {
      if (buffer.length - offset < 3) {
        complete = false;
        break;
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) throw new Error(`corrupt session artifact: reserved block type at byte ${offset - 3}`);
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        complete = false;
        break;
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (!complete) break;
    if (checksum) {
      if (buffer.length - offset < 4) break;
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

/** The harness home this process should read and write. */
export function harnessHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim();
  return join(homedir(), '.dsh');
}

/** Absolute path of the persistence root this import writes into. */
export function sessionsRoot(options = {}) {
  return options.sessionsRoot ?? join(options.home ?? harnessHome(), 'sessions');
}
