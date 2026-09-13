# DeepSeek Harness

Local DeepSeek agent UI. The same `dsh web` surface on **macOS and Windows**.

Windows does not get a second native shell. Both platforms start one `dsh web`
server and open the browser — that is the whole product. The Mac `.app` is an
optional WKWebView wrapper around the same server.

## Quick start (Mac & Windows)

Need **Node.js 20+**. `dsh` is pulled through `npx` if it is not already on PATH.

```bash
git clone https://github.com/alex-zz7/deepseek-harness.git
cd deepseek-harness
npm start
```

Windows can also double-click `start.cmd`. macOS / Linux can run `./start.sh`.

`npm start` will:

1. `dsh plugin --profile web add` every package under `plugins/`
2. Reuse a live server from `~/.dsh/web-url`, or start `dsh web --no-open --port 0`
3. Open the token URL in your default browser

```bash
npm run setup              # plugins only
node scripts/harness.mjs start --new      # force a fresh server
node scripts/harness.mjs start --no-open  # print the URL only
```

## Optional: native macOS app

No Electron. No Rust. No Xcode project — `swiftc` from the Command Line Tools.

```bash
./mac/build.sh
open "build/DeepSeek Harness.app"
```

To watch stderr while debugging:

```bash
"build/DeepSeek Harness.app/Contents/MacOS/DeepSeekHarness"
```

The app and a browser tab share one server (see `~/.dsh/web-url`), so they do
not fight over session locks. `./mac/open-in-browser.sh` is the older Mac-only
attach script; `npm start` is the cross-platform one.

## Knowledge retrieve

The App knowledge chat resolves a document first (title / alias / description),
then reads that file. Asking `Gptimage skill 原理` used to miss
`gptimage2/SKILL.md`; it now opens that body.

Before / after and how to reproduce:

https://github.com/alex-zz7/deepseek-harness/blob/main/docs/knowledge-retrieve.md

The same URL is in **Settings** (and the Mac Help menu).

## What it does

On launch the shell:

1. Locates `dsh` — `$DSH_BIN`, the newest `~/.npm/_npx/*/node_modules/.bin/dsh`,
   common Homebrew paths, then a login-shell `command -v dsh`.
2. Looks for a **running** server: it reads the token-bearing URL published at
   `~/.dsh/web-url` and TCP-probes its port. If that answers, the app attaches
   to it — no second server, and it will not be killed on quit.
3. Otherwise spawns `dsh web --no-open --port 0` (the OS picks a free port, so
   it never collides with a server you already have running), parses the single
   startup line — `dsh web: http://127.0.0.1:PORT/?token=…` — and publishes that
   URL to `~/.dsh/web-url` so other clients can attach later.
4. Loads the URL in a `WKWebView` inside a native window.
5. Terminates the server on quit **only if it spawned it**.

Sessions live in `~/.dsh/sessions`, so the app shares session **history** with any
other DSH server you run — it is not a separate island.

**But ownership is exclusive.** A session can be *written* by only one server at
a time: the owner holds a kernel `flock(2)` lease on the session's
`session.lock`, and another server resuming it gets `SessionAlreadyOwnedError`
(surfaced as `already owned by an active write handle`). Reading history is
shared; writing is not.

The lock belongs to the **server process**, not to a browser tab, and it dies
with that process — the kernel releases it automatically, so there is no stale
lock to clean up. But it also means that while a second `dsh web` is running,
every session it has opened is off limits, no matter which one you click.

### Why the app and browser tabs no longer fight

The fix is not to make two servers cooperate — it is to run **one**. A server
serves any number of clients, so a shared server is a shared writer.

The obstacle is authentication: the launch token is `randomBytes(32)`, held only
in the server's memory, printed once at startup, and never written to disk. A
client that did not spawn the server therefore cannot recover it — which is why
the app originally had to own its own server.

So the URL is now **published** to `~/.dsh/web-url`:

| Actor | Behavior |
|---|---|
| App | Reads `~/.dsh/web-url`, TCP-probes that port. Live → attach (and never kill it on quit). Dead → spawn, then publish. |
| `mac/open-in-browser.sh` | Same: attach when the published URL answers, `--new` to force a separate server. |

Both ends probe with a bare TCP connect, because following the real URL would
consume the single-use token.

The result: open the app and a browser tab and they are two clients of one
server, so a session open in one works in the other. The app only ever
terminates a server it started itself.

## Native bits

| Feature | Detail |
|---|---|
| Window | Resizable, frame autosaved, 1180×820 default, min 720×480 |
| Menus | 文件 / 编辑 / 显示 / 窗口, standard App menu |
| Shortcuts | ⌘N new window · ⌘R reload · ⇧⌘R hard reload · ⌘+ / ⌘− / ⌘0 zoom · ⌃⌘F full screen · ⌘Q quit |
| Edit menu | ⌘C/⌘V/⌘A/⌘Z are wired to the responder chain, which is what makes them work inside the web view's text fields |
| Links | `127.0.0.1` stays in-app; anything else opens in your default browser |
| Dock | Custom generated `.icns` icon |

## What you get from DSH already

These are built into the DSH web UI, so you do **not** need to rebuild them —
they are reachable inside the app window:

- **Workspace file tree** — the right sidebar (文件 tab), lazy-loaded over the
  `workspaceFiles` namespace.
- **Diff view** — the frontend ships `DiffBlock` / `diffTotals` and renders
  per-edit diffs for tool calls.
- **Syntax highlighting** — Shiki, with ~25 bundled languages.
- **Document preview**, **open-in-external-app**, **native directory picker**,
  image input, and model switching.

## Two bugs that had to be fixed

**1. LaunchServices gives GUI apps a minimal PATH.**

`dsh` starts with `#!/usr/bin/env node`, and `node` lives at
`/opt/homebrew/bin/node`. Launched from a terminal it works; launched with
`open` it died instantly:

```
env: node: No such file or directory   # exit 127
```

The fix is to resolve the login shell's `PATH` once and hand it to the child
explicitly (`Shell.loginPATH()`).

**2. Killing the app used to orphan the server.**

`kill -TERM` on the app left `dsh web` running as an orphan holding a port. Now:

- `SIGTERM` / `SIGINT` / `SIGHUP` are trapped and run cleanup.
- The child PID is recorded in
  `~/Library/Application Support/DeepSeekHarness/server.pid`; a later launch
  reaps a stale server (verifying the command line first, so a recycled PID
  belonging to something else is never killed).
- Teardown walks the whole descendant tree, because `dsh web` spawns helpers
  (MCP servers, pnpm) that would otherwise survive.

## Still missing vs. Cursor

- **Editable inline editor.** The sidebar preview is read-only (Shiki-rendered).
  For now, edit via the diff/open-in-app flow and your external editor. Adding a
  real editor means either an editable web component upstream in
  `dsh-client-ui-sidebar-documentpreview`, or a native split pane — both are
  larger than this shell.
- **Go-to-definition / completion / LSP.** Out of scope for a web wrapper.
- **Workspace root.** Defaults to `$HOME`. Change the working folder from the
  workspace selector in the UI.

## Layout

```
start.cmd / start.sh / npm start   # Mac + Windows browser launcher
scripts/harness.mjs                # setup plugins + start dsh web
mac/                               # optional native macOS .app
  Sources/                         # WKWebView shell
  build.sh
plugins/
  knowledge-studio/                # local vaults + retrieval bar
  sidebar-editor/                  # editable right-sidebar tabs
  workspace-fork/ conversation-fork/ model-select-fork/ agent-preset-fork/
  global-skills/
knowledge/                         # notes + optional local RAG helper
build/                             # generated, not source
```

Runtime state that outlives a process:

```
~/.dsh/web-url                              # the live server's token URL (see above)
~/Library/Application Support/DeepSeekHarness/server.pid
                                            # the PID the app spawned, reaped on
                                            # the next launch if it is stale
```

## The sidebar editor plugin

`plugins/sidebar-editor` turns the right Sidebar's read-only file preview into
an editor: line numbers, syntax highlighting, Tab indent, ⌘F find/replace,
multi-file tabs, and ⌘S save guarded by a version check so an external writer
wins instead of being clobbered.

It is a DSH plugin, not part of the Mac app — it works in any DSH web surface,
including a plain browser. Install it per profile:

```bash
npm run setup
# or one plugin:
dsh plugin --profile web add /absolute/path/to/deepseek-harness/plugins/sidebar-editor
```

That single command is the whole install: the package declares `dsh.bundle`, so
the installer adds it to the profile's bundle list and the loader activates its
own patch layer. Remove the dependency to uninstall. It never touches your
`~/.dsh/profiles/<profile>/cordis.patch.yml`.

Read `FINDINGS.md` for the extension points it uses and `PROGRESS.md` for what
was verified and how.
