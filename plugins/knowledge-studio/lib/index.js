/**
 * Host half of the knowledge studio: HTTP over the existing .kb index.
 *
 * One handler per path — the webserver keys routes by pathname, not method.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_VAULT,
  activeVault,
  addSources,
  createManagedVault,
  destroyVaultLibrary,
  exposeIndex,
  isShippedVault,
  nameFromRoot,
  pathsFor,
  publicConfig,
  readConfig,
  removeSource,
  selectOrAdd,
  syncSourceLinks,
  unlinkSource,
  updateConfig,
  VAULT_HOME,
} from './config.js';
import {
  appendIndexRow,
  bootstrapVault,
  isEmptyVault,
  needsSkeleton,
  ingestFile,
  sanitizeIngestName,
  vaultExists,
} from './vault.js';

export const name = 'knowledge-studio';
export const inject = ['webServer', 'workspaceRegistry', 'systemPrompt'];

const INGEST_MAX_BYTES = 50 * 1024 * 1024;
const EXTRACT_JS = pathToFileURL(
  join(pathsFor(DEFAULT_VAULT).buildScript, '..', 'lib', 'extract.mjs'),
).href;

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PREFIX = '/knowledge-studio';
const SEARCH_JS = pathToFileURL(join(pathsFor(DEFAULT_VAULT).buildScript, '..', 'lib', 'search.mjs')).href;
const WALK_JS = pathToFileURL(join(pathsFor(DEFAULT_VAULT).buildScript, '..', 'lib', 'walk.mjs')).href;

/** @type {null | { child: import('node:child_process').ChildProcess, force: boolean, log: string[], status: string, startedAt: string, error?: string }} */
let rebuild = null;

/** @type {null | { key: string, builtAt: string, handle: object }} */
let indexCache = null;

/** @type {null | { root: string, builtAt: string, at: number, extra: object }} */
let freshnessCache = null;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return { error: 'body-too-large' };
    chunks.push(chunk);
  }
  if (total === 0) return { value: {} };
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { error: 'invalid-json' };
  }
}

async function currentPaths() {
  const config = await readConfig();
  const active = activeVault(config);
  return { config, active, ...pathsFor(active.root) };
}

function configPayload(config, extra = {}) {
  return {
    ok: true,
    ...publicConfig(config),
    defaultVault: DEFAULT_VAULT,
    ...extra,
  };
}

async function indexSummary(root) {
  const indexDir = pathsFor(root).indexDir;
  const manifest = await readManifest(indexDir);
  if (!manifest) return { ready: false, indexDir, hasVectors: false, chunks: 0, files: 0 };
  let hasVectors = false;
  try {
    const info = await stat(join(indexDir, 'vectors.f32'));
    hasVectors = info.size > 0;
  } catch {
    // vectors.f32 is written last; a half-built index has chunks but no vectors
  }
  return {
    ready: hasVectors && Number(manifest.chunks) > 0,
    chunks: Number(manifest.chunks) || 0,
    files: Number(manifest.files) || 0,
    builtAt: manifest.builtAt || '',
    model: manifest.model || '',
    hasVectors,
    indexDir,
  };
}

async function configPayloadWithIndex(config, extra = {}) {
  const payload = configPayload(config, extra);
  payload.vaults = await Promise.all(
    payload.vaults.map(async (vault) => ({
      ...vault,
      index: await indexSummary(vault.root),
    })),
  );
  return payload;
}

async function readManifest(indexDir) {
  try {
    return JSON.parse(await readFile(join(indexDir, 'manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

function snapshotRebuild() {
  if (!rebuild) return null;
  return {
    status: rebuild.status,
    force: rebuild.force,
    startedAt: rebuild.startedAt,
    log: rebuild.log.slice(-80),
    error: rebuild.error,
    vaultId: rebuild.vaultId,
    vaultName: rebuild.vaultName,
  };
}

function dropIndexCache() {
  indexCache = null;
  freshnessCache = null;
}

function resetStudioState() {
  dropIndexCache();
  if (rebuild?.status !== 'running') rebuild = null;
}

async function maybeAutobootstrap(root, isDefault) {
  const exists = await vaultExists(root);
  if (!exists && isDefault) return bootstrapVault(root);
  if (exists && (await isEmptyVault(root))) return bootstrapVault(root);
  return null;
}

async function loadIndex(root, indexDir) {
  const manifest = await readManifest(indexDir);
  const builtAt = manifest?.builtAt ?? '';
  const key = `${root}::${indexDir}`;
  if (indexCache && indexCache.key === key && indexCache.builtAt === builtAt) {
    return indexCache.handle;
  }
  const { KnowledgeIndex } = await import(SEARCH_JS);
  const handle = await KnowledgeIndex.load({
    root,
    indexDir,
    cacheDir: pathsFor(root).cacheDir,
  });
  indexCache = { key, builtAt, handle };
  return handle;
}

async function withFreshness(root, manifest) {
  if (!manifest) return null;
  const now = Date.now();
  if (
    freshnessCache &&
    freshnessCache.root === root &&
    freshnessCache.builtAt === manifest.builtAt &&
    now - freshnessCache.at < 20_000
  ) {
    return { ...manifest, ...freshnessCache.extra };
  }
  try {
    const { walkMarkdown } = await import(WALK_JS);
    const files = await walkMarkdown(root);
    let newest = 0;
    for (const rel of files) {
      try {
        const mtime = (await stat(join(root, rel))).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // file vanished between walk and stat
      }
    }
    const builtAt = Date.parse(manifest.builtAt);
    const extra = {
      currentFiles: files.length,
      stale: Number.isFinite(builtAt) && newest > builtAt,
      newestFileMtime: newest ? new Date(newest).toISOString() : null,
    };
    freshnessCache = { root, builtAt: manifest.builtAt, at: now, extra };
    return { ...manifest, ...extra };
  } catch {
    return manifest;
  }
}

async function listDocs(root) {
  const docs = join(root, 'docs');
  const out = [];
  async function walk(dir, prefix) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel);
      else if (entry.isFile() && /\.(md|markdown|mdx|txt|text|pdf|docx|doc|rtf|odt|pptx|ppt|xlsx|csv|tsv|html|htm|epub|json|jsonl|ya?ml|xml|log)$/i.test(entry.name)) {
        const info = await stat(join(dir, entry.name));
        out.push({
          path: `docs/${rel}`,
          name: entry.name,
          bytes: info.size,
          mtime: info.mtime.toISOString(),
          inbox: rel.startsWith('inbox/'),
        });
      }
    }
  }
  await walk(docs, '');
  return out.sort((a, b) => Number(b.inbox) - Number(a.inbox) || b.mtime.localeCompare(a.mtime));
}

function samePath(a, b) {
  return String(a || '').replace(/\/+$/, '') === String(b || '').replace(/\/+$/, '');
}

async function ensureWorkspace(ctx, root, title) {
  const registry = ctx.workspaceRegistry;
  if (!registry) return null;
  try {
    const existing = registry.list().find((item) => samePath(item.path, root));
    if (existing) {
      if (title && existing.title !== title) {
        if (typeof registry.rename === 'function') await registry.rename(existing.id, title);
        else if (typeof existing.rename === 'function') await existing.rename(title);
      }
      return existing;
    }
    return await registry.create(root, title);
  } catch (error) {
    console.warn('knowledge-studio: workspace sync failed', error);
    return null;
  }
}

async function dropWorkspace(ctx, root) {
  const registry = ctx.workspaceRegistry;
  if (!registry) return;
  const existing = registry.list().find((item) => samePath(item.path, root));
  if (!existing) return;
  try {
    if (typeof registry.delete === 'function') await registry.delete(existing.id);
    else if (typeof existing.delete === 'function') await existing.delete();
  } catch (error) {
    console.warn('knowledge-studio: workspace drop failed', error);
  }
}

async function syncVaultWorkspaces(ctx) {
  const config = await readConfig();
  for (const vault of config.vaults) {
    await ensureWorkspace(ctx, vault.root, vault.name);
  }
}

async function resolveTarget(hint = {}) {
  let config = await readConfig();
  if (typeof hint.vaultId === 'string' && hint.vaultId) {
    if (!config.vaults.some((vault) => vault.id === hint.vaultId)) {
      throw bad('知识库不存在', 'not-found');
    }
    if (config.activeId !== hint.vaultId) {
      config = await updateConfig((current) => ({ ...current, activeId: hint.vaultId }));
      resetStudioState();
    }
  } else if (typeof hint.root === 'string' && hint.root.startsWith('/')) {
    const before = config.activeId;
    config = await updateConfig((current) => selectOrAdd(current, hint.root, hint.name));
    if (config.activeId !== before) resetStudioState();
  }
  const active = activeVault(config);
  return { config, active, ...pathsFor(active.root) };
}

async function ingestText(root, name, text) {
  if (!(await vaultExists(root))) await bootstrapVault(root);
  const file = sanitizeIngestName(name);
  const rel = `docs/inbox/${file}`;
  await mkdir(join(root, 'docs', 'inbox'), { recursive: true });
  await writeFile(join(root, rel), text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  const indexPath = join(root, 'docs', 'INDEX.md');
  try {
    const current = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, appendIndexRow(current, file.replace(/\.md$/i, ''), rel), 'utf8');
  } catch {
    // INDEX.md is optional after a hand-deleted skeleton.
  }
  return rel;
}

function pickFilesNative() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ cancelled: true, message: '选文件只在 macOS 上可用' });
      return;
    }
    const child = spawn('osascript', [
      '-e',
      'tell application "Finder"',
      '-e',
      'activate',
      '-e',
      'set theFiles to choose file with prompt "添加资料到知识库" with multiple selections allowed',
      '-e',
      'set out to ""',
      '-e',
      'repeat with f in theFiles',
      '-e',
      'set out to out & POSIX path of f & linefeed',
      '-e',
      'end repeat',
      '-e',
      'end tell',
      '-e',
      'try',
      '-e',
      'tell application "DeepSeek Harness" to activate',
      '-e',
      'end try',
      '-e',
      'return out',
    ]);
    let out = '';
    child.stdout.on('data', (buf) => {
      out += buf.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ cancelled: true, message: String(error.message || error) });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ cancelled: true });
        return;
      }
      resolve({
        paths: out
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/\/$/, ''))
          .filter(Boolean),
      });
    });
  });
}

function pickMaterialsNative() {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin') {
      resolve({ cancelled: true, message: '选资料只在 macOS 上可用' });
      return;
    }
    const child = spawn('osascript', [
      '-e',
      'tell application "Finder" to activate',
      '-e',
      'set theButton to button returned of (display dialog "要添加文件还是文件夹？都可以多选，不会改你的资料。" buttons {"取消", "文件夹", "文件"} default button "文件" with title "选择资料")',
      '-e',
      'if theButton is "取消" then error number -128',
      '-e',
      'set out to ""',
      '-e',
      'if theButton is "文件" then',
      '-e',
      'set theItems to choose file with prompt "选择资料文件（可多选）" with multiple selections allowed',
      '-e',
      'else',
      '-e',
      'set theItems to choose folder with prompt "选择资料文件夹（可多选）" with multiple selections allowed',
      '-e',
      'end if',
      '-e',
      'repeat with f in theItems',
      '-e',
      'set out to out & POSIX path of f & linefeed',
      '-e',
      'end repeat',
      '-e',
      'try',
      '-e',
      'tell application "DeepSeek Harness" to activate',
      '-e',
      'end try',
      '-e',
      'return out',
    ]);
    let out = '';
    child.stdout.on('data', (buf) => {
      out += buf.toString('utf8');
    });
    child.on('error', (error) => {
      resolve({ cancelled: true, message: String(error.message || error) });
    });
    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ cancelled: true });
        return;
      }
      const paths = out
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/\/$/, ''))
        .filter(Boolean);
      if (paths.length === 0) {
        resolve({ cancelled: true });
        return;
      }
      resolve({ paths, path: paths[0] });
    });
  });
}

function pickFolderNative() {
  return pickMaterialsNative();
}

function revealAllowed(target, config) {
  return config.vaults.some((vault) => {
    const root = resolve(vault.root);
    if (target === root) return true;
    if (
      target === join(root, 'index') ||
      target === join(root, '.kb') ||
      target === join(root, '.kb', 'index')
    ) {
      return true;
    }
    return (vault.sources || []).some((source) => resolve(source.path) === target);
  });
}

function revealInFinder(target, asFile) {
  return new Promise((resolvePromise, reject) => {
    const args = asFile ? ['-R', target] : [target];
    const child = spawn('open', args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error('无法打开文件夹'));
    });
  });
}

function route(ctx, path, handler) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          try {
            await handler(req, res);
          } catch (error) {
            sendJson(res, 500, {
              ok: false,
              code: error?.code ?? 'failed',
              message: String(error?.message ?? error),
            });
          }
        },
      }),
    `knowledge-studio: ${path}`,
  );
}

function methodNotAllowed(res) {
  sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
}

function bad(message, code = 'bad-request') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function syncVaultSources(previous, next) {
  const home = `${resolve(VAULT_HOME)}/`;
  for (const vault of next.vaults) {
    const managed = resolve(vault.root).startsWith(home);
    if (!managed && !(vault.sources || []).length) continue;
    await mkdir(vault.root, { recursive: true });
    await syncSourceLinks(vault.root, vault.sources || []);
  }
  if (!previous) return;
  for (const old of previous.vaults) {
    const current = next.vaults.find((item) => item.id === old.id);
    if (!current) continue;
    const keep = new Set((current.sources || []).map((source) => source.slug));
    for (const source of old.sources || []) {
      if (!keep.has(source.slug)) await unlinkSource(old.root, source.slug);
    }
  }
}

function applyConfigAction(body) {
  return updateConfig((config) => {
    const action = body.action || (body.vaultRoot || body.root ? 'add' : '');
    if (action === 'select') {
      if (!config.vaults.some((vault) => vault.id === body.id)) throw bad('知识库不存在', 'not-found');
      return { ...config, activeId: body.id };
    }
    if (action === 'default') {
      if (!config.vaults.some((vault) => vault.id === body.id)) throw bad('知识库不存在', 'not-found');
      return { ...config, defaultId: body.id };
    }
    if (action === 'rename') {
      const name = String(body.name || '').replace(/\s+/g, ' ').trim();
      if (!name) throw bad('名字不能空');
      if (!config.vaults.some((vault) => vault.id === body.id)) throw bad('知识库不存在', 'not-found');
      return {
        ...config,
        vaults: config.vaults.map((vault) => (vault.id === body.id ? { ...vault, name } : vault)),
      };
    }
    if (action === 'remove') {
      if (typeof body.id !== 'string' || !body.id) throw bad('需要知识库编号');
      if (config.vaults.length <= 1) throw bad('至少保留一个知识库');
      const victim = config.vaults.find((vault) => vault.id === body.id);
      if (!victim) throw bad('知识库不存在', 'not-found');
      if (isShippedVault(victim.root)) throw bad('自带知识库不能删除', 'forbidden');
      const vaults = config.vaults.filter((vault) => vault.id !== body.id);
      if (vaults.length !== config.vaults.length - 1) throw bad('删除失败：一次只能删一个');
      if (vaults.length === 0) throw bad('至少保留一个知识库');
      const defaultId = vaults.some((vault) => vault.id === config.defaultId)
        ? config.defaultId
        : vaults[0].id;
      const activeId = vaults.some((vault) => vault.id === config.activeId)
        ? config.activeId
        : defaultId;
      return { vaults, activeId, defaultId };
    }
    if (action === 'source-add') {
      const paths = Array.isArray(body.paths) ? body.paths : body.path ? [body.path] : [];
      if (paths.length === 0) throw bad('需要资料路径');
      try {
        return addSources(config, body.id, paths);
      } catch (error) {
        throw bad(String(error.message || error));
      }
    }
    if (action === 'source-remove') {
      if (typeof body.path !== 'string' || !body.path.startsWith('/')) throw bad('需要资料路径');
      return removeSource(config, body.id, body.path);
    }
    if (action === 'add' || action === 'path') {
      const raw = body.root || body.vaultRoot;
      if (raw === 'default') {
        return selectOrAdd(config, DEFAULT_VAULT, '知识库');
      }
      if (typeof raw !== 'string' || !raw.startsWith('/')) throw bad('需要绝对路径');
      const next = selectOrAdd(config, raw, body.name);
      if (body.asDefault === true) next.defaultId = next.activeId;
      return next;
    }
    throw bad('无法识别的操作');
  }, body.action === 'remove' ? { dropIds: [body.id] } : {});
}

/**
 * WKWebView refuses <script src> when the URL is longer than ~2560 characters.
 * Official plugins already build a /plugins/??… combo of 2543 bytes; adding
 * this package pushed it to 2574 and the whole plugin tree failed to load.
 * Split oversized boot batches onto each entry's own short combo URL.
 */
const COMBO_URL_SAFE = 2400;

function splitLongBootCombos(table) {
  if (!Array.isArray(table)) return;
  const boot = table.find((row) => row?.kind === 'global' && row.name === '__DSH_BOOT__');
  const graph = boot?.value;
  if (!graph || !Array.isArray(graph.entries) || !Array.isArray(graph.batches)) return;

  const byId = new Map(graph.entries.map((entry) => [entry.id, entry]));
  const batches = [];
  for (const batch of graph.batches) {
    if (typeof batch?.url !== 'string' || batch.url.length <= COMBO_URL_SAFE) {
      batches.push(batch);
      continue;
    }
    for (const id of batch.entries || []) {
      const entry = byId.get(id);
      if (!entry?.url || !entry.rev) continue;
      batches.push({
        phase: batch.phase,
        url: entry.url,
        rev: entry.rev,
        entries: [id],
      });
    }
  }
  graph.batches = batches;

  for (let i = table.length - 1; i >= 0; i--) {
    const row = table[i];
    if (
      (row?.kind === 'script-preload' || row?.kind === 'script-src') &&
      typeof row.src === 'string' &&
      row.src.length > COMBO_URL_SAFE
    ) {
      table.splice(i, 1);
    }
  }
}

const VAULT_PROMPT = [
  'When the session workspace is a knowledge vault (path ends with `/knowledge` or contains `/knowledge-vaults/`):',
  '- The latest user message may already include a `<knowledge_context>` block. If it does, answer from that block only.',
  '- Do NOT call Bash, Skill, Read, Grep, Glob, or `mcp__kb__kb_search` / `mcp__kb__kb_read` when `<knowledge_context>` is present.',
  '- If the block has refuse="true", say this vault does not cover the question. Do not invent an answer or open a Skill.',
  '- Cite used sources by filename only, like 〔手册名.pdf〕. Never write file:// URLs, open: lines, or absolute paths.',
  '- Never open `index/`, `chunks.jsonl`, or `vectors.f32`.',
  '- Only if there is no `<knowledge_context>` block at all, you may call `mcp__kb__kb_search` once, then answer.',
].join('\n');

export function apply(ctx) {
  ctx.on('webserver/index-inject', splitLongBootCombos);
  ctx.systemPrompt.section({
    name: 'knowledge-studio:vault',
    order: 650,
    text: VAULT_PROMPT,
  });
  syncVaultWorkspaces(ctx).catch((error) => {
    console.warn('knowledge-studio: workspace sync failed', error);
  });
  readConfig()
    .then(async (config) => {
      await Promise.all(config.vaults.map((vault) => exposeIndex(vault.root)));
      return syncVaultSources(null, config);
    })
    .catch((error) => {
      console.warn('knowledge-studio: source link sync failed', error);
    });

  route(ctx, `${PREFIX}/config`, async (req, res) => {
    if (req.method === 'GET') {
      const { config, root } = await currentPaths();
      sendJson(res, 200, await configPayloadWithIndex(config, { exists: await vaultExists(root) }));
      return;
    }
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const body = parsed.value ?? {};
    try {
      const previous = await readConfig();
      const next = await applyConfigAction(body);
      let purged = false;
      if (body.action === 'remove') {
        const victim = previous.vaults.find((vault) => vault.id === body.id);
        if (victim) {
          if (rebuild?.vaultId === victim.id && rebuild.status === 'running' && rebuild.child) {
            rebuild.child.kill('SIGTERM');
            rebuild.status = 'cancelled';
          }
          try {
            purged = (await destroyVaultLibrary(victim)).purged;
          } catch (error) {
            console.warn('knowledge-studio: purge failed', error);
          }
          await dropWorkspace(ctx, victim.root);
        }
      }
      const active = activeVault(next);
      resetStudioState();
      if (!(await vaultExists(active.root)) || (await isEmptyVault(active.root))) {
        await bootstrapVault(active.root);
      } else {
        await maybeAutobootstrap(active.root, pathsFor(active.root).isRepoVault);
      }
      await syncVaultSources(previous, next);
      await syncVaultWorkspaces(ctx);
      sendJson(res, 200, configPayload(next, { exists: await vaultExists(active.root), purged }));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        code: error?.code ?? 'bad-request',
        message: String(error?.message ?? error),
      });
    }
  });

  route(ctx, `${PREFIX}/status`, async (req, res) => {
    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    const { config, active, root, indexDir, isRepoVault } = await currentPaths();
    await maybeAutobootstrap(root, isRepoVault);
    const exists = await vaultExists(root);
    const bare = exists ? await needsSkeleton(root) : true;
    const manifest = exists ? await readManifest(indexDir) : null;
    const indexed = Boolean(manifest);
    const index =
      indexed && rebuild?.status !== 'running' ? await withFreshness(root, manifest) : manifest;
    sendJson(res, 200, {
      ...configPayload(config),
      exists,
      bare,
      hasIndex: indexed,
      index,
      isRepoVault,
      isDefaultVault: active.id === config.defaultId,
      rebuild: snapshotRebuild(),
    });
  });

  route(ctx, `${PREFIX}/bootstrap`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const { root } = await currentPaths();
    const target =
      typeof parsed.value?.vaultRoot === 'string' && parsed.value.vaultRoot.startsWith('/')
        ? parsed.value.vaultRoot
        : root;
    const result = await bootstrapVault(target);
    sendJson(res, 200, { ok: true, ...result, vaultRoot: target });
  });

  route(ctx, `${PREFIX}/reveal`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const raw = parsed.value?.path;
    if (typeof raw !== 'string' || !raw.startsWith('/')) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: '路径无效' });
      return;
    }
    const target = resolve(raw);
    const config = await readConfig();
    if (!revealAllowed(target, config)) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: '只能打开知识库或资料路径' });
      return;
    }
    const info = await stat(target);
    await revealInFinder(target, info.isFile());
    sendJson(res, 200, { ok: true, path: target });
  });

  route(ctx, `${PREFIX}/pick-folder`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const picked = await pickFolderNative();
    if (picked.cancelled) {
      sendJson(res, 200, { ok: true, cancelled: true, message: picked.message });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      path: picked.path,
      paths: picked.paths || (picked.path ? [picked.path] : []),
      suggestedName: picked.path === DEFAULT_VAULT ? '知识库' : nameFromRoot(picked.path),
    });
  });

  route(ctx, `${PREFIX}/create`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const body = parsed.value ?? {};
    let sourcePaths = Array.isArray(body.sourcePaths)
      ? body.sourcePaths.filter((path) => typeof path === 'string' && path.startsWith('/'))
      : typeof body.sourcePath === 'string' && body.sourcePath.startsWith('/')
        ? [body.sourcePath]
        : [];
    if (sourcePaths.length === 0) {
      const picked = await pickMaterialsNative();
      if (picked.cancelled) {
        sendJson(res, 200, { ok: true, cancelled: true, message: picked.message });
        return;
      }
      sourcePaths = picked.paths || (picked.path ? [picked.path] : []);
    }
    sourcePaths = [...new Set(sourcePaths.map((path) => resolve(path)))];
    if (sourcePaths.length === 0) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: '需要资料文件或文件夹' });
      return;
    }
    if (sourcePaths.some((path) => path === resolve(VAULT_HOME))) {
      sendJson(res, 400, {
        ok: false,
        code: 'bad-request',
        message: '请选择资料，不要选库目录本身',
      });
      return;
    }
    const previous = await readConfig();
    const existing =
      sourcePaths.length === 1
        ? previous.vaults.find((vault) => vault.root === sourcePaths[0])
        : null;
    const next = existing
      ? await updateConfig((config) => ({ ...config, activeId: existing.id }))
      : await updateConfig((config) =>
          createManagedVault(config, { name: body.name, sourcePaths }),
        );
    const active = activeVault(next);
    resetStudioState();
    await mkdir(active.root, { recursive: true });
    const createdNew = !existing;
    if (!(await vaultExists(active.root)) || (await isEmptyVault(active.root))) {
      await bootstrapVault(active.root, { managed: createdNew || resolve(active.root).startsWith(`${resolve(VAULT_HOME)}/`) });
    }
    await syncVaultSources(previous, next);
    await syncVaultWorkspaces(ctx);
    const indexed = Boolean(await readManifest(pathsFor(active.root).indexDir));
    sendJson(res, 200, configPayload(next, {
      exists: true,
      createdId: active.id,
      hasIndex: indexed,
      setup: createdNew && !indexed && (active.sources || []).length > 0,
    }));
  });

  route(ctx, `${PREFIX}/pick-ingest`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const { active, root } = await resolveTarget(parsed.value ?? {});
    const picked = await pickFilesNative();
    if (picked.cancelled) {
      sendJson(res, 200, { ok: true, cancelled: true, message: picked.message });
      return;
    }
    const { isIndexableName, extractText } = await import(EXTRACT_JS);
    const files = [];
    const skipped = [];
    for (const filePath of picked.paths || []) {
      const base = filePath.split('/').pop() || '';
      if (!isIndexableName(base)) {
        skipped.push(`${base}（格式还不支持）`);
        continue;
      }
      const info = await stat(filePath);
      if (info.size > INGEST_MAX_BYTES) {
        skipped.push(`${base}（超过 50MB）`);
        continue;
      }
      try {
        const text = await extractText(filePath);
        if (!String(text || '').trim()) {
          skipped.push(`${base}（没有提取到文字）`);
          continue;
        }
      } catch (error) {
        skipped.push(`${base}（${error?.message ?? error}）`);
        continue;
      }
      files.push(await ingestFile(root, filePath, base));
    }
    sendJson(res, 200, {
      ok: true,
      files,
      skipped,
      vaultId: active.id,
      vaultName: active.name,
    });
  });

  route(ctx, `${PREFIX}/search`, async (req, res) => {
    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    const url = new URL(req.url || '', 'http://127.0.0.1');
    const query = (url.searchParams.get('q') || '').trim();
    if (!query) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: 'q is required' });
      return;
    }
    const { root, indexDir } = await currentPaths();
    if (!(await readManifest(indexDir))) {
      sendJson(res, 409, { ok: false, code: 'no-index', message: '还没有向量索引' });
      return;
    }
    const handle = await loadIndex(root, indexDir);
    const k = Math.min(Math.max(Number(url.searchParams.get('k')) || 8, 1), 20);
    const result = await handle.retrieve(query, { k, cacheDir: pathsFor(root).cacheDir });
    sendJson(res, 200, {
      ok: true,
      query: result.query,
      intent: result.intent,
      resolved: result.resolved || null,
      dense: result.dense,
      matches: result.matches.map((match) => ({
        path: match.path,
        kind: match.kind,
        heading: match.heading,
        startLine: match.startLine,
        endLine: match.endLine,
        score: match.score,
        snippet: snippetOf(match.description || match.text),
      })),
    });
  });

  route(ctx, `${PREFIX}/retrieve`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    sendJson(res, 200, await retrieveVault(parsed.value ?? {}));
  });

  route(ctx, `${PREFIX}/files`, async (req, res) => {
    if (req.method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    const { root } = await currentPaths();
    if (!(await vaultExists(root))) {
      sendJson(res, 200, { ok: true, files: [] });
      return;
    }
    sendJson(res, 200, { ok: true, files: await listDocs(root) });
  });

  route(ctx, `${PREFIX}/ingest`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    const { name, text } = parsed.value ?? {};
    if (typeof text !== 'string' || text.trim() === '') {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: 'text is required' });
      return;
    }
    const { active, root } = await resolveTarget(parsed.value ?? {});
    const rel = await ingestText(root, name, text);
    sendJson(res, 200, { ok: true, path: rel, vaultId: active.id });
  });

  route(ctx, `${PREFIX}/rebuild`, async (req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, rebuild: snapshotRebuild() });
      return;
    }
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    if (parsed.error) {
      sendJson(res, 400, { ok: false, code: parsed.error });
      return;
    }
    if (parsed.value?.cancel === true) {
      if (rebuild?.child && rebuild.status === 'running') {
        rebuild.child.kill('SIGTERM');
        rebuild.status = 'cancelled';
      }
      sendJson(res, 200, { ok: true, rebuild: snapshotRebuild() });
      return;
    }
    if (rebuild?.status === 'running') {
      sendJson(res, 409, { ok: false, code: 'busy', message: '已有重建在跑' });
      return;
    }
    const { active, root, indexDir, cacheDir, buildScript } = await resolveTarget(parsed.value ?? {});
    if (!(await vaultExists(root))) await bootstrapVault(root);
    const force = parsed.value?.force === true;
    const child = spawn(process.execPath, [buildScript, ...(force ? ['--force'] : [])], {
      cwd: join(buildScript, '..'),
      env: {
        ...process.env,
        KB_ROOT: root,
        KB_INDEX_DIR: indexDir,
        KB_CACHE_DIR: cacheDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    rebuild = {
      child,
      force,
      log: [],
      status: 'running',
      startedAt: new Date().toISOString(),
      vaultId: active.id,
      vaultName: active.name,
    };
    const onChunk = (buf) => {
      const text = buf.toString('utf8');
      for (const line of text.split('\n')) {
        if (line.trim()) rebuild?.log.push(line);
      }
      if (rebuild && rebuild.log.length > 200) rebuild.log = rebuild.log.slice(-120);
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (error) => {
      if (!rebuild) return;
      rebuild.status = 'error';
      rebuild.error = String(error.message || error);
    });
    child.on('close', (code) => {
      if (!rebuild) return;
      if (rebuild.status === 'cancelled') return;
      rebuild.status = code === 0 ? 'ok' : 'error';
      if (code !== 0 && !rebuild.error) rebuild.error = `exit ${code}`;
      if (code === 0) dropIndexCache();
    });
    sendJson(res, 200, { ok: true, rebuild: snapshotRebuild() });
  });

  route(ctx, `${PREFIX}/sync`, async (req, res) => {
    if (req.method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    const parsed = await readJsonBody(req);
    const kind = parsed.value?.kind;
    const { isRepoVault, syncSkills, syncGithub } = await currentPaths();
    if (!isRepoVault) {
      sendJson(res, 400, {
        ok: false,
        code: 'not-repo',
        message: '同步脚本只写仓库内的 knowledge/',
      });
      return;
    }
    const script = kind === 'github' ? syncGithub : kind === 'skills' ? syncSkills : null;
    if (!script) {
      sendJson(res, 400, { ok: false, code: 'bad-request', message: 'kind 必须是 skills 或 github' });
      return;
    }
    const result = await new Promise((resolvePromise) => {
      const child = spawn('bash', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (buf) => {
        out += buf.toString('utf8');
      });
      child.stderr.on('data', (buf) => {
        out += buf.toString('utf8');
      });
      child.on('close', (code) => resolvePromise({ code, out }));
    });
    sendJson(res, result.code === 0 ? 200 : 500, {
      ok: result.code === 0,
      log: result.out.trim(),
    });
  });
}

function snippetOf(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length <= 180 ? flat : `${flat.slice(0, 177)}…`;
}

const RETRIEVE_K = 8;
const FOLLOW_UP =
  /^(那|还有|然后|继续|同上|这个|刚才|上面|以及|所以)|第[一二三四五六七八九十\d]+天|呢$|怎么样$|具体(呢|是)/;

function isFollowUpQuery(query, previous) {
  const q = String(query || '').trim();
  const prev = String(previous || '').trim();
  if (!prev || prev === q) return false;
  return q.length <= 18 || FOLLOW_UP.test(q);
}

function composeRetrieveQuery(query, previous) {
  const q = String(query || '').trim();
  const prev = String(previous || '').trim();
  return isFollowUpQuery(q, prev) ? `${prev} ${q}` : q;
}

function vaultForRetrieve(config, hint = {}) {
  if (typeof hint.vaultId === 'string' && hint.vaultId) {
    const named = config.vaults.find((vault) => vault.id === hint.vaultId);
    if (named) return named;
  }
  if (typeof hint.root === 'string' && hint.root.startsWith('/')) {
    const root = resolve(hint.root);
    const match = config.vaults.find((vault) => resolve(vault.root) === root);
    if (match) return match;
  }
  return activeVault(config);
}

function clipPassage(text, max = 1800) {
  const value = String(text || '').trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n…`;
}

function isNavChunkPath(rel) {
  return /(^|\/)(INDEX|README|AGENTS)\.md$/i.test(rel) || rel.startsWith('index/') || rel.startsWith('.kb/');
}

function vaultOutline(handle) {
  const files = new Map();
  for (const chunk of handle.chunks) {
    const rel = chunk.path;
    if (!rel || isNavChunkPath(rel)) continue;
    let entry = files.get(rel);
    if (!entry) {
      entry = { path: rel, headings: [] };
      files.set(rel, entry);
    }
    const heading = String(chunk.heading || chunk.name || '').trim();
    if (heading && !entry.headings.includes(heading) && entry.headings.length < 16) {
      entry.headings.push(heading);
    }
  }
  const list = [...files.values()];
  if (list.length === 0 || list.length > 8) return [];
  return list.slice(0, 8);
}

async function openUrlFor(root, rel) {
  const abs = resolve(root, rel);
  try {
    return pathToFileURL(await realpath(abs)).href;
  } catch {
    return pathToFileURL(abs).href;
  }
}

function fileNameOf(rel) {
  return String(rel || '').split('/').pop() || rel;
}

async function formatRetrieveMatches(root, matches) {
  const out = [];
  for (const match of matches) {
    const open = await openUrlFor(root, match.path);
    out.push({
      path: match.path,
      name: fileNameOf(match.path),
      kind: match.kind,
      heading: match.heading || '',
      startLine: match.startLine,
      endLine: match.endLine,
      score: match.score,
      open,
      text: clipPassage(match.text || match.description || ''),
    });
  }
  return out;
}

function buildRetrievePrompt({ vaultName, refuse, matches, outline, resolved }) {
  if (refuse) {
    return [
      `<knowledge_context vault="${vaultName}" refuse="true">`,
      'Retrieval found no reliable match in this vault.',
      'Reply that this vault does not cover the question. Do not call tools or skills.',
      '</knowledge_context>',
    ].join('\n');
  }
  const lines = [
    `<knowledge_context vault="${vaultName}" refuse="false"${resolved ? ` skill="${resolved}"` : ''}>`,
    resolved
      ? `The vault resolved this question to "${resolved}". These passages are from that document. Answer using only this context.`
      : 'These passages were already retrieved from this vault. Answer using only this context.',
    'Do not call Bash, Skill, Read, Grep, Glob, or mcp__kb__kb_search. Do not open index files.',
    'When you cite a source, write only the filename in brackets, e.g. 〔手册名.pdf〕. Never paste file:// URLs, open: lines, or absolute paths.',
  ];
  if (outline.length) {
    lines.push('', '## Outline');
    for (const file of outline) {
      lines.push(`- ${file.path}`);
      for (const heading of file.headings.slice(0, 8)) lines.push(`  - ${heading}`);
    }
  }
  lines.push('', '## Passages');
  matches.forEach((match, i) => {
    lines.push(`### [${i + 1}] ${match.path}${match.heading ? ` — ${match.heading}` : ''}`);
    lines.push(`open: ${match.open}`);
    lines.push(match.text, '');
  });
  lines.push('</knowledge_context>');
  return lines.join('\n');
}

async function retrieveVault(hint = {}) {
  const query = String(hint.query || '').trim();
  if (!query) throw bad('需要问题', 'bad-request');
  const config = await readConfig();
  const vault = vaultForRetrieve(config, hint);
  const { root, indexDir, cacheDir } = pathsFor(vault.root);
  if (!(await readManifest(indexDir))) {
    const error = bad('还没有向量索引', 'no-index');
    throw error;
  }
  const handle = await loadIndex(root, indexDir);
  const searchQuery = composeRetrieveQuery(query, hint.previous);
  const sourceFiles = new Set(
    handle.chunks.filter((chunk) => chunk.path && !isNavChunkPath(chunk.path)).map((chunk) => chunk.path),
  ).size;
  const result = await handle.retrieve(searchQuery, {
    k: RETRIEVE_K,
    cacheDir,
    collapse: sourceFiles > 8,
  });
  const refuse = result.refuse === true || result.matches.length === 0;
  const matches = refuse ? [] : await formatRetrieveMatches(root, result.matches);
  const outline = vaultOutline(handle);
  const sources = [];
  const seen = new Set();
  for (const match of matches) {
    if (seen.has(match.path)) continue;
    seen.add(match.path);
    sources.push({ path: match.path, name: match.name, open: match.open });
  }
  return {
    ok: true,
    query: searchQuery,
    userQuery: query,
    vaultId: vault.id,
    vaultName: vault.name,
    root,
    refuse,
    confidence: refuse ? 'low' : 'ok',
    dense: result.dense,
    matches,
    sources,
    outline,
    intent: result.intent,
    resolved: result.resolved || null,
    prompt: buildRetrievePrompt({
      vaultName: vault.name,
      refuse,
      matches,
      outline,
      resolved: result.resolved || null,
    }),
  };
}
