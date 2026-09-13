# Spike findings — editable sidebar editor

**Verdict: all three questions answered YES. The architecture is confirmed; the
remaining work is feature depth, not feasibility.**

Run on 2026-09-11, macOS 26.5.1, DSH `0.1.5-rc.1`, plugin API `0.1.5-rc.2`.

## The three questions

| # | Question | Answer | Evidence |
|---|---|---|---|
| 1 | Can a plugin register a host HTTP route the page can call? | **Yes** | `POST /sidebar-editor/ping` → `200 {"ok":true,"plugin":"sidebar-editor","pid":24769}`, both from `curl` and from the live page |
| 2 | Does an `extension`-band tab type take over file addresses from the shipped `text` preview? | **Yes** | Clicking `README.md` in the file tree rendered the spike pane *instead of* the read-only preview, under a tab chip titled `README.md` |
| 3 | Can an unpublished local package be installed into a profile? | **Yes** | `dsh plugin --profile web add <abs path>` → pnpm `link:` dependency + symlink in the profile's `node_modules` |

## The extension point, concretely

The shipped preview declares itself at the **lowest** band and invites takeover
(`dsh-client-ui-sidebar-documentpreview/lib/types/client/definition.d.ts`):

```js
{ id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview',
  kind: 'text',
  patterns: ['dsh-resource://file/**'],
  priority: 'fallback',
  canOpen: (address) => parseFileAddress(address)?.scope === 'session',
  title: basenameOf }
```

Ranking is **band → matched-pattern length → registration order**, and the bands
are `extension` > `builtin` > `fallback`. Registering a *new kind* at
`extension` with the same glob wins outright — no need to collide with the
`text` kind, which sidesteps the "one builtin + one extension per kind" rule.

### Client half contract

Client plugins are **plain JS**, loaded by `window.__ModuleLoader__` with a
CommonJS-shaped factory. **No bundler, no TypeScript, no JSX needed.**

```js
window.__ModuleLoader__.load({
  id: '<package name>',
  factory: (require) => {
    var module = { exports: {} };
    const react = require('react');
    const inject = ['slots', 'locale', 'sidebarRightTabs'];
    function apply(ctx) {
      ctx.effect(() => ctx.sidebarRightTabs.register(definition), '…');
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body)), '…');
    }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
```

`require` resolves `react`, `react/jsx-runtime`, and `@deepseek-ai/*` client
packages that are in the boot graph.

Skinny packages need a `./client` path in `exports` and a `dsh.client` manifest:

```json
"exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
"dsh": { "client": { "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"], "platform": "web" } }
```

The modules node half scans Loader entries, reads those fields, composes
`window.__DSH_BOOT__`, and serves the bundle.

### Body props

A `sidebar.right.pane.tab` body receives (confirmed at runtime):

```
inputActions, sessionId, useChat, useConversation, useInput, usePanelInfo,
useProjection, useResource, useSession, useSessionPendingInteraction,
useSessions, useTabInfo, useTrajectory, useWorkspaces
```

The file address is **`useTabInfo().tab.navigation.address`** — *not*
`tab.address`. A tab record carries `contentId`; `navigation` is what the
opening `open` carried (`{ address, params, revision }`).

### Host half contract

ESM `export { name, inject, apply }`; routes via
`ctx.effect(() => ctx.webServer.register({ kind, path, handler }), 'label')`
with `handler(req, res)` owning the full response.

**Plugin routes are not under `/api`.** The `/api` browser-trust fence covers
the Remote dispatch namespace; plugin routes live beside it (the shipped
precedent is `/open-in-app/open`), so a plugin route is reachable same-origin
without token plumbing. The loopback bind is the security boundary.

## Gotchas worth remembering

1. **The client bundle URL needs the combo form and its `&rev=` suffix.**
   `/plugins/??<pkg>/client.js&rev=<hash>` → 200. Plain
   `/plugins/<pkg>/client.js` → 404, even for shipped plugins. A 404 on the
   plain form is *not* evidence the plugin failed to register.
2. **`workspaceFiles` is read-only** — "this service exposes no mutations".
   Reads reuse it; the save needs its own route.
3. **`dsh plugin add` warns when a package declares no `dsh.bundle`.** That is
   fine for a `--patch` overlay; a permanent install wants the bundle field.
4. **The profile sets `patchReload: live`.** Editing the shared
   `~/.dsh/profiles/web/cordis.patch.yml` hot-reloads into the user's running
   server. Test through `dsh web --patch <file>` on a throwaway port instead.
5. **Bundle bytes are cached by rev.** After editing the client half, restart
   the test server; a reload alone may serve the old artifact.

## Bug found and fixed during the spike

The first `EditorBody` called the `useTabInfo` slot hook **inside
`useEffect`**. That is a Rules-of-Hooks violation and it re-entered the slot
framework on every commit: the page's main thread wedged hard enough that
`Runtime.evaluate` timed out and the tab had to be closed.

Slot hooks are render-time hooks. Call them unconditionally at the top level of
the body.

## What this changes about the plan

The original estimate assumed a TypeScript/React package with a tsdown bundle
step and npm-resolved peer dependencies. **None of that is needed** — the
client half is a hand-written JS file the module loader picks up off a symlink.
That removes the largest schedule risk.

Remaining work is feature depth only:

| Tier | Work |
|---|---|
| 1. Basic | Load the file via `workspaceFiles`, editable textarea, save via the write route with `replaceIfVersion`, surface `FS_STALE_VERSION` as a conflict |
| 2. Highlight + lines | Gutter, shiki highlighting (already in the shipped bundle), tab-key indent, bracket matching |
| 3. Search/tabs/keys | In-file find & replace, multi-file tabs via `openResource`, ⌘S |

## Reproducing the spike

```bash
# install (once)
dsh plugin --profile web add /Users/alex/Desktop/deepseekharness/spike/sidebar-editor

# run on a throwaway port; never touches the shared profile
dsh --profile web \
    --patch /Users/alex/Desktop/deepseekharness/spike/sidebar-editor/spike.patch.yml \
    --no-open --port 0
```

Then open the printed URL, open a session, open the right sidebar's 文件 tab,
and click any text file.

---

# web_fetch + TUN/fake-IP (2026-09-13)

**Verdict: the official provider is correct to reject `198.18.0.0/15`. The
product bug is that users never get a proxy policy, so that check always
fires.** Do not weaken `isPublicIpAddress`. Do not patch `node_modules`.

## The three facts

| # | Fact | Evidence |
|---|---|---|
| 1 | TUN clients replace system DNS with a fake-IP resolver | `scutil --dns` → `198.18.0.2` on `utun4`; `dns.lookup('raw.githubusercontent.com')` → `198.18.8.93`. `dig @223.5.5.5` still returns `185.199.108-111.133` |
| 2 | `dsh-web-fetch-http` `resolvePublicAddresses` rejects any non-`unicast` `ipaddr.js` range before the request | `198.18.8.93` is `reserved` → `WEB_BLOCKED_URL`. `127/8`, `10/8`, `192.168/16`, `169.254/16` stay in that path |
| 3 | The same provider already has a proxied path that does not resolve or pin | `proxyRouteFor(url).proxied === true` → `requestVia(dispatcher)`. With `HTTPS_PROXY=http://127.0.0.1:1082`, the four previously-dead URLs all returned 200 |

## What we ship instead of an upstream patch

`plugins/web-fetch-proxy` wraps `ctx.web.fetch` (no second provider, so no
`WEB_PROVIDER_AMBIGUOUS`). Two layers:

1. If the official throw is `WEB_BLOCKED_URL` and a fresh lookup is only
   `198.18.0.0/15` (or IPv4-mapped forms), rethrow `WEB_PROXY_FAKE_IP` with
   the `~/.dsh/.env` / fake-IP-off instructions. Literal IPs and other
   reserved ranges stay `WEB_BLOCKED_URL`.
2. If no proxy env is set and `DSH_PROXY_AUTODETECT` is not `0`, probe
   `scutil --proxy` then loopback ports (`7890`…`8888`) in ≤300ms and call
   `installProxyFromEnvironment`. Failures are silent. `LOOPBACK_NO_PROXY` is
   untouched.

Upstream-sized patch if DeepSeek wants it: in `resolvePublicAddresses`, when
every answer is in `198.18.0.0/15` *and* `proxyRouteFor` is already proxied,
skip the public-IP check; when it is not proxied, throw `WEB_PROXY_FAKE_IP`
instead of `WEB_BLOCKED_URL`. We cannot do that here without editing
`node_modules`.

Repro: `node plugins/web-fetch-proxy/test/probe-fetch.mjs`.
Docs: `docs/web-fetch-fakeip-fix.md`.

---

# Spike findings — importing Cursor / Claude Code / Codex sessions

**Verdict: an external conversation can be written as a first-class DSH session
without touching the harness.** The artifact format is a plain container, the
codec is importable, and the sidebar groups by a `cwd` the session header
already carries.

Run on 2026-09-13, macOS 26.5.1, DSH `0.1.5-rc.1`, plugin API `0.1.5-rc.2`.

## The four facts

| # | Fact | Evidence |
|---|---|---|
| 1 | A session is one file: a header line plus a contiguous event log, split into independently decodable checksummed Zstd frames | `dsh-session-persistence-jsonl` `encodeMaterialization`: `header + "\n"` framed, then `events + "\n"` framed, both with `ZSTD_c_checksumFlag: 1` |
| 2 | The current format codec is importable at run time from the installed tree | `import('…/@deepseek-ai/dsh-session-format-catalog/lib/index.js')` → `sessionFormatCatalog.encodeCurrentHeader/encodeCurrentEvent`; `dsh-session` exports `adoptSessionEvent` |
| 3 | Reading is validated the same way persistence validates it | `catalog.createRestore(header, { recovery: 'strict', validation: 'transformed' })` → `decodeRow` per row → `finish()` |
| 4 | The sidebar groups imported sessions by the header's `cwd`, and the session controller registers workspaces itself | `api-session-controller` line 2708 injects `workspaceRegistry`; `updatedAt = max(header.createdAt, projections.lastPromptAt)` where `lastPromptAt` folds from `user/message` events whose `source.kind === 'user'` |

## Header and event facts worth keeping

- Header required keys are exactly `version, id, createdAt, isSeeded,
  delegationDepth`, plus optional `cwd, parentSession, origin, agentPreset`.
  There is no `type` in the logical header — the `"type":"session"` line is
  added by the physical encoder. Passing `type` to `encodeCurrentHeader` throws
  `format v2 header has unexpected field type`.
- Event top-level keys are `type, seq, time, data`; surface events
  (`user/message`, `assistant/message`, `tool/result`) may add `surfaceOp`.
- `assistant/message` is accepted without `stream` and `usage`; the harness
  itself writes `stream`, but restore does not require it.
- Session format is v3 and the artifact is `session.v3.jsonl.zstd` under
  `sessions/<projectKey>/<encodeSegment(id)>/`, where `projectKey` is
  `--` + separators-as-`-` + `~XXXX` escapes + `--` (251-char cap).

## Per-source facts

| Source | Store | Gotcha |
|---|---|---|
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (6.1 GB here) | Bubble order must come from SQLite `rowid`. `createdAt` is an empty string on hundreds of bubbles in one long chat, so sorting by it scrambles the transcript. `LIKE 'bubbleId:<id>:%'` makes SQLite scan the whole table (~6.7 s per chat); a `key >= prefix AND key < prefix;` range uses the unique index (~32 ms). |
| Claude Code | `~/.claude/projects/<lossy-project>/*.jsonl` | Line 1 is often a `queue-operation`, so the workspace must come from the first record *carrying* `cwd`, not the first record. `custom-title` records carry a real title. |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `developer` and `system` messages are the harness prompt; user-role records can be injected catalogs (`<recommended_plugins>`, `<environment_context>`). |

## Everything is verified by the harness, not by the writer

`verifyArtifact` runs three boundaries before an import reports success: the
frame scan + catalog restore, `adoptSessionEvent` per event, and `Session.create`
over the whole log.

## The bug this caught, and why two passes were not enough

The first version verified passes 1 and 2 and shipped sessions that listed in the
sidebar and then refused to open with:

```
stored session "<id>" is corrupt: seed assistant/message at index 3 has invalid
settlement fields   (gateway/internal)
```

`assertAssistantSettlementShape` (`dsh-session`, the seed loader) requires
`data.stream` to be **present and an array** on every `assistant/message`, and
the codec, the restore stage, and `adoptSessionEvent` all accept a message
without it. So "the file parses" and "the app can open it" are different claims,
and only pass 3 tests the second one. Repro:

```
curl -b <cookie> -X POST localhost:PORT/api/session/page -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"r1","method":"session/page","payload":{"args":{"request":{"address":{"kind":"session","sessionId":"<id>"},"throughSeq":22}}}}'
```

The stream is written as `[]`: Cursor, Claude, and Codex keep the finished
message, not the per-delta timings, so a populated stream would be fabricated.
`repair` rebuilds previously imported sessions from their sources while keeping
their ids, which is how the four sessions already written here were fixed.

Repro: `node plugins/session-import/scripts/import-sessions.mjs list|preview|import`.
Plugin: `plugins/session-import/README.md`.

Sidebar listing only reads the projection cache. A file written outside the
harness has no `session_projcache` row, so `displayTitle` falls back to the
workspace folder name. Import now snapshots the artifact into that cache, waits
for the title, `attachSession`s it, and emits `api-session/added`. Empty skips
(no `sessionId`) do not create folders.

Titles: Cursor `name` and Claude `ai-title` win; a `custom-title` / `name` that
equals the folder is dropped. Codex has no title field and its first user-role
item is usually an `AGENTS.md` dump or a multi-hundred-kilobyte
`<recommended_plugins>` catalog — skip those lines and use the first real
prompt. Empty realtime / scaffolding-only files are not listed.

Cursor's sidebar is not just `composerHeaders`. This machine had 58 named
SQLite chats and 301 unique `agent-transcripts` ids; 109 of those ids are
not in the SQLite index at all. Import must merge both stores or the sidebar
only shows a slice. Hydrating each imported session with a 1.5s wait also
timed out large runs, so only the first batch appeared live.
