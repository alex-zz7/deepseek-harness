/**
 * Local git helpers for workspace reuse, the composer branch chip, and commit/push.
 *
 * Finder-launched apps inherit a bare PATH, so git is resolved the same way
 * `gh` is: Homebrew prefixes first, then the login-shell fallbacks.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';

const GIT_CANDIDATES = [
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
  '/opt/local/bin/git',
  join(homedir(), '.local/bin/git'),
  '/usr/bin/git',
];

const EXTRA_ROOTS = [
  join(homedir(), 'Desktop'),
  join(homedir(), 'Documents'),
  join(homedir(), 'projects'),
  join(homedir(), 'Projects'),
];

const PROJECTS_ROOTS = [join(homedir(), 'Projects'), join(homedir(), 'projects')];

function isProjectsClone(path) {
  return PROJECTS_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

let cachedGit;

/** @returns {Promise<string|undefined>} */
export async function resolveGit() {
  if (cachedGit !== undefined) return cachedGit || undefined;
  const { access } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  for (const path of GIT_CANDIDATES) {
    try {
      await access(path, constants.X_OK);
      cachedGit = path;
      return path;
    } catch {
      /* try the next one */
    }
  }
  cachedGit = '';
  return undefined;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<{ status: number, output: string, error: string }>}
 */
export async function runGit(cwd, args) {
  const git = await resolveGit();
  if (!git) {
    const err = new Error('没有找到 git');
    err.code = 'git-missing';
    throw err;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, {
      cwd,
      env: {
        ...process.env,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    let output = '';
    let error = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({ status: status ?? 1, output, error });
    });
  });
}

/** `owner/name` from a git remote URL, or empty. */
export function githubIdentityFromRemote(url) {
  const text = String(url ?? '').trim();
  if (!text) return '';
  const match = text.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?(?:[?#].*)?$/i);
  if (!match) return '';
  return `${match[1]}/${match[2]}`.toLowerCase();
}

/** @param {string} path */
async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** @param {string} path */
export async function githubIdentityAt(path) {
  if (!(await isDirectory(path))) return '';
  try {
    const root = await runGit(path, ['rev-parse', '--show-toplevel']);
    if (root.status !== 0) return '';
    const toplevel = (await realpath(root.output.trim())).replace(/\/+$/, '');
    const self = (await realpath(path)).replace(/\/+$/, '');
    if (toplevel !== self) return '';
    const result = await runGit(path, ['remote', '-v']);
    if (result.status !== 0) return '';
    for (const line of result.output.split('\n')) {
      const identity = githubIdentityFromRemote(line.split(/\s+/)[1] ?? '');
      if (identity) return identity;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Walk registered workspace paths plus common project roots for a checkout of
 * `owner/name`. Cursor-style: the folder that already tracks that remote wins
 * over a fresh clone into ~/Projects.
 * @param {string} owner
 * @param {string} name
 * @param {string[]} searchPaths
 * @returns {Promise<string|undefined>}
 */
export async function findExistingCheckout(owner, name, searchPaths = []) {
  const wanted = `${owner}/${name}`.toLowerCase();
  const index = await indexLocalGithubCheckouts(searchPaths);
  return index.get(wanted);
}

/**
 * @param {string[]} searchPaths
 * @returns {Promise<Map<string, string>>}
 */
export async function indexLocalGithubCheckouts(searchPaths = []) {
  const candidates = [];
  const seen = new Set();
  const add = async (raw) => {
    if (typeof raw !== 'string' || raw.length === 0) return;
    try {
      const resolved = await realpath(raw);
      if (seen.has(resolved)) return;
      seen.add(resolved);
      candidates.push(resolved);
    } catch {
      /* missing path */
    }
  };
  for (const path of searchPaths) await add(path);
  for (const root of EXTRA_ROOTS) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        await add(join(root, entry.name));
      }
    } catch {
      /* root missing */
    }
  }
  const map = new Map();
  const queue = candidates.slice();
  const workers = Array.from({ length: Math.min(8, Math.max(1, queue.length)) }, async () => {
    while (queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) return;
      const identity = await githubIdentityAt(path);
      if (!identity) continue;
      const current = map.get(identity);
      if (current === undefined || isProjectsClone(current) && !isProjectsClone(path)) {
        map.set(identity, path);
      }
    }
  });
  await Promise.all(workers);
  return map;
}

/**
 * @param {string} path
 * @returns {Promise<object>}
 */
export async function gitStatus(path) {
  if (!(await isDirectory(path))) {
    return { git: false };
  }
  const inside = await runGit(path, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.output.trim() !== 'true') {
    return { git: false };
  }
  const root = await runGit(path, ['rev-parse', '--show-toplevel']);
  if (root.status !== 0) return { git: false };
  try {
    const toplevel = (await realpath(root.output.trim())).replace(/\/+$/, '');
    const self = (await realpath(path)).replace(/\/+$/, '');
    if (toplevel !== self) return { git: false };
  } catch {
    return { git: false };
  }
  const [branchRun, headRun, porcelain, upstream, remotesRun, branchesRun, remoteRefsRun, defaultHead, numstatRun, untrackedRun] = await Promise.all([
    runGit(path, ['branch', '--show-current']),
    runGit(path, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(path, ['status', '--porcelain']),
    runGit(path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    runGit(path, ['remote', '-v']),
    runGit(path, ['for-each-ref', '--format=%(refname:short)|%(upstream:short)|%(HEAD)', 'refs/heads']),
    runGit(path, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    runGit(path, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']),
    runGit(path, ['diff', '--numstat', 'HEAD']),
    runGit(path, ['ls-files', '-o', '--exclude-standard']),
  ]);
  const branch = branchRun.output.trim();
  const detached = branch.length === 0 && headRun.output.trim() === 'HEAD';
  const lines = porcelain.output.split('\n').filter((line) => line.trim().length > 0);
  let staged = 0;
  let unstaged = 0;
  for (const line of lines) {
    const index = line[0] ?? ' ';
    const work = line[1] ?? ' ';
    if (index !== ' ' && index !== '?') staged += 1;
    if (work !== ' ') unstaged += 1;
  }
  let ahead = 0;
  let behind = 0;
  if (upstream.status === 0) {
    const [left, right] = upstream.output.trim().split(/\s+/);
    behind = Number(left) || 0;
    ahead = Number(right) || 0;
  }
  const remotes = [];
  const seenRemote = new Set();
  for (const line of remotesRun.output.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const key = `${parts[0]}:${parts[1]}`;
    if (seenRemote.has(key)) continue;
    seenRemote.add(key);
    remotes.push({
      name: parts[0],
      url: parts[1],
      identity: githubIdentityFromRemote(parts[1]),
    });
  }
  const branches = branchesRun.output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, upstreamName, head] = line.split('|');
      return {
        name,
        current: head === '*',
        upstream: upstreamName || undefined,
      };
    });
  const localNames = new Set(branches.map((row) => row.name));
  for (const ref of remoteRefsRun.output.split('\n').map((line) => line.trim()).filter(Boolean)) {
    // `origin/HEAD` shortens to `origin`; real remote branches always contain `/`.
    if (!ref.includes('/') || ref.endsWith('/HEAD')) continue;
    const short = ref.replace(/^[^/]+\//, '');
    if (!short || localNames.has(short) || localNames.has(ref)) continue;
    localNames.add(short);
    branches.push({
      name: ref,
      current: false,
      remote: true,
      local: short,
    });
  }
  const currentBranch = branch || (detached ? 'HEAD' : headRun.output.trim());
  const originHead = defaultHead.output.trim().replace(/^refs\/remotes\/origin\//, '');
  const defaultBranch = originHead || 'main';
  const diff = await collectDiffStats(path, porcelain.output, numstatRun.output, untrackedRun.output);
  return {
    git: true,
    path,
    branch: currentBranch,
    detached,
    dirty: lines.length > 0,
    staged,
    unstaged,
    ahead,
    behind,
    defaultBranch,
    isOnDefaultBranch: !detached && (currentBranch === defaultBranch || currentBranch === 'main' || currentBranch === 'master'),
    remotes,
    branches,
    additions: diff.additions,
    deletions: diff.deletions,
    files: diff.files,
  };
}

function parseNumstatPath(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (text.includes(' => ')) return text.split(' => ').pop().replace(/[{}]/g, '').trim();
  return text;
}

function porcelainStatus(code) {
  const index = code[0] ?? ' ';
  const work = code[1] ?? ' ';
  if (index === '?' || work === '?') return 'untracked';
  if (index === 'A' || work === 'A') return 'added';
  if (index === 'D' && work === 'D') return 'deleted';
  if (index === 'D' || work === 'D') return 'deleted';
  if (index === 'R' || work === 'R') return 'renamed';
  return 'modified';
}

async function countFileLines(absPath) {
  try {
    const buf = await readFile(absPath);
    if (buf.length > 512 * 1024 || buf.includes(0)) return 0;
    const text = buf.toString('utf8');
    if (!text) return 0;
    let lines = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '\n') lines += 1;
    }
    if (!text.endsWith('\n')) lines += 1;
    return lines;
  } catch {
    return 0;
  }
}

/**
 * Cursor `getAllChangesAgainstHeadStats`: `git diff --numstat HEAD`
 * plus line counts for untracked files.
 * @param {string} path
 * @param {string} porcelain
 * @param {string} numstat
 * @param {string} untracked
 */
async function collectDiffStats(path, porcelain, numstat, untracked) {
  const byPath = new Map();
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue;
    const status = porcelainStatus(line.slice(0, 2));
    const rest = line.slice(3);
    const filePath = rest.includes(' -> ') ? rest.split(' -> ').pop().trim() : rest.trim();
    if (!filePath) continue;
    byPath.set(filePath, { path: filePath, status, additions: 0, deletions: 0 });
  }
  for (const line of numstat.split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;
    const filePath = parseNumstatPath(match[3]);
    if (!filePath) continue;
    const additions = match[1] === '-' ? 0 : Number(match[1]) || 0;
    const deletions = match[2] === '-' ? 0 : Number(match[2]) || 0;
    const current = byPath.get(filePath) ?? { path: filePath, status: 'modified', additions: 0, deletions: 0 };
    current.additions = additions;
    current.deletions = deletions;
    byPath.set(filePath, current);
  }
  const extras = untracked.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 80);
  await Promise.all(extras.map(async (filePath) => {
    const additions = await countFileLines(join(path, filePath));
    const current = byPath.get(filePath) ?? { path: filePath, status: 'untracked', additions: 0, deletions: 0 };
    current.status = current.status || 'untracked';
    current.additions = additions;
    byPath.set(filePath, current);
  }));
  const files = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    additions: files.reduce((sum, row) => sum + (row.additions || 0), 0),
    deletions: files.reduce((sum, row) => sum + (row.deletions || 0), 0),
  };
}

/**
 * Cursor's `git-ref.ts` / glass branch-menu validator (`f8_`).
 * @param {string} name
 */
export function isValidGitBranchName(name) {
  const text = String(name ?? '');
  if (text.length === 0) return false;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  if (text.trim() !== text || text.startsWith('-') || text.startsWith('.') || text.startsWith('/')) {
    return false;
  }
  if (text === 'HEAD' || text === '@') return false;
  if (text.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock') || part.endsWith('.'))) {
    return false;
  }
  return [
    /[\s~^:?*\\]/,
    /\[/,
    /\.\./,
    /@\{/,
    /\/\//,
    /\/$/,
    /\.lock$/,
    /\.$/,
  ].every((pattern) => !pattern.test(text));
}

function gitError(message, code = 'git-failed') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Cursor Q2i: trim, drop empty / detached HEAD. */
function normalizeBranchName(name) {
  const text = String(name ?? '').trim();
  if (!text || text === 'HEAD') return '';
  if (text.startsWith('refs/heads/')) return text.slice('refs/heads/'.length);
  if (text.startsWith('heads/')) return text.slice('heads/'.length);
  if (text.startsWith('refs/remotes/')) return text.slice('refs/remotes/'.length);
  if (text.startsWith('remotes/')) return text.slice('remotes/'.length);
  return text;
}

async function gitRefExists(path, ref) {
  const result = await runGit(path, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  return result.status === 0;
}

/**
 * Cursor GitProvider checkout: local `git checkout <name>`, otherwise
 * `git checkout -b <name> origin/<name>` when only the remote exists.
 * @param {string} path
 * @param {string} branch
 */
export async function gitCheckout(path, branch) {
  const raw = normalizeBranchName(branch);
  if (!raw) throw gitError('invalid branch name', 'bad-request');

  if (await gitRefExists(path, `refs/heads/${raw}`)) {
    const result = await runGit(path, ['checkout', raw]);
    if (result.status !== 0) {
      throw gitError(result.error.trim() || result.output.trim() || 'checkout failed');
    }
    return gitStatus(path);
  }

  if (await gitRefExists(path, `refs/remotes/${raw}`)) {
    const localName = raw.replace(/^[^/]+\//, '');
    if (await gitRefExists(path, `refs/heads/${localName}`)) {
      const result = await runGit(path, ['checkout', localName]);
      if (result.status !== 0) {
        throw gitError(result.error.trim() || result.output.trim() || 'checkout failed');
      }
      return gitStatus(path);
    }
    const result = await runGit(path, ['checkout', '-b', localName, raw]);
    if (result.status !== 0) {
      throw gitError(result.error.trim() || result.output.trim() || 'checkout failed');
    }
    return gitStatus(path);
  }

  if (await gitRefExists(path, `refs/remotes/origin/${raw}`)) {
    const result = await runGit(path, ['checkout', '-b', raw, `origin/${raw}`]);
    if (result.status !== 0) {
      throw gitError(result.error.trim() || result.output.trim() || 'checkout failed');
    }
    return gitStatus(path);
  }

  throw gitError(`branch not found: ${raw}`, 'bad-request');
}

/**
 * Cursor GitProvider.createAndCheckoutBranch:
 * `git checkout -q -b <name> --no-track` from HEAD (optional startPoint).
 * @param {string} path
 * @param {string} name
 * @param {string} [startPoint]
 */
export async function gitCreateBranch(path, name, startPoint) {
  const safe = String(name ?? '').trim();
  if (!isValidGitBranchName(safe)) {
    throw gitError('Enter a valid Git branch name', 'bad-request');
  }
  const format = await runGit(path, ['check-ref-format', '--branch', safe]);
  if (format.status !== 0) {
    throw gitError('Enter a valid Git branch name', 'bad-request');
  }
  const args = ['checkout', '-q', '-b', safe, '--no-track'];
  const from = String(startPoint ?? '').trim();
  if (from) args.push(from);
  const result = await runGit(path, args);
  if (result.status !== 0) {
    const message = result.error.trim() || result.output.trim() || 'create branch failed';
    if (/already exists/i.test(message)) throw gitError(message, 'already-exists');
    throw gitError(message);
  }
  return gitStatus(path);
}

/**
 * @param {string} path
 * @param {string} message
 */
export async function gitCommit(path, message) {
  const text = String(message ?? '').trim();
  if (!text) {
    const err = new Error('commit message is required');
    err.code = 'bad-request';
    throw err;
  }
  const status = await gitStatus(path);
  if (!status.git) {
    const err = new Error('not a git repository');
    err.code = 'not-git';
    throw err;
  }
  if (status.staged === 0) {
    const add = await runGit(path, ['add', '-A']);
    if (add.status !== 0) {
      const err = new Error(add.error.trim() || 'git add failed');
      err.code = 'git-failed';
      throw err;
    }
  }
  const result = await runGit(path, ['commit', '-m', text]);
  if (result.status !== 0) {
    const err = new Error(result.error.trim() || result.output.trim() || 'commit failed');
    err.code = 'git-failed';
    throw err;
  }
  return { committed: true, output: result.output.trim(), status: await gitStatus(path) };
}

/**
 * @param {string} path
 */
export async function gitPush(path) {
  const status = await gitStatus(path);
  if (!status.git) {
    const err = new Error('not a git repository');
    err.code = 'not-git';
    throw err;
  }
  const current = status.branches.find((row) => row.current);
  const args = current?.upstream ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  const result = await runGit(path, args);
  if (result.status !== 0) {
    const err = new Error(result.error.trim() || result.output.trim() || 'push failed');
    err.code = 'git-failed';
    throw err;
  }
  return { pushed: true, output: result.output.trim(), status: await gitStatus(path) };
}

/**
 * Cursor default pill action: commit working tree, then push.
 * @param {string} path
 * @param {string} message
 */
export async function gitCommitAndPush(path, message) {
  const committed = await gitCommit(path, message);
  const pushed = await gitPush(path);
  return {
    committed: true,
    pushed: true,
    output: [committed.output, pushed.output].filter(Boolean).join('\n'),
    status: pushed.status,
  };
}

/**
 * Drop session ids from the global archive set so they reappear in the sidebar.
 * @param {object} registry
 * @param {string[]} sessionIds
 */
export async function unarchiveSessions(registry, sessionIds) {
  const wanted = new Set(sessionIds.filter((id) => typeof id === 'string' && id.length > 0));
  if (wanted.size === 0) return { removed: 0 };
  return registry.enqueueOperation(async () => {
    const state = registry.requireState();
    const next = state.archivedSessionIds.filter((id) => !wanted.has(String(id)));
    const removed = state.archivedSessionIds.length - next.length;
    if (removed === 0) return { removed: 0 };
    await registry.setState({
      ...state,
      archivedSessionIds: next,
    });
    return { removed };
  });
}
