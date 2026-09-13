/**
 * Wrap ctx.web.fetch. Does not register another fetch provider.
 */
import { remapBlockedUrl } from './fake-ip.js';

export const name = 'web-fetch-proxy';
export const inject = ['web'];

export function apply(ctx) {
  const orig = ctx.web.fetch.bind(ctx.web);
  ctx.web.fetch = async (request, signal) => {
    try {
      return await orig(request, signal);
    } catch (error) {
      throw await remapBlockedUrl(error, request);
    }
  };
}
