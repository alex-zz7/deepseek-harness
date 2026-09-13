/**
 * Named knowledge vaults. Lives under ~/.dsh so a random dsh-web port
 * cannot wipe the list.
 */

import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = join(homedir(), '.dsh', 'knowledge-studio.json');
const FILE_GOOD = `${FILE}.good`;
const FILE_LOCK = `${FILE}.lock`;
const VAULT_META = '.vault.json';

/** Managed libraries live beside the shipped knowledge/ folder. */
export const VAULT_HOME = resolve(fileURLToPath(new URL('../../../knowledge-vaults', import.meta.url)));

/** Repo knowledge/ — shipped starter vault. */
export const DEFAULT_VAULT = resolve(
  fileURLToPath(new URL('../../../knowledge', import.meta.url)),
);

export function isManagedVault(root) {
  return resolve(root).startsWith(`${resolve(VAULT_HOME)}/`);
}

export function isShippedVault(root) {
  return resolve(root) === resolve(DEFAULT_VAULT);
}

const KB_DIR = resolve(fileURLToPath(new URL('../../../knowledge/.kb', import.meta.url)));

let tail = Promise.resolve();

/** Visible `index/` first so Finder shows the vectors. Old vaults used `.kb/index`. */
export function resolveIndexDir(root) {
  const base = resolve(root);
  const visible = join(base, 'index');
  const hidden = join(base, '.kb', 'index');
  if (existsSync(join(visible, 'manifest.json'))) return visible;
  if (existsSync(join(hidden, 'manifest.json'))) return hidden;
  return visible;
}

/** Make the index folder visible as `index/` (symlink the old hidden dir if needed). */
export async function exposeIndex(root) {
  const base = resolve(root);
  const visible = join(base, 'index');
  const hidden = join(base, '.kb', 'index');
  if (existsSync(join(visible, 'manifest.json'))) return visible;
  if (existsSync(join(hidden, 'manifest.json'))) {
    try {
      await unlink(visible);
    } catch {
      // no stub
    }
    try {
      await symlink(hidden, visible);
    } catch {
      // race with another expose
    }
    return existsSync(join(visible, 'manifest.json')) ? visible : hidden;
  }
  await mkdir(visible, { recursive: true });
  return visible;
}

export function pathsFor(vaultRoot) {
  const root = resolve(vaultRoot);
  return {
    root,
    indexDir: resolveIndexDir(root),
    cacheDir: join(KB_DIR, '.model-cache'),
    buildScript: join(KB_DIR, 'build-index.mjs'),
    syncSkills: join(DEFAULT_VAULT, 'scripts', 'sync-skills.sh'),
    syncGithub: join(DEFAULT_VAULT, 'scripts', 'sync-github.sh'),
    isRepoVault: root === DEFAULT_VAULT,
  };
}

export function newVaultId() {
  return `kb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function nameFromRoot(root) {
  return String(root || '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .pop() || '知识库';
}

function stripFileExt(name) {
  return String(name || '').replace(/\.(pdf|docx?|pptx?|xlsx?|md|txt|html?|rtf|epub)$/i, '');
}

function cleanName(name, fallback) {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}

function vaultTitle(name, fallback) {
  return cleanName(stripFileExt(name), stripFileExt(fallback) || fallback);
}

export function sourceSlug(sourcePath, used = new Set()) {
  const base =
    nameFromRoot(sourcePath)
      .replace(/[^\w.\u4e00-\u9fff-]+/g, '-')
      .replace(/^-+|-+$/g, '') || '资料';
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

export function normalizeSources(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const used = new Set();
  const out = [];
  for (const row of raw) {
    const path = typeof row === 'string' ? row : row?.path;
    if (typeof path !== 'string' || !isAbsolute(path)) continue;
    const resolved = resolve(path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const slug =
      typeof row === 'object' && typeof row.slug === 'string' && row.slug
        ? row.slug
        : sourceSlug(resolved, used);
    used.add(slug);
    out.push({
      path: resolved,
      name: cleanName(typeof row === 'object' ? row.name : '', nameFromRoot(resolved)),
      slug,
    });
  }
  return out;
}

export async function syncSourceLinks(root, sources) {
  const dir = join(resolve(root), 'sources');
  await mkdir(dir, { recursive: true });
  const keep = new Set();
  for (const source of normalizeSources(sources)) {
    keep.add(source.slug);
    const dest = join(dir, source.slug);
    try {
      const info = await lstat(dest);
      if (info.isSymbolicLink()) {
        const current = await readlink(dest);
        const resolved = current.startsWith('/') ? resolve(current) : resolve(dir, current);
        if (resolved === source.path) continue;
        await unlink(dest);
      } else {
        continue;
      }
    } catch {
      // missing or dangling — recreate below
    }
    await symlink(source.path, dest);
  }
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (keep.has(entry.name) || !entry.isSymbolicLink()) continue;
      await unlink(join(dir, entry.name));
    }
  } catch {
    // sources/ may be empty on a brand-new vault
  }
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      vaults: [{ id: 'kb_default', name: '知识库', root: DEFAULT_VAULT, sources: [] }],
      activeId: 'kb_default',
      defaultId: 'kb_default',
    };
  }

  if (Array.isArray(raw.vaults) && raw.vaults.length > 0) {
    const seen = new Set();
    const vaults = [];
    for (const row of raw.vaults) {
      if (!row || typeof row.root !== 'string' || !isAbsolute(row.root)) continue;
      const root = resolve(row.root);
      if (seen.has(root)) continue;
      seen.add(root);
      vaults.push({
        id: typeof row.id === 'string' && row.id ? row.id : newVaultId(),
        name: vaultTitle(row.name, root === DEFAULT_VAULT ? '知识库' : nameFromRoot(root)),
        root,
        sources: normalizeSources(row.sources),
      });
    }
    if (vaults.length === 0) return normalizeConfig(null);
    const ids = new Set(vaults.map((vault) => vault.id));
    const defaultId = ids.has(raw.defaultId) ? raw.defaultId : vaults[0].id;
    const activeId = ids.has(raw.activeId) ? raw.activeId : defaultId;
    return { vaults, activeId, defaultId };
  }

  const root =
    typeof raw.vaultRoot === 'string' && isAbsolute(raw.vaultRoot)
      ? resolve(raw.vaultRoot)
      : DEFAULT_VAULT;
  return {
    vaults: [
      {
        id: 'kb_default',
        name: root === DEFAULT_VAULT ? '知识库' : nameFromRoot(root),
        root,
        sources: [],
      },
    ],
    activeId: 'kb_default',
    defaultId: 'kb_default',
  };
}

export function activeVault(config) {
  return config.vaults.find((vault) => vault.id === config.activeId) || config.vaults[0];
}

export function vaultByPath(config, root) {
  const resolved = resolve(root);
  return config.vaults.find((vault) => vault.root === resolved);
}

export function publicConfig(config) {
  const active = activeVault(config);
  return {
    vaults: config.vaults.map((vault) => ({
      id: vault.id,
      name: vault.name,
      root: vault.root,
      isActive: vault.id === config.activeId,
      isDefault: vault.id === config.defaultId,
      isRepo: vault.root === DEFAULT_VAULT,
      managed: isManagedVault(vault.root),
      sources: (vault.sources || []).map((source) => ({
        path: source.path,
        name: source.name,
        slug: source.slug,
      })),
    })),
    vaultHome: VAULT_HOME,
    activeId: config.activeId,
    defaultId: config.defaultId,
    vaultRoot: active.root,
    activeName: active.name,
  };
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function readRaw() {
  return readJsonFile(FILE);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await writeFile(FILE_LOCK, String(process.pid), { flag: 'wx' });
      return async () => {
        try {
          await unlink(FILE_LOCK);
        } catch {
          // lock already released
        }
      };
    } catch {
      try {
        const pid = Number(await readFile(FILE_LOCK, 'utf8'));
        if (!pidAlive(pid)) await unlink(FILE_LOCK);
      } catch {
        // lock disappeared
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  return async () => {};
}

function rootKey(root) {
  return resolve(root);
}

function unionVaults(...lists) {
  const byRoot = new Map();
  for (const list of lists) {
    for (const vault of list || []) {
      if (!vault?.root) continue;
      const key = rootKey(vault.root);
      const current = byRoot.get(key);
      if (!current) {
        byRoot.set(key, vault);
        continue;
      }
      byRoot.set(key, {
        ...current,
        ...vault,
        id: current.id || vault.id,
        name: vault.name || current.name,
        sources: (vault.sources || []).length ? vault.sources : current.sources,
      });
    }
  }
  return [...byRoot.values()];
}

function sameVaultSet(left, right) {
  const a = new Set((left?.vaults || []).map((vault) => rootKey(vault.root)));
  const b = new Set((right?.vaults || []).map((vault) => rootKey(vault.root)));
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

async function writeVaultSidecar(vault) {
  if (!vault || !isManagedVault(vault.root)) return;
  await mkdir(vault.root, { recursive: true });
  await writeFile(
    join(vault.root, VAULT_META),
    JSON.stringify(
      {
        id: vault.id,
        name: vault.name,
        sources: vault.sources || [],
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function readVaultSidecar(root) {
  const raw = await readJsonFile(join(root, VAULT_META));
  if (!raw || typeof raw !== 'object') return null;
  const sources = normalizeSources(raw.sources);
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : nameFromRoot(root),
    name: vaultTitle(raw.name, sources[0]?.name || nameFromRoot(root)),
    root,
    sources,
  };
}

export async function discoverManagedVaults() {
  let entries = [];
  try {
    entries = await readdir(VAULT_HOME, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^kb_[a-z0-9]+$/i.test(entry.name)) continue;
    const root = join(VAULT_HOME, entry.name);
    const sidecar = await readVaultSidecar(root);
    const sources = [];
    try {
      const links = await readdir(join(root, 'sources'), { withFileTypes: true });
      for (const link of links) {
        if (!link.isSymbolicLink()) continue;
        const dest = join(root, 'sources', link.name);
        const target = await readlink(dest);
        const path = target.startsWith('/') ? resolve(target) : resolve(join(root, 'sources'), target);
        sources.push({ path, name: nameFromRoot(path), slug: link.name });
      }
    } catch {
      // sources/ may be missing on a half-created vault
    }
    const fromLinks = normalizeSources(sources);
    const normalized = fromLinks.length ? fromLinks : sidecar?.sources || [];
    found.push({
      id: sidecar?.id && sidecar.id === entry.name ? sidecar.id : entry.name,
      name: vaultTitle(sidecar?.name, normalized[0]?.name || nameFromRoot(root)),
      root,
      sources: normalized,
    });
  }
  return found;
}

export function mergeDiscoveredVaults(config, discovered) {
  const have = new Set(config.vaults.map((vault) => resolve(vault.root)));
  const usedNames = new Set(config.vaults.map((vault) => vault.name));
  const extra = [];
  for (const vault of discovered) {
    if (have.has(resolve(vault.root))) continue;
    let name = vault.name;
    if (usedNames.has(name)) name = `${name} 副本`;
    usedNames.add(name);
    extra.push({ ...vault, name });
  }
  if (extra.length === 0) return config;
  return { ...config, vaults: [...config.vaults, ...extra] };
}

async function recoverManagedVaults(config) {
  return mergeDiscoveredVaults(config, await discoverManagedVaults());
}

async function assembleConfig() {
  const current = normalizeConfig(await readRaw());
  const good = normalizeConfig(await readJsonFile(FILE_GOOD));
  const merged = normalizeConfig({
    ...current,
    vaults: unionVaults(good.vaults, current.vaults),
    activeId: current.activeId,
    defaultId: current.defaultId,
  });
  return recoverManagedVaults(merged);
}

export async function readConfig() {
  const current = normalizeConfig(await readRaw());
  const assembled = await assembleConfig();
  if (sameVaultSet(assembled, current)) {
    await Promise.all(assembled.vaults.map((vault) => writeVaultSidecar(vault).catch(() => {})));
    return assembled;
  }
  return updateConfig(() => assembled);
}

async function persist(next, { dropIds = [] } = {}) {
  const drop = new Set(dropIds.filter((id) => typeof id === 'string' && id));
  const previous = normalizeConfig(await readRaw());
  const discovered = await discoverManagedVaults();
  const good = normalizeConfig(await readJsonFile(FILE_GOOD));
  let vaults = unionVaults(good.vaults, previous.vaults, next.vaults, discovered);
  if (drop.size) {
    vaults = vaults.filter((vault) => !drop.has(vault.id));
  }
  const ids = new Set(vaults.map((vault) => vault.id));
  const defaultId = ids.has(next.defaultId)
    ? next.defaultId
    : ids.has(previous.defaultId)
      ? previous.defaultId
      : vaults[0]?.id;
  const activeId = ids.has(next.activeId)
    ? next.activeId
    : ids.has(previous.activeId)
      ? previous.activeId
      : defaultId;
  const saved = normalizeConfig({ vaults, activeId, defaultId });

  await mkdir(dirname(FILE), { recursive: true });
  try {
    const existing = await readFile(FILE, 'utf8');
    if (existing.trim()) await writeFile(`${FILE}.bak`, existing, 'utf8');
  } catch {
    // first write has nothing to back up
  }
  const temporary = `${FILE}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(saved, null, 2), 'utf8');
  await rename(temporary, FILE);
  const goodCount = good.vaults.length;
  if (drop.size || saved.vaults.length >= Math.max(previous.vaults.length, goodCount)) {
    await writeFile(FILE_GOOD, JSON.stringify(saved, null, 2), 'utf8');
  }
  await Promise.all(saved.vaults.map((vault) => writeVaultSidecar(vault).catch(() => {})));
  return saved;
}

export function updateConfig(mutator, options = {}) {
  const run = tail.then(async () => {
    const release = await acquireLock();
    try {
      const current = await assembleConfig();
      const next = normalizeConfig(await mutator(current));
      return persist(next, options);
    } finally {
      await release();
    }
  });
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** @deprecated use updateConfig; kept for one-shot patches during migration. */
export function writeConfig(patch) {
  return updateConfig((current) => {
    if (patch && typeof patch.vaultRoot === 'string') {
      return selectOrAdd(current, patch.vaultRoot, patch.name);
    }
    return { ...current, ...patch };
  });
}

export function selectOrAdd(config, root, name) {
  const resolved = resolve(root);
  const existing = config.vaults.find((vault) => vault.root === resolved);
  if (existing) {
    return { ...config, activeId: existing.id };
  }
  const vault = {
    id: newVaultId(),
    name: vaultTitle(name, resolved === DEFAULT_VAULT ? '知识库' : nameFromRoot(resolved)),
    root: resolved,
    sources: [],
  };
  return {
    ...config,
    vaults: [...config.vaults, vault],
    activeId: vault.id,
  };
}

export function createManagedVault(config, { name, sourcePath, sourcePaths } = {}) {
  const id = newVaultId();
  const paths = [];
  if (Array.isArray(sourcePaths)) paths.push(...sourcePaths);
  if (typeof sourcePath === 'string') paths.push(sourcePath);
  const sources = normalizeSources(paths);
  const title = vaultTitle(name, sources[0] ? sources[0].name : '知识库');
  const vault = {
    id,
    name: title,
    root: join(VAULT_HOME, id),
    sources,
  };
  return {
    ...config,
    vaults: [...config.vaults, vault],
    activeId: id,
  };
}

export function addSource(config, id, sourcePath) {
  const resolved = resolve(sourcePath);
  const vault = config.vaults.find((item) => item.id === id);
  if (!vault) throw new Error('知识库不存在');
  if (resolve(vault.root) === resolved) throw new Error('资料路径不能是库文件夹本身');
  if ((vault.sources || []).some((source) => source.path === resolved)) return config;
  const used = new Set((vault.sources || []).map((source) => source.slug));
  const source = {
    path: resolved,
    name: nameFromRoot(resolved),
    slug: sourceSlug(resolved, used),
  };
  return {
    ...config,
    vaults: config.vaults.map((item) =>
      item.id === id ? { ...item, sources: [...(item.sources || []), source] } : item,
    ),
  };
}

export function addSources(config, id, sourcePaths) {
  let next = config;
  for (const path of sourcePaths || []) {
    if (typeof path !== 'string' || !path.startsWith('/')) continue;
    next = addSource(next, id, path);
  }
  return next;
}

export function removeSource(config, id, sourcePath) {
  const resolved = resolve(sourcePath);
  return {
    ...config,
    vaults: config.vaults.map((item) =>
      item.id === id
        ? { ...item, sources: (item.sources || []).filter((source) => source.path !== resolved) }
        : item,
    ),
  };
}

/**
 * Delete a managed library under knowledge-vaults/<id>/. Never touches the
 * shipped knowledge/ folder or the user's original materials.
 */
export async function destroyVaultLibrary(vault) {
  const root = resolve(vault.root);
  if (isShippedVault(root)) {
    const error = new Error('自带知识库不能删除');
    error.code = 'forbidden';
    throw error;
  }
  const home = resolve(VAULT_HOME);
  if (!isManagedVault(root)) {
    return { purged: false };
  }
  const leaf = root.slice(home.length + 1);
  if (!leaf || leaf.includes('/') || leaf !== vault.id) {
    const error = new Error('库路径与编号对不上，拒绝删除文件夹');
    error.code = 'forbidden';
    throw error;
  }
  const trash = join(home, '.trash');
  await mkdir(trash, { recursive: true });
  const dest = join(trash, `${leaf}-${Date.now().toString(36)}`);
  try {
    await rename(root, dest);
  } catch {
    await rm(root, { recursive: true, force: true });
    return { purged: true };
  }
  return { purged: true, trash: dest };
}

export async function unlinkSource(root, slug) {
  if (!slug || slug.includes('/') || slug === '.' || slug === '..') return;
  try {
    await unlink(join(resolve(root), 'sources', slug));
  } catch {
    // link may already be gone
  }
}
