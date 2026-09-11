# Build progress

## Tier 1 — read, edit, save, conflict detection — **DONE & VERIFIED**

Verified end-to-end in a real browser against a throwaway server:

| Step | Evidence |
|---|---|
| Read | Pane textarea held the exact disk content of `spike/testfile.md` |
| Save | Pane notice `已保存 · update · 66 字节`; `cat` showed the new content on disk |
| Conflict | External writer changed the file, then the pane saved → notice `文件已被外部修改，保存被拒绝`; **the external content survived on disk** |
| Recovery | 「重新载入」 re-read and resynced the pane to the external content |

⌘S also works (bound in the textarea's `onKeyDown`), so part of Tier 3 is
already in place.

## Tier 2 — line numbers, highlighting, tab indent — **DONE & VERIFIED**

Verified by measuring the live DOM, not by eyeballing a screenshot.

| Requirement | Evidence |
|---|---|
| Line numbers | Gutter rendered one row per line (16 for a 16-line file) |
| Highlighting | Markdown: 12 spans, 6 distinct colours. JS: comments, keywords, strings, functions, types, numbers and punctuation each got their own colour |
| Overlay alignment | `getBoundingClientRect` of the highlight layer vs the textarea: **dx = 0, dy = 0**; fontFamily, fontSize, lineHeight, padding and whiteSpace all identical |
| Palette | Auto-detected light/dark from the pane's computed text colour, since the app exposes no token-colour variables |
| Tab indent | Caret + Tab inserted `  `; selection + Tab indented every touched line; Shift+Tab outdented |
| ⌘S (smoke) | `已保存 · update · 150 字节` |

### Why a hand-written tokenizer

`require('shiki')` fails at runtime — *"missed the module table"* — and the
language grammars are `import('./langs/xxx.js')` resolved relative to the
shell's own bundle URL, so a client plugin cannot reach them. A runtime probe
of `require('@deepseek-ai/dsh-client-ui-primitives')` showed a rich component
set including `CodeBlock({ code, lang, streaming, className, contentRef,
lineNumbers, copyLabel, copiedLabel })`.

`CodeBlock` was still rejected for the overlay: it renders its own chrome
(banner, copy button, its own padding), and an overlay editor lives or dies on
the two layers sharing exact metrics. Owning ~150 lines of scanner bought
pixel-exact alignment and no dependency on minified internals.

The scanner is one left-to-right pass per language family (comments → strings →
numbers → words → whitespace → punctuation), with Markdown handled line-by-line
so block structure colours differently. Anything past `HIGHLIGHT_MAX_LINES`
(3000) renders unstyled rather than stall a keystroke.

## The two hard-won API facts

Both were discovered by hitting real failures, not by reading docs first.

### 1. `sessions.get()` is not how you find a session's workspace root

A session merely **open in the sidebar is not in the host `SessionStore`**, so
`ctx.sessions.get(sessionId)` returns `undefined` and the sandbox policy falls
back to the deployment root (here: the server's cwd), denying every write inside
the session's own tree:

```
"diagnostics":{"sessionFound":false,
  "resolvedWorkspaceRoot":"/private/tmp",     ← wrong, the server's cwd
  "code":"FS_SANDBOX_DENIED"}
```

The correct source is the lookup provider the read path already uses, which
falls back to reading the session header from persistence:

```js
const scope = await ctx.typert.lookups.get('workspaceFileScope')?.resolve(sessionId);
// → { sessionId, workspaceRoot } | undefined
```

Its own implementation is the recipe:
`ctx.sessions.get(id)?.header ?? (await ctx.get('sessionPersistence').stat(id))?.header`,
then `header.cwd ?? sandboxPolicy.workspaceRoot`.

Carry that root onto the resolved policy, or the fence uses the wrong boundary:

```js
const base = policy.resolve(session ? { session } : undefined);
const sandboxPolicy = { ...base, workspaceRoot: scope.workspaceRoot, sessionId };
```

The `version` token returned by `workspaceFiles.read` **is** accepted by
`fs.writeText`'s `replaceIfVersion` guard — confirmed by a stale version
correctly reporting `FS_STALE_VERSION` rather than a type error.

### 2. A thrown handler becomes a bare 400

`dsh-host-webserver` wraps every route handler:

```js
handle(req, res).catch((err) => {
  ctx.logger.warn(err);
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(400);   // no body, no content-type
  res.end();
});
```

So any throw in a handler reads to the caller as "400 Bad Request" with an
unparseable body. The plugin's own `catch` block was itself throwing
(`policy.mapError(error, undefined)` dereferenced the missing policy), which
masked the real error. Own every failure inside the handler, keep `mapError`
defensive, and return a JSON reason with diagnostics.

Also: `ctx.logger.warn` does not reach the process's stdout, so a bare 400 with
a clean log means "look at your own handler".

## Layout

`spike/` is now a misnomer — this is the real plugin. It was not renamed because
the profile holds a pnpm `link:` symlink to the path and renaming would break
it silently.

```
plugins/sidebar-editor/
  package.json       dsh.bundle (profile layer) + dsh.client manifests
  cordis.patch.yml   the layer's own insert row
  lib/index.js       host half: POST /sidebar-editor/write
  lib/client.js      browser half: extension-band editor tab type
```

## Tier 3 — find/replace and multi-file tabs — **DONE & VERIFIED**

| Requirement | Evidence |
|---|---|
| Find bar | ⌘F opens it and focuses the search field; Escape closes |
| Match count | `1 / 4` → `2 / 4` → `3 / 4`, and Shift+Enter walked back to `2 / 4` |
| Mark all hits | 4 highlighted spans, exactly 1 in the active colour |
| Replace | One hit replaced; counter fell `2 / 4` → `2 / 3` |
| Replace all | Remaining hits replaced, counter `无结果`; disk confirmed after save |
| Case sensitivity | Case-insensitive `omega` matched 4 uppercase `OMEGA`; case-sensitive found none |
| Multi-file tabs | `["对话","轨迹","文件","find-a.md","find-b.md"]` — the framework gives each file its own tab; each editor stayed isolated |
| Drafts across tabs | Edited tab B without saving, switched to A and back: **the edit survived** |

Drafts live in a module-level `Map` keyed by tab address rather than in React
state, because whether an inactive tab stays mounted is the pane framework's
business. That makes the behaviour correct either way, and a draft is dropped
the moment its text reaches disk.

## Permanent install — **DONE**

`dsh.bundle` is the whole mechanism, and it means the user's own profile patch
file is never touched:

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

With that field present, `dsh plugin --profile web add <path>` registers the
package in the profile's `dsh.profile.bundles` **automatically** — verified by
re-running the install and watching `dsh-sidebar-editor` appear in that list.
The package then ships its own `cordis.patch.yml`, so installing the dependency
IS the install, and removing it is the uninstall.

Declaring `dsh.bundle` without re-running the install is **not** enough: a plain
`dsh web` still had no route until the bundle list was updated. That is worth
knowing because the failure is silent — the route simply does not exist, and the
SPA fallback answers `POST` with a bodyless `405`, which reads like a method
problem rather than a missing plugin.

The throwaway `spike.patch.yml` was deleted. Passing that row through `--patch`
**as well as** the bundle layer would register the same row id twice, which is a
composition error rather than a harmless duplicate.

## Native macOS app — **VERIFIED END TO END**

| Step | Evidence |
|---|---|
| The app's own server loads the plugin | `POST /sidebar-editor/ping` → `{"ok":true,...}` on the port the app spawned |
| The pane renders in WKWebView | Screenshot of the app window: `README.md` tab, toolbar 查找/重新载入/保存, line-number gutter, Markdown highlighting (blue headings, red inline code, green fences) |
| Clean shutdown | The user closed the window; the server died with it, no orphan process, PID file removed |

### A real bug found while testing the app

The window restored to **(−1346, 66)** — entirely off-screen, against a display
arrangement from an earlier session. The app ran with an invisible window and no
way back. Fixed by checking the restored frame against `NSScreen.screens` and
centring when nothing overlaps it; verified the window now opens at (690, 164).

## Server sharing: app and browser tabs on ONE server — **VERIFIED**

### The failure that started it

Opening the same session in two DSH servers surfaces:

```
resume failed for session "session-…"
SessionAlreadyOwnedError: session "session-…" is already owned by an
active write handle (gateway/internal)
```

Three facts pin the mechanism down:

1. The lease is a kernel `flock(2)` on the session's `session.lock`
   (`dsh-session-persistence-jsonl`, "the arbiter is the kernel"), held for the
   life of the write handle. It is released **automatically when the holder
   dies** — there is never a stale lock to clean up.
2. So the owner is a **server process**, not a browser tab. Clicking a different
   session changes nothing while the other server is alive.
3. Concurrent writers would interleave appends into one JSONL event log, so
   single-writer is a data-integrity requirement, not policy.

### The fix: share one server instead of running two

A server serves many clients, so a shared server *is* a shared writer. The only
obstacle was authentication — the launch token is `randomBytes(32)`, memory-only
and printed once — so the URL is now published to `~/.dsh/web-url`.

Key design decision: **probe with a bare TCP connect, never by fetching the
URL.** A root request carrying the token is exactly what the trust fence
consumes, so a liveness check built on HTTP would burn the token it was
checking. `NWConnection` plus a 1.5 s semaphore gives a synchronous, HTTP-free
answer; `.waiting` (refused) fails fast rather than stalling.

Implementation:

| Piece | Change |
|---|---|
| `WebURL` (new, `main.swift`) | `read` / `publish` / `retract` / `probe`; `retract` only removes a file that still names *its* URL |
| `ServerController` | Probe-then-spawn; state is `.ready(URL, owned: Bool)`; `spawnedByUs` gates teardown |
| `stop()` | Attached → retract, touch nothing else. Owned → `ProcessTree.terminate` + clear the PID record + retract |
| `open-in-browser.sh` | Same policy: attach when the published URL answers, `--new` to force a separate server |

### Verification (observed, not assumed)

| Path | How it was forced | Evidence |
|---|---|---|
| Attach | Published a URL for the live port | App launched with **no new listener, no rewrite of `~/.dsh/web-url`, `server.pid` unchanged** — a spawn would have changed all three at once |
| Spawn fallback | Published a URL on a dead port (49999) | App retracted it, spawned on **50091**, published a real token, wrote its PID |
| Script attach | Ran it against the live server | Reused port 50091, printed that URL, **no new listener** |

The attach row is the one worth trusting: the three signals are independent, and
a failed attach cannot leave all three untouched.

### Operational notes

- `server.pid` records the server the app **spawned**. A stale record is reaped
  on the next launch (command line verified first, so a recycled PID is safe).
  It is cleared when an owned server stops normally.
- Opening the app while a browser-tab server runs now attaches, so the two no
  longer contend. To deliberately run two servers, use `--new` — and then do not
  open one session in both.
- `mac/handoff-to-new-server.sh` stops a second server that holds locks. Launch
  it detached (`nohup … &`): when the server it kills is the one carrying the
  calling agent's own session, a foreground invocation dies with it mid-script
  and never reaches its verification step.

## App-only sidebar affordances

Hover **置顶 / 归档** buttons on session rows, a right-click menu (打开 / 重命名 /
分叉会话 / 置顶 / 归档会话), and remembered workspace expansion — all of it
**only in the app**, never in the browser.

### Why injection is the only route

The sidebar's session list is `sidebar.workspaces`, a **single-occupant** hole
owned by `dsh-client-ui-workspace`, and that package declares exactly two slots,
both for the directory-picker flow. Of the **50 slots** the product declares,
none addresses a session row or its menu. So a plugin cannot reach it, and the
only lever is the side that owns the web view: `mac/Sources/SidebarActions.swift`
is a `WKUserScript` the app injects, and the browser never receives it.

Two facts make it work:

| Fact | How it was found |
|---|---|
| Each row already ends in `span[class*="rowActions"]`, revealed by `.sessionRow:hover`, so injected buttons inherit the hover for free | Probed the live DOM |
| A row carries no session id — it lives in the render closure — but walking the React fiber to `SessionNodeItem` recovers `props.node.id` **and the row's own `onOpen/onRename/onFork/onArchive`** | Probed `__reactFiber$` |

Using the row's own handlers rather than reimplementing them means every action
runs the product's code path. Signatures were read from the bundle rather than
guessed: `onOpen(id)`, `onRename(id, title)`, `onFork(id)`, `onArchive(id)`.

Fragility is accepted and bounded: this runs only in the app, so the worst case
is that the buttons stop appearing.

### Pinning has no natural order to fall back on

The workspace order is **manual only** — "a new session is prepended at attach,
explicit reordering goes through `insertSessionBefore`, and activity never
reorders". So:

- "Unpin" cannot restore an original slot; there isn't one. Unpinning leaves the
  session where the pin put it, and `toEnd: true` is the explicit "send it back
  to the bottom" request.
- A one-shot move-to-top would be pushed down by the next session created, so the
  pin is a **persisted set** that `applyPinOrder` re-asserts by driving the real
  `insertSessionBefore` for every workspace that holds a pinned session.

### Three failures worth not repeating

**A `:has()` selector in the MutationObserver wedged the app.** The observer
watched the whole document and ran
`querySelector('… :not(:has([data-dsh-action]))')` on every mutation — thousands
during React's mount. The window rendered blank while the main thread chewed on
that selector. Fixed by coalescing to one scan per animation frame and doing the
"already decorated" test in JS.

**`localStorage` cannot hold this.** It is scoped to the page origin, and the
origin includes the port — `dsh web --port 0` binds a fresh random port on every
start, so a restart silently moves the app to a different origin and every stored
key is gone. The expansion map now lives in the plugin's own bag under `~/.dsh`
(`sidebar-editor-ui.json`) behind `/sidebar-editor/ui-state`, which does not care
how the surface was reached. Verified by expanding a workspace, quitting, and
relaunching onto a **different port**: the layout came back.

**Recording must wait for the loaded state.** The first scan sees the product's
default layout; writing that before the saved map arrives would erase the user's
layout on every launch. `syncExpansion` returns early until `expansionLoaded`.

### Verification

| Requirement | Evidence |
|---|---|
| Hover buttons | Screenshot of the app: pin + archive beside the row's own `⋯` |
| Pin works from the UI | Clicking it moved `session-ef392327` from second to first in `birds`, and `workspace.json` confirmed it |
| Pinned state | The pin renders filled, and the menu item reads 取消置顶 |
| Context menu | Right-click showed all five entries |
| Expansion restored | Expanded `birds`, quit, relaunched (port **59578** vs **59306**): `birds` and `deepseekharness` both still expanded |
| Text not selectable | `getComputedStyle(row).userSelect === "none"` **and** `Range.selectNodeContents(row)` yields an empty selection — not merely a visual change |
| Browser untouched | The row's `rowActions` still holds only its own `⋯`; the script is injected by the app alone |

## The Pinned section — a forked list component

Reordering a session to the front of its own workspace was **not** what was asked
for, and it was useless in practice: collapse the workspace and the pinned
session disappears. What was wanted is a separate **Pinned** group at the top
holding pinned sessions from every workspace.

### Why injection could not do it

The list derives its groups in `deriveGroups`, and for a **collapsed** group it
returns `sessions: []` — so a pinned session in a collapsed workspace has **no
DOM row** to move or clone. Rendering one needs its title, and titles are
reachable only through the `useSessions` hook, never through props
(`SessionTree` carries `sessionUpdatedAtByAccount` for times but nothing for
titles). A hand-rendered section would also have to reimplement rows, hover
state, drag and menus.

So this belongs in the list component, and the product already models it: the
same function builds an **ungrouped** group with `workspaceId: undefined`, and
every `workspaceId === void 0` branch in the renderer (drag, actions, create) is
already guarded. A synthetic group is a first-class thing here.

### Delivery: shadow the package from the profile

The patch vehicle is `plugins/workspace-fork/`, a copy of
`@deepseek-ai/dsh-client-ui-workspace` with the change applied, installed under
its **own name** so it shadows the shipped copy:

```bash
dsh plugin --profile web add /Users/alex/Desktop/deepseekharness/plugins/workspace-fork
```

This was **probed, not assumed**. The client-modules node half resolves a row
with `createRequire(entry.parent.tree.ctx.baseUrl)`, and the question was whether
`baseUrl` lands on the profile or on the npx cache. Installing a marker-bearing
copy and fetching the served bundle settled it — the marker came back, so the
profile wins and the npx cache is never touched. That matters: the cache is
recreated on any package update, and a patch there would vanish.

### The change

| Where | What |
|---|---|
| `deriveGroups` | Takes `pinnedIds`; prepends a synthetic group (`key: "\u0000pinned"`, `pinned: true`) and filters those ids out of their own workspaces, so a session never appears twice |
| `readPinnedIds` | Returns `[]` unless `window.__DSH_SIDEBAR_ACTIONS__ === true`, which only the app's injected script sets. **This is what keeps the browser exactly as shipped** |
| `SessionTree` | Holds the ids in state and subscribes to a `dsh-pins-changed` window event |
| `ProjectRowItem` | Uses the group's own label and a pin glyph when `pinned === true`; its `onToggle` is a no-op for the synthetic group |

The injected script publishes `window.__DSH_PIN_IDS__` and dispatches the event
only when the host's pin list actually changes, so the tree does not re-render
for nothing.

### Verified

| Requirement | Evidence |
|---|---|
| The fork is what gets served | A fresh server's bundle contains `PINNED_GROUP_KEY`; the older server's does not |
| Pinned group appears | App screenshot: a pin-glyphed **Pinned** heading above the workspaces |
| Cross-workspace | Two sessions pinned from **different** workspaces both appeared there |
| **Visible while collapsed** | `birds` was collapsed and its pinned session still showed in Pinned — the requirement that ruled out the earlier approach |
| Lifted, not duplicated | The pinned sessions are gone from their workspaces' own lists |
| Rows stay interactive | Hovering a pinned row revealed the filled pin and the archive button |
| Browser untouched | `readPinnedIds` returns empty without the app's flag |

### Operational note

A running server keeps the client bundle it scanned at startup, so **the section
appears after the DSH server restarts**. A server started before the fork was
installed keeps serving the old bundle no matter how often the page reloads —
observed directly, and the same `rev`-caching behaviour noted below.

## Archive syncs — re-tested, and it is not a bug

A report that archiving in the app did not reach the web was investigated twice:
once by reading the whole path, once by measuring it.

**The path is correct at every link:**

| Link | Evidence |
|---|---|
| `WorkspaceRegistry.archiveSession` | `setState` → `global.set(state)` |
| Domain global write | Emits `domain/changed` with `table: ""` and `operation: "put"` |
| `WorkspaceController.changed` | Branches on exactly `table === ""` + `operation === "put"`, diffs the archive set, and `publish`es `{ type: "archived" }` **to every follower** |
| Client | `case "archived": accept.replaceArchived(frame.archivedSessionIds)` |

So the RPC response is not the only delivery — the frame is broadcast. That was
then **measured**: an observer page read `archivedSessionIds` off the
`SessionTree` fiber as `["642181b4", "a78cb9ee"]`; a host-side archive of a
seventh session was then made, and the **same page, without reloading**, read
`["642181b4", "a78cb9ee", "00b77239"]`.

**Conclusion: archive syncs between clients that share a server.** The failure
mode is a split topology — two servers each holding their own in-memory
workspace projection, so a write by one is invisible to the other until it
restarts. That is the same root cause as `SessionAlreadyOwnedError`, and it was
self-inflicted here: a throwaway server left running while the app was attached
to it.

Two things to check when it appears again: that the app and the browser are on
the **same** server (the attach mechanism exists for exactly this), and that the
browser tab was not left open across a server restart.

The re-test used a **disposable session** created through the `headless` profile
rather than one of the user's, because archiving has **no undo** — the product
exposes `archiveSession` and an `archivedSessionIds` set but no unarchive call,
even though its own docs describe unarchiving as restoring the session's
position.

To drive that archive without a browser, a `POST /sidebar-editor/archive` route
was added to the plugin for the duration of the test and then **removed**: it
had no UI caller, and the UI has no need of one. All three archive affordances —
the hover button, the row's context menu, and the product's own `⋮` item — call
the very same `onArchive(id)` handler, so there was never a second path to build.

### Maintaining the fork

The fork is a copy, so a product update does not reach it. To refresh: re-copy
the shipped package over `plugins/workspace-fork/` and re-apply the four edits
above. The patch is small and each hunk is anchored on a distinctive line.

## App-only features, second round

### The repeated permission prompt was a signing problem

macOS binds permission grants (TCC) to an app's **code signature**, and an ad-hoc
signature hashes the binary — so every rebuild produced a different cdhash, macOS
saw a different app, and the user was asked again for every permission already
granted.

`build.sh` now signs with a real identity when one exists. The designated
requirement is what TCC matches, and it is now:

```
designated => identifier "local.deepseek-harness.shell" and anchor apple generic
              and certificate leaf[subject.CN] = "Apple Development: zoshh@outlook.com (KRT242B76G)" and …
```

That depends only on the bundle id and the certificate, so it survives rebuilds.
Override with `CODESIGN_IDENTITY=… ./mac/build.sh`.

### Voice input

A mic button in the composer's bottom-right row, just left of Send, injected by
the same app-only script. **Nothing is copied from Doubao** — that is another
vendor's proprietary UI and assets; the *behaviour* is rebuilt from Apple's
frameworks: `SFSpeechRecognizer` (preferring on-device recognition) plus
`AVAudioEngine`, in `mac/Sources/VoiceInput.swift`.

The page cannot open the microphone from script reliably and the shell cannot
write into a React composer, so the two halves talk over script messages:

| Direction | Message |
|---|---|
| page → shell | `dshVoiceToggle` |
| shell → page | `window.__dshVoiceText(text, isFinal)` / `__dshVoiceState(state)` |

Verified: the button lands in the trailing row (`[DIV, model picker, MIC, 发送消息]`)
and a transcript **replaces itself** as recognition refines rather than piling up —
`你好世界` → `你好世界这是语音` → `你好世界这是语音输入`. The composer is a
**contenteditable**, not a textarea, so writing goes through the editing pipeline
(select-all + `insertText`) rather than a value assignment.

### Hover-opened submenus

The model picker's Model/Effort rows needed a click; they now open on hover.
`element.click()` was **not** enough — measured against the picker, a real mouse
click opens the flyout while a synthetic one does not, so `pressLikeAPointer`
dispatches the whole `pointerdown → mousedown → pointerup → mouseup → click`
sequence. A guard stops re-entering the already-open row from toggling it shut.

Verified with a flyout-only discriminator: `Vision-Exp` is absent with the menu
open and appears after hovering a row, with no click.

### Project picker

A native sheet (`mac/Sources/ProjectPicker.swift`) with a search field, listing
the registered workspaces and the user's GitHub repositories (`gh repo list`,
already authenticated as `alex-zz7`). Picking a repository clones it to
`~/Projects/<repo>` and registers it; picking a folder registers it directly.

A workspace **is** a project here, so registration is the whole job: the plugin
gained `GET/POST /sidebar-editor/projects`, and the sidebar shows the new
workspace over its own follow stream with no reload. A menu could not carry the
search field the user asked for, which is why this is a panel.

### The stale-server trap, again

`/sidebar-editor/ping` answered 200 on the long-running server while
`/sidebar-editor/projects` answered 404: that server had scanned the plugin
before the route existed. Same `rev` caching as everywhere else here — **a route
added to the plugin only appears in servers started after the change.**

## Remaining

Nothing outstanding against the objective. Loose ends worth knowing about:

- The editor is installed for the `web` profile only. Another profile needs its
  own `dsh plugin --profile <name> add <path>`.
- The scanner covers a fixed keyword set per language family; an unknown
  extension still opens and edits, just without colour.
- No go-to-definition or completion — that needs an LSP, out of scope for a
  web-wrapper pane.

## Harness notes for whoever continues

- The plugin is installed now, so a plain `dsh web --no-open --port 0` already
  carries it. To test a change, edit the client half and **restart** that server:
  bundle bytes are cached by `rev`, so a reload alone serves the old artifact.
- To test an uninstalled variant, pass a `--patch` overlay — but never the same
  row id the bundle layer already registers.
- Kill by exact PID. `pkill -f "dsh web"` also matches the user's own session
  server on 3080.
- `POST` to an unregistered route answers a bodyless `405` from the SPA
  fallback; that is "no such plugin route", not a method problem.
- Client-bundle `rev`s ARE content hashes: after editing a forked client plugin
  the old `rev` URL 404s, the page HTML carries the new `rev`, and the server
  serves the new bytes without a restart. Only the **scan** (which plugins
  exist, host routes) happens at startup.

## Native-features objective (signing · voice · hover flyout · project picker)

### 1. Stable signing — DONE

`mac/build.sh` now signs with a real identity (first
`Apple Development`/`Developer ID Application` in the keychain, or
`CODESIGN_IDENTITY`): `Apple Development: zoshh@outlook.com (KRT242B76G)`.
A stable designated requirement ends the per-rebuild TCC re-prompts.

### 2. Voice input — DONE, continuous

Mic button injected before Send in the composer's trailing row (app only).
The shell runs `SFSpeechRecognizer(locale: "zh-CN")` + `AVAudioEngine`;
`window.__dshVoiceText(text, isFinal)` streams the transcript into the
contenteditable composer (select-all + `insertText`), and final text replaces
the interim one.

**The first version cut out at the first pause.** It stopped the whole session
the moment a result arrived with `isFinal` — but silence endpointing *is*
`isFinal`, and a pause can equally arrive as a `noSpeechDetected`-class error,
so "user stopped talking" was indistinguishable from "user is done". Rewritten
as one continuous session:

- the audio engine and its tap live for the whole session; only the
  *recognition task* is recycled, and the tap appends into whichever request is
  current (under a lock, because the audio thread reads it while the main queue
  swaps it);
- a finished segment folds its words into `committed`; the running transcript
  `committed + partial` is republished as non-final, so the composer keeps
  growing and the page still treats the span as replaceable;
- pausing never ends the session. A recogniser that dies instantly over and
  over first falls back from the on-device model to the server one; only an
  unavailable recogniser fails the session;
- toggling the mic off publishes the transcript as final, releasing the
  page-side span — typed text is never touched, because the page replaces only
  the span it wrote.

### 3. Hover-opened right-side flyout submenus — DONE & VERIFIED

The product's model/effort picker is drill-down (`pane` state swaps menu
content) — no hover, no flyout. Forked the whole client package to
`plugins/model-select-fork` (same package name → profile `link:` shadows the
shipped copy, exactly like workspace-fork).

The fork restructures the portal into two sibling panels:

- the root menu keeps both cells (模型 / 推理等级) and **never unmounts**;
- the options render in a second `position:fixed` panel hard against the menu's
  right edge (4px gap) and sharing the menu's **bottom** edge, so the two panels
  read as one unit and the pointer travels the shortest hop; it flips to the
  left only when the right side has no room, and grows upward. Height alone is
  capped — a too-tall list scrolls instead of moving away. An earlier
  `top`-clamping version parked the panel ~200px above the menu (the viewport
  guard pushed it up because the picker sits in the bottom composer); that is
  what the user saw and rejected, so the flyout is now menu-anchored only, with
  no viewport-driven repositioning;
- cells carry `onMouseEnter` → `setPane(...)` (click still works); a 160ms
  grace timer survives the gap crossing and closes the flyout when the pointer
  leaves both panels;
- `closeOutside` and `onBlur` also consult `flyoutRef` so clicks inside the
  flyout don't close the menu.

Gated on `window.__DSH_SIDEBAR_ACTIONS__` (`flyoutMode`): **browser stays on
the original drill-down**; only the app gets the flyout. Both modes verified by
ego-browser DOM geometry: browser root→click shows one panel, cells replaced;
app root→hover keeps the menu rect byte-identical (1549–1797 × 1071–1159) and
opens the options at `left = 1797 + 4` with `bottomDelta = 0` against the menu,
switching model→effort on the second hover.

The old `pressLikeAPointer`/`decorateSubmenuTriggers` injection hack is
deleted from `SidebarActions.swift` — it was the wrong layer.

### 4. GitHub project picker — DONE, panel needs one user run

`ProjectPickerController` (Swift sheet, searchable) lists registered
workspaces + `gh repo list` (authenticated as `alex-zz7`); picking a repo
clones to `~/Projects/<repo>` and POSTs `/sidebar-editor/projects`, which
registers it as a workspace.

**It could never have worked: `gh` was invisible to the app.** The panel ran
`/usr/bin/env gh`, but a Finder-launched app inherits a minimal
`PATH` (`/usr/bin:/bin:…`) — Homebrew's `gh` lives in `/opt/homebrew/bin`, so
the list came back empty and every clone failed (proved:
`env -i /usr/bin/env gh` → `No such file or directory`). The panel now resolves
`gh` to an absolute path (usual prefixes, then the login shell as a last
resort) and hands the child a PATH that includes the Homebrew prefixes, since
`gh` shells out to `git` and credential helpers.

Also fixed while there: the workspace list was fetched with a semaphore that
blocked the main thread for up to 3s on panel open; both loads are now async
and the status line reports exactly what failed (`brew install gh` / `gh auth
login` / the `gh` error text).

Verified without the user: `GET/POST /sidebar-editor/projects` answer 200 with
the expected payload (POST re-registering an existing workspace is idempotent),
and `gh repo clone alex-zz7/ai-web-design-deploy-assets <tmp>` succeeds under a
minimal GUI-like environment with the resolved path.

### 5. Single-instance guard — DONE & VERIFIED

Two copies of the shell attach to the same server and fight over session
ownership, and because the copy that spawned the server tears it down on quit
(`applicationWillTerminate → server.stop()`), a stray second launch can close
the first window — which is exactly what the user saw as a crash. Fixes:

- `LSMultipleInstancesProhibited` in `Info.plist` (covers Finder/`open`);
- a `focusRunningCopy()` check at the top of `applicationDidFinishLaunching`
  for direct binary launches, which bypass LaunchServices — the lower PID wins
  so two simultaneous launches cannot both yield.

Verified: with one instance running, launching the executable directly exits
with code 0 and leaves the server untouched.

**Worth knowing:** the server belongs to the app that spawned it, so quitting
that app kills the server — and any browser tab pointed at it, including this
harness GUI. If the GUI dies mid-session, check `~/.dsh/web-url` for the new
port rather than assuming a crash.

### 6. Workspace + mode row stays put, and the GitHub entry lives in it

The workspace chip and the Agent-preset seat above the composer were rendered
only while `hero` was true — `hero && heroWorkspaceRow` in
`dsh-client-ui-conversation` — so both controls disappeared the moment a task
started, exactly when switching workspace is still useful. The projects entry
was also in the wrong place: it sat in the sidebar's brand row.

- `plugins/conversation-fork` (same package name → profile `link:` shadows the
  shipped copy) renders the row for the whole session:
  `keepWorkspaceRow = hero || window.__DSH_SIDEBAR_ACTIONS__ === true`.
  `selectWorkspace` already routes through
  `workspaceNavigation.openWorkspace(...)`, so picking a workspace there opens
  that workspace's session and the sidebar follows it.
- The Agent-preset seat is safe outside the hero: it takes only injected hooks
  (`load`/`select`/`useAgentPresetSeat`), no hero-only props.
- `plugins/workspace-fork`'s workspace menu gained a `从 GitHub 克隆…` row
  (`GITHUB_CLONE`) that closes the menu and posts `dshOpenProjects` to the
  shell, which presents the native picker; the clone is registered through the
  plugin route, so the new workspace arrives over the follow stream.
- The brand-row project button is deleted from `SidebarActions.swift`.

Both patches are gated on the shell's marker script, so the browser keeps the
stock layout. **A new client plugin is only picked up by a server started
after the install** — the boot manifest is built at startup — so this needs an
app relaunch (the app spawns the server), not just a page reload.

### Install state

- Profile web `package.json` deps (links): workspace-fork, sidebar-editor,
  model-select-fork, conversation-fork. Rebuilds:
  `cd ~/.dsh/profiles/web && pnpm install`.
- App rebuilt & signed after the injection cleanup:
  `build/DeepSeek Harness.app`.
