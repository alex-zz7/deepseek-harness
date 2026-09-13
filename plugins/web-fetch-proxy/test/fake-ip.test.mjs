import assert from 'node:assert/strict';
import { isFakeIpPlaceholder, isIpLiteral, remapBlockedUrl, FAKE_IP_CODE } from '../lib/fake-ip.js';

function blocked(message = 'URL hostname "example.com" resolves to a non-public IP address') {
  const error = new Error(message);
  error.code = 'WEB_BLOCKED_URL';
  return error;
}

assert.equal(isFakeIpPlaceholder('198.18.8.93'), true);
assert.equal(isFakeIpPlaceholder('198.19.1.2'), true);
assert.equal(isFakeIpPlaceholder('::ffff:198.18.8.93'), true);
assert.equal(isFakeIpPlaceholder('::ffff:0:c612:85d'), true);
assert.equal(isFakeIpPlaceholder('185.199.108.133'), false);
assert.equal(isFakeIpPlaceholder('127.0.0.1'), false);
assert.equal(isFakeIpPlaceholder('10.0.0.1'), false);
assert.equal(isFakeIpPlaceholder('192.168.1.1'), false);
assert.equal(isFakeIpPlaceholder('169.254.169.254'), false);
assert.equal(isFakeIpPlaceholder('::1'), false);
assert.equal(isIpLiteral('127.0.0.1'), true);
assert.equal(isIpLiteral('[::1]'), true);
assert.equal(isIpLiteral('raw.githubusercontent.com'), false);

const fake = await remapBlockedUrl(blocked(), { url: 'https://raw.githubusercontent.com/x' }, async () => [
  { address: '198.18.8.93', family: 4 },
]);
assert.equal(fake.code, FAKE_IP_CODE);
assert.match(fake.message, /NO_PROXY/);

const priv = await remapBlockedUrl(blocked(), { url: 'https://intranet.example/' }, async () => [
  { address: '10.0.0.1', family: 4 },
]);
assert.equal(priv.code, 'WEB_BLOCKED_URL');

const literal = await remapBlockedUrl(blocked(), { url: 'https://127.0.0.1/' }, async () => [
  { address: '198.18.8.93', family: 4 },
]);
assert.equal(literal.code, 'WEB_BLOCKED_URL');

const other = await remapBlockedUrl(Object.assign(new Error('nope'), { code: 'WEB_PROVIDER_ERROR' }), {
  url: 'https://example.com',
});
assert.equal(other.code, 'WEB_PROVIDER_ERROR');

console.log('fake-ip.test.mjs ok');
