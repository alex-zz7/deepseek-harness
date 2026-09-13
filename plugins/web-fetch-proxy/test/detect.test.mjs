import assert from 'node:assert/strict';
import net from 'node:net';
import {
  applyDetectedEnv,
  autodetectDisabled,
  detectLocalProxy,
  parseScutilProxy,
  proxyEnvAlreadySet,
  probePort,
} from '../lib/detect.js';

assert.equal(autodetectDisabled({ DSH_PROXY_AUTODETECT: '0' }), true);
assert.equal(autodetectDisabled({ DSH_PROXY_AUTODETECT: 'false' }), true);
assert.equal(autodetectDisabled({}), false);
assert.equal(proxyEnvAlreadySet({ HTTPS_PROXY: 'http://127.0.0.1:1082' }), true);
assert.equal(proxyEnvAlreadySet({}), false);

const fixture = `
HTTPEnable : 1
HTTPProxy : 127.0.0.1
HTTPPort : 1082
HTTPSEnable : 1
HTTPSProxy : 127.0.0.1
HTTPSPort : 1082
SOCKSEnable : 1
SOCKSProxy : 127.0.0.1
SOCKSPort : 1080
`;
assert.deepEqual(parseScutilProxy(fixture), { host: '127.0.0.1', port: 1082 });
assert.equal(parseScutilProxy('HTTPEnable : 1\nHTTPProxy : 10.0.0.8\nHTTPPort : 8080'), null);

const skipped = await detectLocalProxy({ env: { DSH_PROXY_AUTODETECT: '0' } });
assert.equal(skipped, null);
const already = await detectLocalProxy({ env: { HTTPS_PROXY: 'http://127.0.0.1:9' } });
assert.equal(already, null);

const server = net.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert.equal(await probePort(port, '127.0.0.1', 80), true);
assert.equal(await probePort(1, '127.0.0.1', 40), false);
const found = await detectLocalProxy({
  env: {},
  skipScutil: true,
  ports: [port],
  budgetMs: 200,
});
assert.equal(found?.port, port);
assert.equal(found?.host, '127.0.0.1');
const env = {};
applyDetectedEnv(found, env);
assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${port}`);
server.close();

const started = Date.now();
const miss = await detectLocalProxy({
  env: {},
  skipScutil: true,
  ports: [1, 2, 3],
  budgetMs: 200,
});
const elapsed = Date.now() - started;
assert.equal(miss, null);
assert.ok(elapsed <= 350, `detect took ${elapsed}ms`);

console.log('detect.test.mjs ok');
