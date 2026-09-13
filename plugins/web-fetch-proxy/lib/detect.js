import { spawnSync } from 'node:child_process';
import net from 'node:net';

export const DETECT_PORTS = [7890, 7891, 7897, 7899, 1080, 1082, 6152, 8888];
const CONNECT_MS = 80;
const TOTAL_MS = 300;

const PROXY_ENV_NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

export function proxyEnvAlreadySet(env = process.env) {
  return PROXY_ENV_NAMES.some((name) => String(env[name] || '').trim());
}

export function autodetectDisabled(env = process.env) {
  const raw = String(env.DSH_PROXY_AUTODETECT || '').trim().toLowerCase();
  return raw === '0' || raw === 'false' || raw === 'off';
}

export function isLoopbackHost(host) {
  const value = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1';
}

export function parseScutilProxy(text) {
  const get = (key) => {
    const match = String(text).match(new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(\\S+)`, 'i'));
    return match?.[1];
  };
  for (const [enable, hostKey, portKey] of [
    ['HTTPSEnable', 'HTTPSProxy', 'HTTPSPort'],
    ['HTTPEnable', 'HTTPProxy', 'HTTPPort'],
  ]) {
    if (get(enable) !== '1') continue;
    const host = get(hostKey);
    const port = Number(get(portKey));
    if (isLoopbackHost(host) && Number.isInteger(port) && port > 0 && port < 65536) {
      return { host: host === 'localhost' || host === '::1' ? '127.0.0.1' : host, port };
    }
  }
  return null;
}

export function probePort(port, host = '127.0.0.1', timeoutMs = CONNECT_MS) {
  return new Promise((ok) => {
    const socket = net.connect({ host, port, timeout: timeoutMs }, () => {
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

export async function detectLocalProxy(opts = {}) {
  const env = opts.env ?? process.env;
  if (autodetectDisabled(env) || proxyEnvAlreadySet(env)) return null;
  const started = Date.now();
  const budget = opts.budgetMs ?? TOTAL_MS;

  if (process.platform === 'darwin' && opts.skipScutil !== true) {
    try {
      const out = spawnSync('/usr/sbin/scutil', ['--proxy'], {
        encoding: 'utf8',
        timeout: Math.min(150, budget),
      });
      const parsed = parseScutilProxy(out.stdout || '');
      if (parsed && (await probePort(parsed.port, parsed.host, 80))) {
        return { ...parsed, source: 'scutil' };
      }
    } catch {
      // scutil missing or timed out — fall through to port probe
    }
  }

  const remaining = Math.max(40, budget - (Date.now() - started));
  const per = Math.min(CONNECT_MS, remaining);
  const ports = opts.ports ?? DETECT_PORTS;
  const probes = ports.map((port) => probePort(port, '127.0.0.1', per).then((ok) => (ok ? port : 0)));
  const raced = Promise.race([
    Promise.all(probes),
    new Promise((resolve) => setTimeout(() => resolve(ports.map(() => 0)), remaining)),
  ]);
  const results = await raced;
  const port = results.find(Boolean);
  if (!port) return null;
  return { host: '127.0.0.1', port, source: 'listen' };
}

export function proxyUrlFor(found) {
  return `http://${found.host}:${found.port}`;
}

/** Set process.env only. The dsh launcher installs the policy from these names. */
export function applyDetectedEnv(found, env = process.env) {
  const url = proxyUrlFor(found);
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    if (!String(env[name] || '').trim()) env[name] = url;
  }
  return url;
}

let logged = false;

export function logDetected(found) {
  if (logged) return;
  logged = true;
  console.log(`detected local proxy at ${found.host}:${found.port}, routing harness egress through it`);
}
