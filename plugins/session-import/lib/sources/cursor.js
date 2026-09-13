/**
 * Cursor IDE chat reader.
 *
 * Cursor keeps conversations in one SQLite key-value store rather than in
 * files. Two tables matter:
 *
 * - `composerHeaders` — one row per chat tab: id, title, timestamps, and the
 *   workspace URI, which is what lets an imported chat land in its own
 *   workspace instead of nowhere.
 * - `cursorDiskKV` — one row per bubble, keyed `bubbleId:<composerId>:<bubbleId>`.
 *   On the machine this was written against that table holds millions of rows,
 *   so the read is scoped by key prefix and never scans.
 *
 * Bubble order is taken from SQLite's `rowid`. Timestamps cannot be trusted for
 * ordering: hundreds of bubbles in a single long conversation carry an empty
 * `createdAt`, and sorting on it interleaves those to the front of the
 * transcript. Insertion order is monotonic for this table and survives the
 * append-only way Cursor writes it.
 *
 * The store is opened read-only; the importer never writes to Cursor's data.
 *
 * @module @alex/dsh-session-import/sources/cursor
 */

import { newConversation, pushMessage, toMillis } from '../conversation.js';
import { openCursorDb } from '../scan.js';

/**
 * Flatten a Cursor `richText` document to plain text.
 *
 * The value is a Lexical editor state serialized as a JSON string. Only text
 * leaves and explicit line breaks carry meaning for a transcript; mention
 * chips and other decorations degrade to their own text.
 * @param value - the raw `richText` column value.
 * @returns plain text, or an empty string when the value is not a document.
 */
export function richTextToPlain(value) {
  if (typeof value !== 'string' || value.length === 0) return '';
  let document;
  try {
    document = JSON.parse(value);
  } catch {
    return '';
  }
  const out = [];
  const walk = (node) => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    if (node.type === 'linebreak') out.push('\n');
    if (node.type === 'paragraph' && out.length > 0) out.push('\n');
    if (Array.isArray(node.children)) walk(node.children);
  };
  walk(document?.root ?? document);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Text a bubble carries, preferring the field its type actually populates. */
function bubbleText(bubble) {
  if (typeof bubble.text === 'string' && bubble.text.trim().length > 0) return bubble.text;
  return richTextToPlain(bubble.richText);
}

/** Reasoning text a bubble carries, if any. */
function bubbleReasoning(bubble) {
  const thinking = bubble.thinking;
  if (thinking !== null && typeof thinking === 'object' && typeof thinking.text === 'string') return thinking.text;
  return '';
}

/**
 * Read every bubble of one composer, in insertion order.
 *
 * The key range is written as a comparison rather than `LIKE` on purpose: the
 * store's key column is a unique index, so a range is an index seek, while
 * `LIKE 'prefix%'` is not guaranteed to be one — and this table holds millions
 * of rows in a multi-gigabyte file. `;` is `:` + 1, which is exactly the
 * exclusive upper bound of the composer's key space.
 * @param db - an open read-only Cursor store.
 * @param composerId - the conversation to read.
 * @returns rows in the order Cursor wrote them.
 */
export function readCursorBubbles(db, composerId) {
  const prefix = `bubbleId:${composerId}:`;
  return db
    .prepare('SELECT rowid, value FROM cursorDiskKV WHERE key >= ? AND key < ? ORDER BY rowid')
    .all(prefix, `${prefix.slice(0, -1)};`);
}

/**
 * Read one Cursor conversation.
 * @param ref - a reference produced by `scanCursor`.
 * @returns the normalized conversation.
 */
export function readCursor(ref) {
  const conversation = newConversation({
    source: 'cursor',
    id: ref.id,
    locator: ref.locator,
    title: ref.title,
    cwd: ref.cwd,
    createdAt: ref.createdAt,
    updatedAt: ref.updatedAt,
    meta: ref.meta,
  });
  const db = openCursorDb(ref.locator.path);
  try {
    for (const row of readCursorBubbles(db, ref.locator.composerId)) {
      let bubble;
      try {
        bubble = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (bubble === null || typeof bubble !== 'object') continue;
      const time = toMillis(bubble.createdAt, 0);
      if (time > 0 && conversation.createdAt === 0) conversation.createdAt = time;
      if (bubble.type === 1) {
        const text = bubbleText(bubble);
        if (text.trim().length === 0) continue;
        pushMessage(conversation, 'user', text, { time });
        continue;
      }
      if (bubble.type !== 2) continue;
      const reasoning = bubbleReasoning(bubble);
      const text = bubbleText(bubble);
      if (reasoning.trim().length > 0) pushMessage(conversation, 'assistant', '', { reasoning, time });
      if (text.trim().length > 0) pushMessage(conversation, 'assistant', text, { time });
    }
  } finally {
    db.close();
  }
  return conversation;
}
