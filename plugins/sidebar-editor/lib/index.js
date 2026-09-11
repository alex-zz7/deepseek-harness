/**
 * Host half of the sidebar editor.
 *
 * Routes:
 *   POST /sidebar-editor/write     — atomic save with optimistic concurrency.
 *   GET  /sidebar-editor/pins      — the pinned session ids.
 *   POST /sidebar-editor/pins      — pin or unpin one session, then re-apply order.
 *   POST /sidebar-editor/pins/apply — re-assert pinned-first order.
 *   GET  /sidebar-editor/ui-state  — the app-only sidebar state bag.
 *   POST /sidebar-editor/ui-state  — merge a patch into that bag.
 *   GET  /sidebar-editor/projects  — registered workspaces.
 *   POST /sidebar-editor/projects  — register a directory as a workspace.
 *
 * Reads need no route of their own: the pane reads through the existing
 * `workspaceFiles` Remote the client already holds, which returns content and
 * the freshness token together. Only the write is new, because that service is
 * read-only by design ("this service exposes no mutations").
 *
 * The write deliberately goes through the composed filesystem service rather
 * than `node:fs`, following the same recipe the agent's own edit tool uses:
 * resolve to a stable target, resolve the sandbox policy for the calling
 * session, then `writeText` with a version guard. Bypassing either step would
 * turn this plugin into a sandbox escape.
 *
 * The pins routes exist because the sidebar's session rows expose no extension
 * slot, so the native app drives this feature through them. They are inert
 * unless something calls them, which is what keeps the browser surface
 * unchanged.
 *
 * @module dsh-sidebar-editor
 */

import { applyPinOrder, readPins, setPinned } from './pins.js';
import { mergeUiState, readUiState } from './ui-state.js';
import { cloneGithubRepo, createLocalFolder, listGithubRepos, listLocalFolders } from './github.js';
import { rehomeLiveSession, restoreRehousings } from './rehome.js';

/** Cordis plugin name. */
export const name = 'sidebar-editor';

/**
 * Services this plugin needs before it activates. `sandboxPolicy` is NOT here:
 * it is optional, read through `ctx.get` only when the mounted filesystem
 * actually confines.
 */
export const inject = ['webServer', 'fs', 'sessions', 'typert', 'workspaceRegistry'];

const WRITE_ROUTE = '/sidebar-editor/write';
const PING_ROUTE = '/sidebar-editor/ping';
const PINS_ROUTE = '/sidebar-editor/pins';
const PINS_APPLY_ROUTE = '/sidebar-editor/pins/apply';
const UI_STATE_ROUTE = '/sidebar-editor/ui-state';
const PROJECTS_ROUTE = '/sidebar-editor/projects';
const GITHUB_REPOS_ROUTE = '/sidebar-editor/github-repos';
const CLONE_ROUTE = '/sidebar-editor/clone';
const LOCAL_FOLDERS_ROUTE = '/sidebar-editor/local-folders';
const MKDIR_ROUTE = '/sidebar-editor/mkdir';
const REHOME_ROUTE = '/sidebar-editor/rehome';

/** Cap on one request body; the editor never sends more than a file. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * Write one JSON response.
 * @param res - the response to own.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Read and parse a bounded JSON request body.
 * @param req - the incoming request.
 * @returns `{ value }` or `{ error }`.
 */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return { error: 'body-too-large' };
    chunks.push(chunk);
  }
  if (total === 0) return { error: 'empty-body' };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 'invalid-json' };
  }
}

/**
 * Register the editor's route.
 * @param ctx - host context carrying the webserver, filesystem, and sessions.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PING_ROUTE,
        handler: (req, res) => {
          if (req.method !== 'POST') {
            sendJson(res, 405, { code: 'method-not-allowed' });
            return;
          }
          sendJson(res, 200, { ok: true, plugin: name, pid: process.pid });
        },
      }),
    `sidebar-editor: POST ${PING_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PINS_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, pinned: await readPins() });
              return;
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }

            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const { sessionId, pinned, toEnd } = parsed.value ?? {};
            if (typeof sessionId !== 'string' || typeof pinned !== 'boolean') {
              sendJson(res, 400, {
                code: 'bad-request',
                message: 'sessionId (string) and pinned (boolean) are required',
              });
              return;
            }

            const next = await setPinned(sessionId, pinned);

            // Unpinning deliberately leaves the session where the pin put it:
            // the order is manual, so there is no original slot to restore.
            // `toEnd` is the explicit "put it back at the bottom" request.
            if (!pinned && toEnd === true) {
              for (const workspace of ctx.workspaceRegistry.list()) {
                if (!workspace.sessionIds.includes(sessionId)) continue;
                await workspace.insertSessionBefore(sessionId);
                break;
              }
            }

            const changed = await applyPinOrder(ctx.workspaceRegistry, next);
            sendJson(res, 200, { ok: true, pinned: next, workspacesReordered: changed });
          } catch (error) {
            sendJson(res, 500, { code: error?.code ?? 'pin-failed', message: String(error?.message ?? error) });
          }
        },
      }),
    `sidebar-editor: ${PINS_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PINS_APPLY_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            const pinned = await readPins();
            const changed = await applyPinOrder(ctx.workspaceRegistry, pinned);
            sendJson(res, 200, { ok: true, pinned, workspacesReordered: changed });
          } catch (error) {
            sendJson(res, 500, { code: error?.code ?? 'pin-failed', message: String(error?.message ?? error) });
          }
        },
      }),
    `sidebar-editor: POST ${PINS_APPLY_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: UI_STATE_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, state: await readUiState() });
              return;
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }

            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const patch = parsed.value;
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
              sendJson(res, 400, { code: 'bad-request', message: 'a JSON object is required' });
              return;
            }

            sendJson(res, 200, { ok: true, state: await mergeUiState(patch) });
          } catch (error) {
            sendJson(res, 500, { code: error?.code ?? 'ui-state-failed', message: String(error?.message ?? error) });
          }
        },
      }),
    `sidebar-editor: ${UI_STATE_ROUTE}`,
  );

  // Projects are workspaces: the sidebar already renders one row per registered
  // directory, so picking a project only has to register the folder. The follow
  // stream then puts it in the sidebar without a reload.
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: PROJECTS_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method === 'GET') {
              const projects = ctx.workspaceRegistry.list().map((workspace) => ({
                id: String(workspace.id),
                title: workspace.title,
                path: workspace.path,
                sessionCount: workspace.sessionIds.length,
              }));
              sendJson(res, 200, { ok: true, projects });
              return;
            }
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }

            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const { path, title } = parsed.value ?? {};
            if (typeof path !== 'string' || !path.startsWith('/')) {
              sendJson(res, 400, { code: 'bad-request', message: 'an absolute path is required' });
              return;
            }

            // `create` canonicalises through realpath and is idempotent for a
            // directory that is already a workspace, so re-picking is harmless.
            const workspace = await ctx.workspaceRegistry.create(path, title);
            sendJson(res, 200, {
              ok: true,
              project: {
                id: String(workspace.id),
                title: workspace.title,
                path: workspace.path,
                sessionCount: workspace.sessionIds.length,
              },
            });
          } catch (error) {
            sendJson(res, 500, {
              code: error?.code ?? 'project-failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `sidebar-editor: ${PROJECTS_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: GITHUB_REPOS_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            sendJson(res, 200, { ok: true, repos: await listGithubRepos() });
          } catch (error) {
            sendJson(res, error?.code === 'gh-missing' ? 503 : 500, {
              code: error?.code ?? 'github-failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `sidebar-editor: ${GITHUB_REPOS_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: CLONE_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const { owner, name } = parsed.value ?? {};
            if (typeof owner !== 'string' || typeof name !== 'string') {
              sendJson(res, 400, { code: 'bad-request', message: 'owner and name are required' });
              return;
            }
            sendJson(res, 200, { ok: true, ...(await cloneGithubRepo(owner, name)) });
          } catch (error) {
            const status = error?.code === 'bad-request' ? 400 : error?.code === 'gh-missing' ? 503 : 500;
            sendJson(res, status, {
              code: error?.code ?? 'clone-failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `sidebar-editor: ${CLONE_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: LOCAL_FOLDERS_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'GET') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            sendJson(res, 200, { ok: true, folders: await listLocalFolders() });
          } catch (error) {
            sendJson(res, 500, { code: error?.code ?? 'local-failed', message: String(error?.message ?? error) });
          }
        },
      }),
    `sidebar-editor: ${LOCAL_FOLDERS_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: MKDIR_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const name = typeof parsed.value?.name === 'string' ? parsed.value.name : '';
            sendJson(res, 200, { ok: true, ...(await createLocalFolder(name)) });
          } catch (error) {
            sendJson(res, error?.code === 'bad-request' ? 400 : 500, {
              code: error?.code ?? 'mkdir-failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `sidebar-editor: ${MKDIR_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: REHOME_ROUTE,
        handler: async (req, res) => {
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }
            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }
            const sessionId = typeof parsed.value?.sessionId === 'string' ? parsed.value.sessionId : '';
            const workspaceId = typeof parsed.value?.workspaceId === 'string' ? parsed.value.workspaceId : '';
            if (!sessionId || !workspaceId) {
              sendJson(res, 400, { code: 'bad-request', message: 'sessionId and workspaceId are required' });
              return;
            }
            sendJson(res, 200, { ok: true, ...(await rehomeLiveSession(ctx, sessionId, workspaceId)) });
          } catch (error) {
            const status =
              error?.code === 'workspace-not-found' || error?.code === 'session-not-found' ? 404 : 500;
            sendJson(res, status, {
              code: error?.code ?? 'rehome-failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `sidebar-editor: ${REHOME_ROUTE}`,
  );

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: WRITE_ROUTE,
        handler: async (req, res) => {
          // The webserver turns a thrown handler into a bare 400 with no body,
          // which reads as "bad request" for what is really a server fault. Own
          // every failure here so the pane always gets a JSON reason.
          let diagnostics = {};
          try {
            if (req.method !== 'POST') {
              sendJson(res, 405, { code: 'method-not-allowed' });
              return;
            }

            const parsed = await readJsonBody(req);
            if (parsed.error) {
              sendJson(res, 400, { code: parsed.error });
              return;
            }

            const { sessionId, absolutePath, content, expectedVersion } = parsed.value ?? {};
            if (
              typeof sessionId !== 'string' ||
              typeof absolutePath !== 'string' ||
              typeof content !== 'string'
            ) {
              sendJson(res, 400, {
                code: 'bad-request',
                message: 'sessionId, absolutePath and content are required',
              });
              return;
            }
            if (!absolutePath.startsWith('/')) {
              sendJson(res, 400, {
                code: 'bad-request',
                message: 'absolutePath must be absolute; the pane sends the path it read from',
              });
              return;
            }

            const controller = new AbortController();
            req.on('aborted', () => controller.abort());

            // Resolved outside the write so the failure path can hand the very
            // same policy back to mapError.
            const policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy');
            if (ctx.fs.sandboxMode !== undefined && policy === undefined) {
              sendJson(res, 500, {
                code: 'sandbox-policy-missing',
                message: 'the mounted filesystem confines but ctx.sandboxPolicy is absent',
              });
              return;
            }
            const session = ctx.sessions.get(sessionId);

            // The session's own workspace root, from its header: live when an
            // agent is running, otherwise read from persistence by the lookup
            // provider. `sessions.get()` alone is NOT enough — a session merely
            // open in the sidebar is not in the store, and the fallback root
            // would then deny every write inside the session's own tree.
            const scope = await ctx.typert.lookups.get('workspaceFileScope')?.resolve(sessionId);
            if (scope === undefined) {
              sendJson(res, 404, {
                code: 'unknown-session',
                message: `no workspace root for session ${sessionId}`,
              });
              return;
            }

            const base =
              policy === undefined ? undefined : policy.resolve(session === undefined ? undefined : { session });

            // The header's cwd is the workspace-write boundary; carry it onto the
            // resolved policy so the write is fenced by the session's tree.
            const sandboxPolicy =
              base === undefined ? undefined : { ...base, workspaceRoot: scope.workspaceRoot, sessionId };

            // Recorded before the write so a policy denial explains itself.
            diagnostics = {
              sessionFound: session !== undefined,
              backendSandboxMode: ctx.fs.sandboxMode ?? null,
              resolvedMode: sandboxPolicy?.mode ?? null,
              resolvedWorkspaceRoot: sandboxPolicy?.workspaceRoot ?? null,
              absolutePath,
            };

            const target = await ctx.fs.resolve(absolutePath, { signal: controller.signal });

            const intent =
              typeof expectedVersion === 'string' && expectedVersion.length > 0
                ? { kind: 'replaceIfVersion', version: expectedVersion }
                : undefined;

            const outcome = await ctx.fs.writeText(
              target,
              content,
              intent,
              controller.signal,
              sandboxPolicy,
            );

            sendJson(res, 200, {
              ok: true,
              operation: outcome.operation,
              version: outcome.version,
              bytes: Buffer.byteLength(outcome.after, 'utf8'),
            });
          } catch (error) {
            let code = error?.code ?? 'write-failed';
            let message = String(error?.message ?? error);

            // mapError is a courtesy that names the policy that refused; it must
            // never be the thing that fails.
            try {
              const policy = ctx.fs.sandboxMode === undefined ? undefined : ctx.get('sandboxPolicy');
              if (policy !== undefined) {
                const mapped = policy.mapError(error);
                if (mapped !== undefined) {
                  code = mapped.code ?? code;
                  message = String(mapped.message ?? message);
                }
              }
            } catch {
              /* keep the raw code and message */
            }

            // A stale version means the file moved under the pane; the editor
            // must re-read rather than clobber. FS_SANDBOX_DENIED is the policy
            // refusing, which is a 403 rather than a server fault.
            const status = code === 'FS_STALE_VERSION' ? 409 : code === 'FS_SANDBOX_DENIED' ? 403 : 500;
            sendJson(res, status, { code, message, diagnostics });
          }
        },
      }),
    `sidebar-editor: POST ${WRITE_ROUTE}`,
  );

  void restoreRehousings(ctx).catch((error) => {
    ctx.logger?.warn?.(`sidebar-editor: restore rehome failed: ${String(error?.message ?? error)}`);
  });
}
