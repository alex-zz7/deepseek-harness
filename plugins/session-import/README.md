---
description: "Import external agent sessions — Cursor IDE chats, Claude Code transcripts, and Codex rollouts — into DeepSeek Harness as native v3 sessions under their original workspace."
kind: "package-reference"
---

# @alex/dsh-session-import

English | [中文](README.zh.md)

## Summary

Every agent on this machine keeps its own conversation store: Cursor writes chat
tabs into one SQLite key-value table, Claude Code writes a JSONL file per
session, Codex writes a rollout per thread. This plugin reads all three and
writes what it finds as ordinary DeepSeek Harness sessions — the same artifact
the harness itself produces, in the same directory, under the same workspace.

Imported sessions are not a special kind of thing. They list, open, search,
rename, archive, fork, export, and resume like any other session, because they
*are* any other session.

## Install

The package is a profile layer. Installing it is the whole install:

```sh
dsh plugin --profile web add /path/to/plugins/session-import
```

For this checkout the dependency is already declared in
`~/.dsh/profiles/web/package.json`, so a restarted app picks it up. Removing the
dependency removes the importer.

## Use it

### In the app

- **Settings → General → Import sessions.** Choose Cursor, Claude Code, or
  Codex, then import that source's conversations into the sidebar under their
  original workspace. The scanner only lists conversations **updated in the
  last 30 days**. Already imported items are skipped.
- **`/imports [query]`** in the composer lists what is available in that window.
- **`/import <source> [count] [--all] [--force]`** imports. `source` is
  `cursor`, `claude`, `codex`, or `all`; `count` defaults to 5. `--all` still
  stays inside the 30-day window.

### From a terminal

```sh
node plugins/session-import/scripts/import-sessions.mjs list [source] [--limit N] [--query text] [--all-time]
node plugins/session-import/scripts/import-sessions.mjs preview <source> <id>
node plugins/session-import/scripts/import-sessions.mjs import [sources…] [--limit N] [--all] [--dry-run] [--all-time]
node plugins/session-import/scripts/import-sessions.mjs repair [sources…] [--limit N] [--all]
node plugins/session-import/scripts/import-sessions.mjs check
```

`--home <dir>` points the whole run at another harness home, which is how the
importer tests itself without touching real data. It is the directory that
contains `sessions/` — `~/.dsh`, not `~`.

## What an import produces

One artifact at
`<home>/sessions/--<workspace>--/<session-id>/session.v3.jsonl.zstd`, containing:

| Event | Source |
|---|---|
| `session` (header) | new session id, the conversation's real `createdAt`, its original `cwd` |
| `turn/start` … `turn/end` | one turn per human prompt |
| `user/message` | the human's prompts |
| `step/start`, `assistant/message`, `step/end` | one step per assistant reply |
| `session/title` | Cursor `name` / Claude `ai-title`, else the first real prompt |

Two frames, each an independently decodable checksummed Zstandard frame —
exactly the container `@deepseek-ai/dsh-session-persistence-jsonl` writes and
reads. The header and every event are encoded by the *installed* format catalog,
not by a copy of it, so an import follows the harness if the format moves.

### The two rules an assistant message has to satisfy

`assistant/message` is the one event with a shape the codec alone will not
catch, so both rules are enforced by the verifier and both are easy to get
wrong:

1. `data.turn`/`data.step` must be non-negative safe integers and `data.stream`
   **must be present and an array**. The session's seed loader rejects a
   settlement without them — `seed assistant/message at index N has invalid
   settlement fields` — and the app surfaces that as *history load failed* when
   the session is opened. The codec, the restore stage, and `adoptSessionEvent`
   all accept the broken shape, so a writer that only round-trips through the
   codec will ship a session that lists in the sidebar and then refuses to open.
2. `message.id` must be non-empty, `message.role` must be `assistant`,
   `message.content` an array, and `message.source` a `{kind:'model',
   provider, model}` pair with both strings non-empty.

The stream is written as `[]`. Cursor, Claude, and Codex persist the finished
message, not the per-delta timings, so any stream here would be invented; an
empty one is the honest encoding of "the text is known, the cadence is not", and
the transcript renders from `content`.

### Why the log is minimal

Tool calls are deliberately not imported. Cursor, Claude, and Codex each record
tool use in their own vocabulary, and translating one agent's tool call into
another's `tool/call` + `tool/result` pair would fabricate invocations this
session never ran, with arguments and results that only resemble the original.
The transcript keeps what the conversation *was* — what was asked and what was
answered, plus reasoning — and leaves the machinery out.

### What is filtered

- Cursor bubbles with no text (tool bookkeeping, context attachments).
- Claude sidechains, tool results, and meta records.
- Codex `developer` and `system` messages, and user-role messages that are
  harness scaffolding (`# AGENTS.md instructions`, `<INSTRUCTIONS>`,
  `<environment_context>`, `<recommended_plugins>`, `multi_agent_mode`, …).
  Listing walks past those oversized plugin-catalog lines to find the prompt.
- Claude `custom-title` values that are just the workspace folder name; the
  generated `ai-title` or first prompt is used instead.
- `<system-reminder>` and `<system_notification>` blocks inside otherwise real
  messages.

A session whose remaining conversation is empty is reported as *no conversation
content* rather than written as a blank session.

## Read paths

| Source | Location | Notes |
|---|---|---|
| Cursor | `state.vscdb` (`composerHeaders`) | Only the chats Cursor's sidebar still lists: not archived, not drafts, not subagents. Agent-transcript JSONL is a fallback when a listed chat has no SQLite bubbles. |
| Claude Code | `~/.claude/projects/<project>/*.jsonl` | The project directory name is lossy, so the workspace comes from each record's own `cwd`. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` plus `archived_sessions/` | `session_meta` gives the workspace and identity, `response_item` the messages. The settings count is **pending** (not yet imported), not how many rollouts exist on disk. |

Listing and import share a 30-day `updatedAt` window in `scan.js`. Older
sessions stay on disk and stay in the ledger; `find`, `repair`, and `prune`
pass `sinceMs: 0` so they can still see them. A source showing `0` usually
means every recent conversation is already in `ledger.json`, not that the
scanner missed the store.

## Re-importing

Every import records `source:id → sessionId` in
`<home>/session-import/ledger.json`, and a later run skips what is already
there. `--force` (or the checkbox-free `/import … --force`) imports again and
produces a second session. Deleting the ledger makes everything importable
again; it is plain JSON and safe to edit.

Deleting a workspace from the sidebar is sticky. The importer records that
directory under `dismissedCwds` and will not `create` it again on boot or on
the next import. The session logs stay on disk and show under Ungrouped. An
earlier boot reconcile re-created every ledger folder, which is why deleted
rows kept coming back.

## Repairing what an earlier version wrote

The ledger is also the recipe for rebuilding: it remembers which source session
each harness session came from, so `repair` re-derives every previously imported
session from its original conversation **keeping its id** — the sidebar row the
user already has is fixed rather than duplicated.

```sh
node plugins/session-import/scripts/import-sessions.mjs repair --all
```

Use it when the harness's read rules tighten, or when an importer bug is found:
a repaired session is byte-derived from the source, so it cannot inherit the
defect. An entry whose source has since disappeared is reported, not guessed at.

## Verification

Each import verifies itself before reporting success, through three boundaries
the harness actually enforces:

1. the **physical container** — frame scan, then catalog restore with
   `recovery: 'strict'`;
2. the **persistence read** — `adoptSessionEvent` on every event;
3. the **seed boundary** — `Session.create` over the whole log, which is the
   pass a cold session goes through when the app opens it.

Pass 3 exists because passes 1 and 2 are not enough. An `assistant/message`
without a settlement `stream` round-trips through the codec and through
`adoptSessionEvent`, and then throws *history load failed* the moment the app
reads the session. Verifying only the file is a false negative; verifying the
session is the point.

## Known limitations

- **Attachments and images are not imported.** Text and reasoning only.
- **Tool history is not imported** (see above), so an imported session shows the
  conversation, not the diffs and commands behind it.
- **Very large Cursor stores are read per conversation.** Scanning is cheap
  (`composerHeaders` only), but importing a single long chat reads its bubbles.
- **A workspace that is not registered in the sidebar** gets registered by the
  next import run; the CLI cannot register one by itself, because the registry
  belongs to the running app.
