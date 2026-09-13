/**
 * GitHub / local-folder helpers for the Cursor-style workspace menu.
 *
 * `gh` is resolved the same way the native picker did: Finder-launched apps
 * inherit a bare PATH, so Homebrew's binary would be invisible without this.
 */
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { findExistingCheckout, indexLocalGithubCheckouts } from './git.js';

const PROJECTS_ROOT = join(homedir(), 'Projects');

const GH_CANDIDATES = [
  '/opt/homebrew/bin/gh',
  '/usr/local/bin/gh',
  '/opt/local/bin/gh',
  join(homedir(), '.local/bin/gh'),
  '/usr/bin/gh',
];

let cachedGh;

/** @returns {Promise<string|undefined>} */
export async function resolveGh() {
  if (cachedGh !== undefined) return cachedGh || undefined;
  const { access } = await import('node:fs/promises');
  const { constants } = await import('node:fs');
  for (const path of GH_CANDIDATES) {
    try {
      await access(path, constants.X_OK);
      cachedGh = path;
      return path;
    } catch {
      /* try the next one */
    }
  }
  cachedGh = '';
  return undefined;
}

/**
 * @param {string[]} args
 * @returns {Promise<{ status: number, output: string, error: string }>}
 */
export function runGh(args, ghPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ghPath, args, {
      env: {
        ...process.env,
        PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
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

/**
 * @param {string[]} [searchPaths]
 * @returns {Promise<{ owner: string, name: string, isPrivate: boolean, localPath: string|null }[]>}
 */
export async function listGithubRepos(searchPaths = []) {
  const gh = await resolveGh();
  if (!gh) {
    const err = new Error('没有找到 GitHub CLI。装一个：brew install gh，然后 gh auth login');
    err.code = 'gh-missing';
    throw err;
  }
  const result = await runGh(
    ['repo', 'list', '--limit', '200', '--json', 'nameWithOwner,name,isPrivate'],
    gh,
  );
  if (result.status !== 0) {
    const detail = result.error.trim() || 'gh 返回了错误';
    const err = new Error(`读取 GitHub 失败：${detail}`);
    err.code = 'gh-failed';
    throw err;
  }
  const list = JSON.parse(result.output || '[]');
  const local = await indexLocalGithubCheckouts(searchPaths);
  return list.flatMap((entry) => {
    const full = typeof entry.nameWithOwner === 'string' ? entry.nameWithOwner : '';
    const parts = full.split('/');
    if (parts.length !== 2) return [];
    const owner = parts[0];
    const name = parts[1];
    return [
      {
        owner,
        name,
        isPrivate: Boolean(entry.isPrivate),
        localPath: local.get(`${owner}/${name}`.toLowerCase()) ?? null,
      },
    ];
  });
}

/**
 * Open `owner/name`. Prefer an existing local checkout (registered workspace
 * or a folder under Desktop / Documents / Projects that already tracks that
 * remote). Only clone into ~/Projects/<name> when nothing matches.
 * @param {string} owner
 * @param {string} name
 * @param {{ searchPaths?: string[] }} [options]
 * @returns {Promise<{ path: string, cloned: boolean }>}
 */
export async function cloneGithubRepo(owner, name, options = {}) {
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) {
    const err = new Error('invalid repository identity');
    err.code = 'bad-request';
    throw err;
  }
  const gh = await resolveGh();
  if (!gh) {
    const err = new Error('没有找到 GitHub CLI。装一个：brew install gh');
    err.code = 'gh-missing';
    throw err;
  }
  const existing = await findExistingCheckout(owner, name, options.searchPaths ?? []);
  if (existing) return { path: existing, cloned: false };
  await mkdir(PROJECTS_ROOT, { recursive: true });
  const target = join(PROJECTS_ROOT, name);
  try {
    const info = await stat(target);
    if (info.isDirectory()) return { path: target, cloned: false };
  } catch {
    /* missing — clone into it */
  }
  const result = await runGh(['repo', 'clone', `${owner}/${name}`, target], gh);
  if (result.status !== 0) {
    const detail = [result.error, result.output].map((s) => s.trim()).find(Boolean) || 'gh 返回了错误';
    const err = new Error(`克隆失败：${detail}`);
    err.code = 'clone-failed';
    throw err;
  }
  return { path: target, cloned: true };
}

/** @returns {Promise<{ name: string, path: string }[]>} */
export async function listLocalFolders() {
  try {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
    const folders = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      folders.push({ name: entry.name, path: join(PROJECTS_ROOT, entry.name) });
    }
    folders.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return folders;
  } catch {
    return [];
  }
}

/**
 * Create `~/Projects/<name>` (or a dated fallback).
 * @returns {Promise<{ path: string, name: string }>}
 */
export async function createLocalFolder(requested) {
  const safe = (requested ?? '').trim().replace(/[\\/]/g, '');
  const name = safe || `project-${yyyymmdd()}`;
  if (name === '.' || name === '..') {
    const err = new Error('invalid folder name');
    err.code = 'bad-request';
    throw err;
  }
  const target = join(PROJECTS_ROOT, name);
  await mkdir(target, { recursive: true });
  return { path: target, name };
}

function yyyymmdd() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}${m}${d}`;
}
