/**
 * Claude Code session reader.
 *
 * One session is one JSONL file under `~/.claude/projects/<project>/`. Every
 * record carries its own `cwd` and `sessionId`, so the enclosing directory name
 * — which is a lossy encoding of the project path — is never consulted.
 *
 * @module @alex/dsh-session-import/sources/claude
 */

import { readFileSync } from 'node:fs';
import {
  isSyntheticText,
  newConversation,
  pushMessage,
  splitThinking,
  stripInjectedBlocks,
  toMillis,
  usableTitle,
} from '../conversation.js';

/** Concatenate the text blocks of a Claude content value. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

/**
 * Whether a record is one this importer shows.
 *
 * Sidechains are sub-agent transcripts, tool results are the assistant's own
 * machinery, and everything else is a harness record (hooks, queue operations,
 * attachments, file-history snapshots) rather than conversation.
 */
function isConversationRecord(record) {
  if (record.isSidechain === true) return false;
  if (record.isMeta === true) return false;
  return record.type === 'user' || record.type === 'assistant';
}

/**
 * Read one Claude Code session.
 * @param ref - a reference produced by `scanClaude`.
 * @returns the normalized conversation.
 */
export function readClaude(ref) {
  const conversation = newConversation({
    source: 'claude',
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
    if (typeof record.sessionId === 'string' && record.sessionId.length > 0) conversation.id = record.sessionId;
    if (typeof record.cwd === 'string' && record.cwd.startsWith('/')) conversation.cwd = record.cwd;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') {
      const titled = usableTitle(record.aiTitle, conversation.cwd);
      if (titled.length > 0) conversation.title = titled;
    } else if (record.type === 'custom-title' && typeof record.customTitle === 'string' && conversation.title.length === 0) {
      conversation.title = usableTitle(record.customTitle, conversation.cwd);
    }
    const time = toMillis(record.timestamp, 0);
    if (time > 0) {
      if (conversation.createdAt === 0) conversation.createdAt = time;
      conversation.updatedAt = Math.max(conversation.updatedAt, time);
    }
    if (!isConversationRecord(record)) continue;

    const message = record.message;
    if (message === null || typeof message !== 'object') continue;
    if (typeof message.model === 'string' && message.model.length > 0) model = message.model;

    if (record.type === 'user') {
      const text = stripInjectedBlocks(textOf(message.content));
      if (isSyntheticText(text)) continue;
      pushMessage(conversation, 'user', text, { time });
      continue;
    }

    // Assistant turns interleave thinking, prose, and tool calls. Only the
    // first two are conversation; the tool calls are visible in the transcript
    // as the work they did, and re-importing them as fake tool events would
    // claim invocations this session never ran.
    const content = Array.isArray(message.content) ? message.content : [];
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue;
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        pushMessage(conversation, 'assistant', '', { reasoning: block.thinking, time });
        continue;
      }
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      const split = splitThinking(block.text);
      pushMessage(conversation, 'assistant', split.text, { reasoning: split.reasoning, time });
    }
  }
  if (model.length > 0) conversation.meta.model = model;
  return conversation;
}
