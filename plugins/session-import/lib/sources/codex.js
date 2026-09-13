/**
 * Codex rollout reader.
 *
 * Codex persists an append-only rollout per thread: a `session_meta` head, then
 * `response_item` records carrying the model-visible messages. The developer and
 * system roles are the harness's own instructions — the Codex equivalent of the
 * DSH system prompt — so only `user` and `assistant` roles become conversation.
 *
 * @module @alex/dsh-session-import/sources/codex
 */

import { readFileSync } from 'node:fs';
import {
  isSyntheticText,
  newConversation,
  plainTextOf,
  pushMessage,
  stripInjectedBlocks,
  toMillis,
} from '../conversation.js';

/** Concatenate the text blocks of a Codex content array. */
function textOf(content) {
  return plainTextOf(content);
}

/**
 * Read one Codex rollout.
 *
 * `turn_context` records carry the model in force for the following turn; the
 * last one seen wins, which matches how the rollout reads.
 * @param ref - a reference produced by `scanCodex`.
 * @returns the normalized conversation.
 */
export function readCodex(ref) {
  const conversation = newConversation({
    source: 'codex',
    id: ref.id,
    locator: ref.locator,
    title: ref.title,
    cwd: ref.cwd,
    createdAt: ref.createdAt,
    updatedAt: ref.updatedAt,
    meta: ref.meta,
  });
  const raw = readFileSync(ref.locator.path, 'utf8');
  let model = '';
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const time = toMillis(record.timestamp, 0);
    const payload = record.payload;
    if (payload === null || typeof payload !== 'object') continue;

    if (record.type === 'session_meta') {
      if (typeof payload.session_id === 'string' && payload.session_id.length > 0) conversation.id = payload.session_id;
      if (typeof payload.cwd === 'string' && payload.cwd.startsWith('/')) conversation.cwd = payload.cwd;
      const start = toMillis(payload.timestamp, time);
      if (start > 0) conversation.createdAt = start;
      if (typeof payload.cli_version === 'string') conversation.meta.cliVersion = payload.cli_version;
      continue;
    }
    if (record.type === 'turn_context') {
      if (typeof payload.model === 'string' && payload.model.length > 0) model = payload.model;
      continue;
    }
    if (record.type !== 'response_item' || payload.type !== 'message') continue;
    if (time > 0) conversation.updatedAt = Math.max(conversation.updatedAt, time);

    const role = payload.role;
    if (role === 'user') {
      const text = stripInjectedBlocks(textOf(payload.content));
      // Codex injects plugin catalogs, environment context, and mode switches
      // as user-role messages. They are instructions, not prompts.
      if (isSyntheticText(text)) continue;
      pushMessage(conversation, 'user', text, { time });
      continue;
    }
    if (role === 'assistant') {
      const text = textOf(payload.content);
      if (isSyntheticText(text)) continue;
      pushMessage(conversation, 'assistant', text, { time });
    }
  }
  if (model.length > 0) conversation.meta.model = model;
  return conversation;
}
