/**
 * Turn a normalized conversation into a DeepSeek Harness session log.
 *
 * The output is the same artifact the harness itself writes: one header line
 * plus a contiguous event log, each encoded by the installed format catalog and
 * stored as independently decodable, checksummed Zstandard frames.
 *
 * Nothing here is invented. A turn opens, the human message lands, a step opens,
 * the assistant answers, the step closes, the turn closes — the minimum a
 * harness session needs to be replayed, titled, listed, and resumed.
 *
 * @module @alex/dsh-session-import/build
 */

import { createHash, randomUUID } from 'node:crypto';
import { constants, zstdCompress } from 'node:zlib';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { deriveTitle, messageIdFor } from './conversation.js';
import { resolveHarness } from './harness.js';

const zstdCompressAsync = promisify(zstdCompress);
const CHECKSUM_OPTIONS = { params: { [constants.ZSTD_c_checksumFlag]: 1 } };

/**
 * Encode an arbitrary string as one safe path segment.
 *
 * Byte-for-byte the harness's own `encodeSegment` from
 * `@deepseek-ai/dsh-session-persistence-jsonl`: a session id may be any string,
 * so `.`/`..`, separators, and NUL have to be neutralized before the id reaches
 * the filesystem. Duplicated rather than imported because the backend does not
 * export it, and the alternative — constructing a Cordis Context to reach the
 * class — would tie an import to a running host.
 * @param raw - the string to encode; must be non-empty.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let index = 0; index < raw.length; index++) {
    const code = raw.charCodeAt(index);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

/**
 * Build the human-navigable project directory key for a workspace path.
 * @param cwd - the session's project directory.
 * @returns one filesystem-safe directory name.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path');
  let readable = '';
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index++) {
    const code = cwd.charCodeAt(index);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`;
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/**
 * Resolve where one session's artifact lives under a harness home.
 * @param sessionsRoot - the persistence root, normally `<home>/sessions`.
 * @param cwd - the session's workspace; absent selects the `_no-cwd` group.
 * @param id - the session id.
 * @returns the absolute path of the v3 JSONL artifact.
 */
export function sessionArtifactPath(sessionsRoot, cwd, id) {
  const project = cwd === undefined ? join(sessionsRoot, '_no-cwd') : join(sessionsRoot, projectKey(cwd));
  return join(project, encodeSegment(id), 'session.v3.jsonl.zstd');
}

/** Compress one independently decodable, checksummed frame. */
async function frame(text) {
  return zstdCompressAsync(Buffer.from(text, 'utf8'), CHECKSUM_OPTIONS);
}

/**
 * Build the ordered event list for one conversation.
 *
 * Timestamps are carried over from the source when it has them, and otherwise
 * spread across the conversation's own span, so the imported session's recency
 * in the sidebar matches when the conversation actually happened.
 * @param conversation - normalized conversation.
 * @param id - the new harness session id.
 * @returns contiguous events from seq 0.
 */
export function buildEvents(conversation, id) {
  const events = [];
  const push = (type, time, data, extra = {}) => {
    events.push({ type, seq: events.length, time: Math.max(0, Math.round(time)), data, ...extra });
  };
  const start = conversation.createdAt > 0 ? conversation.createdAt : Date.now();
  const end = conversation.updatedAt > start ? conversation.updatedAt : start;
  const spread = conversation.messages.length > 1 ? (end - start) / (conversation.messages.length - 1) : 0;
  const timeAt = (index, message) => (message.time > 0 ? message.time : Math.round(start + spread * index));

  let turn = 0;
  let step = 0;
  let pending = null;
  let opened = false;
  let turnStartSeq = 0;

  const openTurn = (time) => {
    turn += 1;
    step = 0;
    pending = null;
    opened = true;
    turnStartSeq = events.length;
    push('turn/start', time, { turn });
  };
  const closeTurn = (time) => {
    if (!opened) return;
    if (pending !== null) {
      push('step/end', time, { turn, step });
      pending = null;
    }
    push('turn/end', time, { turn, reason: 'completed' });
    opened = false;
  };

  for (const [index, message] of conversation.messages.entries()) {
    const time = timeAt(index, message);
    if (message.role === 'user') {
      if (opened) closeTurn(time);
      openTurn(time);
      push(
        'user/message',
        time,
        {
          content: blocksOf(message),
          role: 'user',
          id: messageIdFor(conversation.source, conversation.id, index),
          source: { kind: 'user', clientTimeZone: conversation.meta.clientTimeZone ?? undefined },
        },
        { surfaceOp: 'append', sourceEventSeqs: [turnStartSeq] },
      );
      continue;
    }
    if (!opened) openTurn(time);
    step += 1;
    push('step/start', time, { turn, step });
    push(
      'assistant/message',
      time,
      {
        turn,
        step,
        message: {
          role: 'assistant',
          id: messageIdFor(conversation.source, conversation.id, index),
          content: blocksOf(message),
          source: { kind: 'model', provider: `${conversation.source}-import`, model: modelOf(conversation) },
        },
        // A settled assistant message carries its exact model stream, and the
        // seed loader refuses one without the field (`invalid settlement
        // fields`). It is empty on purpose: Cursor, Claude, and Codex keep the
        // finished message, not the per-delta timings, so any stream written
        // here would be invented. An empty stream is the honest encoding of
        // "the text is known, the typing cadence is not", and the transcript
        // renders from `content`.
        stream: [],
      },
      { surfaceOp: 'append' },
    );
    pending = step;
  }
  const lastTime = conversation.messages.length > 0 ? timeAt(conversation.messages.length - 1, conversation.messages.at(-1)) : end;
  closeTurn(lastTime);
  return events;
}

/** Model-visible content blocks for one normalized message. */
function blocksOf(message) {
  const content = [];
  for (const part of message.parts) {
    if (part.reasoning.length > 0) content.push({ type: 'reasoning', text: part.reasoning });
    if (part.text.length > 0) content.push({ type: 'text', text: part.text });
  }
  return content;
}

/** Best available model name for one conversation. */
function modelOf(conversation) {
  const model = conversation.meta.model;
  return typeof model === 'string' && model.length > 0 ? model : 'unknown';
}

/**
 * Encode a header and event list into the artifact bytes.
 * @param harness - resolved harness modules.
 * @param header - the session header.
 * @param events - contiguous events.
 * @returns the complete file content: a header frame plus one event frame.
 */
export async function encodeArtifact(harness, header, events) {
  const headerLine = `${JSON.stringify(harness.catalog.encodeCurrentHeader(header, 0))}\n`;
  const body = `${events.map((event) => JSON.stringify(harness.catalog.encodeCurrentEvent(event))).join('\n')}\n`;
  const [headerFrame, eventFrame] = await Promise.all([frame(headerLine), frame(body)]);
  return Buffer.concat([headerFrame, eventFrame]);
}

/**
 * Plan one import without writing anything.
 *
 * The plan is what the UI shows and what the CLI prints; it is also what the
 * writer executes, so a preview can never disagree with the result.
 * @param ref - the source session reference.
 * @param conversation - its normalized conversation.
 * @param options - optional id override, for tests.
 * @returns the header, events, artifact path, and title.
 */
export function planImport(ref, conversation, options = {}) {
  const id = options.id ?? `session-${randomUUID()}`;
  const events = buildEvents(conversation, id);
  const sessionStart = conversation.createdAt > 0 ? conversation.createdAt : Date.now();
  return {
    id,
    source: conversation.source,
    externalId: conversation.id,
    title: options.title ?? deriveTitle(conversation),
    cwd: conversation.cwd,
    eventCount: events.length,
    messageCount: conversation.messages.length,
    createdAt: sessionStart,
    updatedAt: Math.max(sessionStart, conversation.updatedAt),
    header: {
      version: 3,
      id,
      createdAt: Math.round(sessionStart),
      ...(conversation.cwd === undefined ? {} : { cwd: conversation.cwd }),
      isSeeded: false,
      delegationDepth: 0,
      agentPreset: 'standard',
    },
    events,
  };
}


/**
 * Append the explicit title event to a built plan.
 *
 * The title is a real session event rather than a projection-side label: that is
 * what makes it survive a restart, show up in search, and stay renameable.
 * @param plan - the plan being imported.
 * @returns the same plan, with its title event appended.
 */
export function withTitleEvent(plan) {
  const last = plan.events.at(-1);
  const time = last === undefined ? plan.createdAt : last.time;
  const seq = plan.events.length;
  plan.events.push({
    type: 'session/title',
    seq,
    time,
    data: {
      title: plan.title,
      messageSeqs: plan.events.filter((event) => event.type === 'user/message').map((event) => event.seq),
      source: { kind: 'fallback' },
    },
  });
  plan.eventCount = plan.events.length;
  return plan;
}

/**
 * Write one planned import to disk and return the artifact it created.
 *
 * The write is atomic: the frame buffer lands in a sibling temporary file, is
 * fsynced, and is then renamed into place, so a crash mid-import leaves no
 * half-written session for the harness to read.
 * @param plan - a plan from {@link planImport}.
 * @param options - `sessionsRoot` and an optional harness module resolution.
 * @returns the written path and its byte size.
 */
export async function writePlan(plan, options) {
  const harness = options.harness ?? (await resolveHarness(options));
  const path = sessionArtifactPath(options.sessionsRoot, plan.cwd, plan.id);
  const content = await encodeArtifact(harness, plan.header, plan.events);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return { path, bytes: content.length };
}

/**
 * Read an artifact back and prove the harness can interpret it.
 *
 * This runs on every write. It is the difference between "a file was produced"
 * and "a session the harness will actually open": the log is decoded exactly the
 * way persistence decodes it, every event is adopted by the installed session
 * vocabulary, and the header is re-validated against the current format.
 * @param path - the artifact to verify.
 * @param options - optional harness module resolution.
 * @returns the header and event count that were read back.
 */
export async function verifyArtifact(path, options = {}) {
  const harness = options.harness ?? (await resolveHarness(options));
  return harness.readArtifact(path);
}

/** Stable digest of one planned import, for the ledger. */
export function planDigest(plan) {
  return createHash('sha256')
    .update(`${plan.source}:${plan.externalId}:${plan.eventCount}:${plan.title}`)
    .digest('hex')
    .slice(0, 16);
}
