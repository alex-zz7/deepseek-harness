/**
 * Move an existing session onto another workspace without minting a blank one.
 *
 * Host session cwd is creation metadata, so the live header is rewritten and
 * the workspace registry is reindexed before attach. That is what makes the
 * sidebar follow: membership is header-cwd === workspace path.
 *
 * The on-disk log keeps its original cwd (rewriting it while a write lease is
 * held would move the artifact). An override file reapplies the move after
 * restart so the row does not vanish from the new group.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const FILE = join(homedir(), '.dsh', 'sidebar-editor-rehome.json');

let tail = Promise.resolve();

/**
 * @param ctx - host context with `sessions` and `workspaceRegistry`
 * @param sessionId - session to keep
 * @param workspaceId - workspace that should own it in the sidebar
 */
export async function rehomeLiveSession(ctx, sessionId, workspaceId) {
  const workspace = ctx.workspaceRegistry.get(workspaceId);
  if (workspace === undefined) {
    const error = new Error(`unknown workspace ${workspaceId}`);
    error.code = 'workspace-not-found';
    throw error;
  }

  const live = ctx.sessions.get(sessionId);
  const header = await readHeader(ctx, sessionId, live);
  const alreadyHere = workspace.sessionIds.includes(sessionId) && header.cwd === workspace.path;
  if (alreadyHere) {
    return { live: live !== undefined, path: workspace.path, title: workspace.title, unchanged: true };
  }

  const nextHeader = Object.freeze({
    ...header,
    cwd: workspace.path,
  });
  if (live !== undefined) live.header = nextHeader;
  if (typeof ctx.workspaceRegistry.indexHeader === 'function') {
    await ctx.workspaceRegistry.indexHeader(nextHeader);
  }

  for (const item of ctx.workspaceRegistry.list()) {
    if (item.id === workspace.id) continue;
    await item.detachSession(sessionId);
  }
  await workspace.attachSession(sessionId);
  await writeOverride(sessionId, workspace.id, workspace.path);
  return { live: live !== undefined, path: workspace.path, title: workspace.title };
}

/** Re-apply stored moves after the registry has already bootstrapped from disk. */
export async function restoreRehousings(ctx) {
  const overrides = await readOverrides();
  for (const [sessionId, entry] of Object.entries(overrides)) {
    const workspaceId = typeof entry === 'object' && entry !== null ? entry.workspaceId : undefined;
    const path = typeof entry === 'string' ? entry : entry?.path;
    const workspace =
      (workspaceId !== undefined ? ctx.workspaceRegistry.get(workspaceId) : undefined) ??
      ctx.workspaceRegistry.list().find((item) => item.path === path);
    if (workspace === undefined) continue;
    try {
      await rehomeLiveSession(ctx, sessionId, workspace.id);
    } catch (error) {
      ctx.logger?.warn?.(`sidebar-editor: restore rehome ${sessionId}: ${String(error?.message ?? error)}`);
    }
  }
}

async function readHeader(ctx, sessionId, live) {
  if (live !== undefined) return live.header;
  const cached = ctx.workspaceRegistry.headers?.get(sessionId);
  if (cached !== undefined) return cached;
  const snap = await ctx.sessionPersistence?.stat?.(sessionId);
  if (snap?.header !== undefined) return snap.header;
  const error = new Error(`session ${sessionId} is not loaded`);
  error.code = 'session-not-found';
  throw error;
}

async function readOverrides() {
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeOverride(sessionId, workspaceId, path) {
  const work = tail.then(async () => {
    const current = await readOverrides();
    current[sessionId] = { workspaceId, path };
    await mkdir(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await rename(tmp, FILE);
  });
  tail = work.catch(() => {});
  return work;
}
