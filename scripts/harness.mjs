#!/usr/bin/env node
/**
 * Cross-platform setup + launcher for DeepSeek Harness.
 *
 * Mac and Windows both run the same `dsh web` UI in a browser.
 * The native .app under mac/ is optional and Mac-only.
 *
 *   node scripts/harness.mjs setup
 *   node scripts/harness.mjs start
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const URL_FILE = join(homedir(), '.dsh', 'web-url');
const URL_RE = /^http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~-]+$/;

const PLUGINS = [
  'plugins/workspace-fork',
  'plugins/conversation-fork',
  'plugins/model-select-fork',
  'plugins/agent-preset-fork',
  'plugins/sidebar-editor',
  'plugins/global-skills',
  'plugins/knowledge-studio',
];

function resolveDsh() {
  const explicit = process.env.DSH_BIN;
  if (explicit && existsSync(explicit)) return { cmd: explicit, prefix: [] };
  const finder = WIN ? 'where' : 'which';
  const found = spawnSync(finder, ['dsh'], { encoding: 'utf8', shell: WIN });
  const line = (found.stdout || '').trim().split(/\r?\n/).find(Boolean);
  if (found.status === 0 && line && existsSync(line)) return { cmd: line, prefix: [] };
  return { cmd: WIN ? 'npx.cmd' : 'npx', prefix: ['--yes', '@deepseek-ai/dsh'] };
}

function runDsh(args, opts = {}) {
  const { cmd, prefix } = resolveDsh();
  const all = [...prefix, ...args];
  const result = spawnSync(cmd, all, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: WIN,
    stdio: opts.stdio || 'pipe',
    env: process.env,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    cmd,
    all,
  };
}

function spawnDsh(args) {
  const { cmd, prefix } = resolveDsh();
  return spawn(cmd, [...prefix, ...args], {
    cwd: ROOT,
    shell: WIN,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
}

function probe(port) {
  return new Promise((ok) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 400 }, () => {
      socket.destroy();
      ok(true);
    });
    socket.on('error', () => ok(false));
    socket.on('timeout', () => {
      socket.destroy();
      ok(false);
    });
  });
}

function readPublishedUrl() {
  try {
    const url = readFileSync(URL_FILE, 'utf8').trim().split(/\r?\n/)[0];
    return URL_RE.test(url) ? url : '';
  } catch {
    return '';
  }
}

function publishUrl(url) {
  mkdirSync(dirname(URL_FILE), { recursive: true });
  writeFileSync(URL_FILE, `${url}\n`);
}

function portOf(url) {
  const match = url.match(/^http:\/\/127\.0\.0\.1:(\d+)\//);
  return match ? Number(match[1]) : 0;
}

function openBrowser(url) {
  if (WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

function setup() {
  console.log('Installing local plugins into the dsh web profile…');
  for (const rel of PLUGINS) {
    const abs = resolve(ROOT, rel);
    if (!existsSync(join(abs, 'package.json'))) {
      console.warn(`  skip missing ${rel}`);
      continue;
    }
    const result = runDsh(['plugin', '--profile', 'web', 'add', abs]);
    const text = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || /already|exists|link:/i.test(text)) {
      console.log(`  ok  ${rel}`);
    } else {
      console.error(`  fail ${rel}`);
      console.error(text.trim() || `exit ${result.status}`);
      process.exit(result.status || 1);
    }
  }
  console.log('Plugins ready.');
}

async function start({ open = true, forceNew = false } = {}) {
  setup();
  if (!forceNew) {
    const existing = readPublishedUrl();
    if (existing && (await probe(portOf(existing)))) {
      console.log(`reusing ${existing.replace(/\?token=.*/, '?token=…')}`);
      if (open) openBrowser(existing);
      return;
    }
  }

  console.log('starting dsh web…');
  const child = spawnDsh(['web', '--no-open', '--port', '0']);
  let opened = false;
  const consider = (chunk) => {
    const text = String(chunk);
    process.stdout.write(text);
    if (opened) return;
    const match = text.match(/https?:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9._~-]+/);
    if (!match) return;
    opened = true;
    publishUrl(match[0]);
    console.log(`ready ${match[0].replace(/\?token=.*/, '?token=…')}`);
    if (open) openBrowser(match[0]);
  };
  child.stdout.on('data', consider);
  child.stderr.on('data', consider);
  child.on('error', (error) => {
    console.error(error.message || error);
    process.exit(1);
  });
  const stop = () => {
    if (!child.killed) child.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

const args = process.argv.slice(2);
const cmd = args[0] || 'start';
const flags = new Set(args.slice(1));
if (cmd === 'setup') setup();
else if (cmd === 'start') {
  start({
    open: !flags.has('--no-open'),
    forceNew: flags.has('--new'),
  });
} else {
  console.error('usage: node scripts/harness.mjs <setup|start> [--new] [--no-open]');
  process.exit(2);
}
