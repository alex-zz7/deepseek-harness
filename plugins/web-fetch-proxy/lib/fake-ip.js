import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Clash / Surge / sing-box / Loon / MacPacket fake-IP pool (RFC 2544). */
const FAKE_IP_FIRST = 198;
const FAKE_IP_SECOND_MIN = 18;
const FAKE_IP_SECOND_MAX = 19;

export const FAKE_IP_CODE = 'WEB_PROXY_FAKE_IP';

export const FAKE_IP_HINT = [
  '本机 DNS 返回的是代理客户端的 fake-IP 占位地址（198.18.0.0/15），不是公网地址。',
  'dsh web_fetch 在直连前会拒绝这类地址。',
  '',
  '修法（二选一）：',
  '1. 在 ~/.dsh/.env 写上本地 HTTP 代理，然后重启 dsh web：',
  '   HTTPS_PROXY=http://127.0.0.1:<端口>',
  '   HTTP_PROXY=http://127.0.0.1:<端口>',
  '2. 关掉代理客户端的 fake-IP / TUN 增强模式，改用系统 HTTP 代理。',
  '',
  '不要把 198.18.0.0/15 加进 NO_PROXY：加了会重新走本机解析，故障复现。',
].join('\n');

export function isFakeIpPlaceholder(address) {
  const text = String(address).replace(/^\[|\]$/g, '');
  if (text.includes(':')) {
    const mapped = text.toLowerCase();
    const dotted = mapped.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isFakeIpPlaceholder(dotted[1]);
    const hex = mapped.match(/^::ffff:(?:0:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = Number.parseInt(hex[1], 16);
      const lo = Number.parseInt(hex[2], 16);
      return isFakeIpPlaceholder(`${hi >>> 8}.${hi & 255}.${lo >>> 8}.${lo & 255}`);
    }
    return false;
  }
  const parts = text.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  return parts[0] === FAKE_IP_FIRST && parts[1] >= FAKE_IP_SECOND_MIN && parts[1] <= FAKE_IP_SECOND_MAX;
}

export function isIpLiteral(hostname) {
  return isIP(String(hostname).replace(/^\[|\]$/g, '')) !== 0;
}

export function codedError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.name = 'WebError';
  return error;
}

export function fakeIpError(hostname, addresses) {
  return codedError(
    `URL hostname "${hostname}" resolves to a proxy fake-IP (${addresses.join(', ')}).\n${FAKE_IP_HINT}`,
    FAKE_IP_CODE,
  );
}

/**
 * After the official provider throws WEB_BLOCKED_URL, reclassify only the
 * proxy placeholder range. Literals and other reserved/private answers stay
 * WEB_BLOCKED_URL. Never treats 198.18/15 as public.
 */
export async function remapBlockedUrl(error, request, resolver = lookup) {
  if (!error || error.code !== 'WEB_BLOCKED_URL') return error;
  let url;
  try {
    url = new URL(request?.url);
  } catch {
    return error;
  }
  if (isIpLiteral(url.hostname)) return error;
  let answers;
  try {
    answers = await resolver(url.hostname, { all: true, order: 'verbatim' });
  } catch {
    return error;
  }
  const addrs = (Array.isArray(answers) ? answers : []).map((row) => row.address);
  if (addrs.some(isFakeIpPlaceholder)) return fakeIpError(url.hostname, addrs);
  return error;
}
