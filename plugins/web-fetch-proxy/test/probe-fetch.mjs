/**
 * Drive the real web-fetch-http provider, then our remap wrapper.
 *
 *   node plugins/web-fetch-proxy/test/probe-fetch.mjs
 *   HTTPS_PROXY=http://127.0.0.1:1082 node plugins/web-fetch-proxy/test/probe-fetch.mjs --live
 */
import { createRequire } from 'node:module';
import { remapBlockedUrl, FAKE_IP_CODE } from '../lib/fake-ip.js';

const require = createRequire(import.meta.url);
const candidates = [
  `${process.env.HOME}/.dsh/profiles/node_modules/@deepseek-ai`,
  `${process.env.HOME}/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai`,
];

function resolveAi() {
  for (const root of candidates) {
    try {
      require.resolve(`${root}/cordis/lib/index.js`);
      return root;
    } catch {
      // try next
    }
  }
  throw new Error('cannot find @deepseek-ai/cordis; run this on a machine with dsh installed');
}

const NM = resolveAi();
const url =
  process.argv.find((arg) => arg.startsWith('http')) ??
  'https://raw.githubusercontent.com/peter123023/awesome-free-llm-api/main/README.md';
const live = process.argv.includes('--live');

const { Context } = await import(`${NM}/cordis/lib/index.js`);
const webMod = await import(`${NM}/dsh-web/lib/index.js`);
const fetchMod = await import(`${NM}/dsh-web-fetch-http/lib/index.js`);
const proxyMod = await import(`${NM}/dsh-http-proxy/lib/index.js`);
const launchMod = await import(`${NM}/dsh-launch-environment/lib/index.js`);
const { apply } = await import('../lib/index.js');

const WebRuntime = webMod.default ?? webMod.WebRuntime;

async function boot({ wrap, proxyEnv }) {
  if (proxyEnv) {
    process.env.HTTPS_PROXY = proxyEnv;
    process.env.HTTP_PROXY = proxyEnv;
    const env = launchMod.createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
    await proxyMod.installProxyFromEnvironment(env, () => {});
  }
  const ctx = new Context();
  ctx.plugin(WebRuntime);
  ctx.plugin({ name: fetchMod.name, inject: fetchMod.inject, apply: fetchMod.apply }, new fetchMod.Config({}));
  if (wrap) ctx.plugin({ name: 'web-fetch-proxy', inject: ['web'], apply });
  await new Promise((resolve) => setTimeout(resolve, 200));
  return ctx;
}

function report(label, err, result) {
  if (err) {
    console.log(`[${label}] FAIL code=${err.code ?? '?'} message=${String(err.message).split('\n')[0]}`);
    return err.code;
  }
  const text = result.body?.content ?? result.body?.text ?? '';
  console.log(`[${label}] OK status=${result.statusCode} chars=${String(text).length}`);
  return 'OK';
}

const ssrf = ['https://127.0.0.1/', 'https://10.0.0.1/', 'https://192.168.1.1/', 'https://169.254.169.254/', 'https://[::1]/'];

if (!live) {
  const bare = await boot({ wrap: false });
  let before;
  try {
    before = report('before-wrap', null, await bare.web.fetch({ url }));
  } catch (err) {
    before = report('before-wrap', err);
  }

  const wrapped = await boot({ wrap: true });
  let after;
  try {
    after = report('after-wrap', null, await wrapped.web.fetch({ url }));
  } catch (err) {
    after = report('after-wrap', err);
  }

  for (const blocked of ssrf) {
    try {
      await wrapped.web.fetch({ url: blocked });
      console.log(`[ssrf] FAIL leaked ${blocked}`);
      process.exit(1);
    } catch (err) {
      if (err.code !== 'WEB_BLOCKED_URL' && err.code !== 'WEB_INVALID_URL') {
        console.log(`[ssrf] FAIL ${blocked} code=${err.code}`);
        process.exit(1);
      }
      console.log(`[ssrf] ok ${blocked} code=${err.code}`);
    }
  }

  const remapped = await remapBlockedUrl(
    Object.assign(new Error('URL hostname "raw.githubusercontent.com" resolves to a non-public IP address'), {
      code: 'WEB_BLOCKED_URL',
    }),
    { url },
    async () => [{ address: '198.18.8.93', family: 4 }],
  );
  console.log(`[remap-mock] code=${remapped.code}`);
  if (remapped.code !== FAKE_IP_CODE) process.exit(1);
  if (before === 'WEB_BLOCKED_URL' && after !== FAKE_IP_CODE && after !== 'OK') {
    console.log('expected after-wrap to be WEB_PROXY_FAKE_IP when DNS is fake-IP');
    process.exit(1);
  }
  process.exit(0);
}

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (!proxy) {
  console.error('--live needs HTTPS_PROXY');
  process.exit(2);
}
const ctx = await boot({ wrap: true, proxyEnv: proxy });
const urls = [
  url,
  'https://example.com/',
  'https://docs.devin.ai/zh/desktop/models',
];
for (const target of urls) {
  try {
    report(target, null, await ctx.web.fetch({ url: target }));
  } catch (err) {
    report(target, err);
    process.exit(1);
  }
}
