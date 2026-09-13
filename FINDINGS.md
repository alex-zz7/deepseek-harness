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
