/**
 * Vault walking rules shared by the index builder, the MCP server, and status
 * reporting.
 */

import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { isIndexableName } from './extract.mjs';

/** Directories that must never be indexed. */
const SKIP_DIRS = new Set([
  '.kb',
  '.git',
  '.obsidian',
  'node_modules',
  '.model-cache',
  '.npm-cache',
  '.npm-logs',
]);

/**
 * Recursively collect every indexable file under `root`, as paths relative to
 * `root`, in stable sorted order. Markdown, PDF, Office, HTML, and similar
 * document types are included; binaries and hidden dirs are not.
 *
 * Directory symlinks (the `sources/<slug>` attachments) are followed. A
 * `seen` set of real paths stops cycles if two links point at the same tree.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function walkMarkdown(root, dir = '', seen = new Set()) {
  const out = [];
  const absDir = path.join(root, dir);
  let real;
  try {
    real = await realpath(absDir);
  } catch {
    return out;
  }
  if (seen.has(real)) return out;
  seen.add(real);

  let entries = [];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    const abs = path.join(root, rel);
    if (e.isSymbolicLink()) {
      try {
        const info = await stat(abs);
        if (info.isDirectory()) out.push(...(await walkMarkdown(root, rel, seen)));
        else if (info.isFile() && isIndexableName(e.name)) out.push(rel);
      } catch {
        // dangling link
      }
    } else if (e.isDirectory()) {
      out.push(...(await walkMarkdown(root, rel, seen)));
    } else if (e.isFile() && isIndexableName(e.name)) {
      out.push(rel);
    }
  }
  return dir ? out : out.sort();
}

/** Bucket a vault-relative path into a coarse kind for filtering and stats. */
export function classify(rel) {
  if (rel.startsWith('skills/vault/')) return 'skill';
  if (rel.startsWith('skills/')) return 'skill-index';
  if (rel.startsWith('github/')) return 'github';
  if (rel.startsWith('docs/') || rel.startsWith('sources/')) return 'doc';
  return 'root';
}

/** Skill name for a vault path, or undefined outside skills/vault. */
export function skillName(rel) {
  const m = rel.match(/^skills\/vault\/[^/]+\/([^/]+)\//);
  return m?.[1];
}
