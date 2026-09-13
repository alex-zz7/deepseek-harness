/**
 * Wrap ctx.web.fetch and, when no proxy env is set, install a loopback HTTP
 * proxy the user already has running. Does not register another fetch provider.
 */
import { applyDetectedEnv, detectLocalProxy, logDetected } from './detect.js';
import { remapBlockedUrl } from './fake-ip.js';

export const name = 'web-fetch-proxy';
export const inject = ['web'];

async function installDetectedProxy() {
  try {
    const found = await detectLocalProxy();
    if (!found) return null;
    applyDetectedEnv(found);
    const [{ createLaunchEnvironmentSnapshot }, { installProxyFromEnvironment }] = await Promise.all([
      import('@deepseek-ai/dsh-launch-environment'),
      import('@deepseek-ai/dsh-http-proxy'),
    ]);
    const env = createLaunchEnvironmentSnapshot([{ source: 'process', values: process.env }]);
    await installProxyFromEnvironment(env, () => {});
    logDetected(found);
    return found;
  } catch {
    return null;
  }
}

export function apply(ctx) {
  const ready = installDetectedProxy();
  const orig = ctx.web.fetch.bind(ctx.web);
  ctx.web.fetch = async (request, signal) => {
    await ready;
    try {
      return await orig(request, signal);
    } catch (error) {
      throw await remapBlockedUrl(error, request);
    }
  };
}
