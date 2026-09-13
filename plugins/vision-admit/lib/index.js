/**
 * Native image input for every selected model.
 *
 * Session admission and the OpenAI-compat adapter both key off declared
 * modalities. Third-party catalogs inherit `defaultInput: [text]`, so the
 * composer rejects paperclip/paste with MODEL_DOES_NOT_SUPPORT_IMAGES even
 * when the backend can see pixels.
 *
 * This plugin:
 *   1. Advertises `image` so the composer admits attachments.
 *   2. Writes `image` onto OpenAI-compat `defaultInput` so those backends
 *      receive the pixels in one request — no extra vision hop.
 *   3. For routes that still refuse images (official V4-Pro, a few GLM ids),
 *      replaces image blocks with a caption from official Flash.
 */
export const name = 'vision-admit';
export const inject = ['llm'];

const PI_AI_NS = 'llm-pi-ai';
const CAPTION_ROUTE = { provider: 'deepseek-official', model: 'deepseek-flash' };

/** OpenAI-compat ids that reject `image_url` (400: type must be text). */
const TEXT_ONLY_MODELS = new Set(['glm-5.1', 'glm-5.2', 'glm-5.3']);

const VISION_PROMPT = [
  'Inspect the image pixels and answer for another agent.',
  'Transcribe visible text. Report layout, people, UI state, errors, numbers, and labels.',
  'Do not invent details. Do not refuse. Match the language of the request when one is given.',
].join(' ');

function unique(values) {
  return [...new Set(values)];
}

function withImage(info) {
  const modalities = info.inputModalities ?? ['text'];
  if (modalities.includes('image')) return info;
  return { ...info, inputModalities: unique([...modalities, 'image']) };
}

function contentHasImage(blocks) {
  return blocks.some((block) => {
    if (block.type === 'image') return true;
    if (block.type === 'tool-result') return contentHasImage(block.content ?? []);
    return false;
  });
}

function requestText(blocks) {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function pluginUserMessage(content) {
  return {
    role: 'user',
    id: crypto.randomUUID(),
    content,
    source: { kind: 'plugin', plugin: name },
  };
}

async function collectText(stream) {
  let text = '';
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text;
    if (chunk.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
      throw new Error(chunk.reason.failure?.message ?? 'vision caption failed');
    }
  }
  if (text.trim().length === 0) throw new Error('vision caption was empty');
  return text.trim();
}

function captionFallback(attachment, error) {
  const lines = [
    '<img-caption>',
    `attachment_id: ${attachment.attachmentId}`,
    ...attachment.name ? [`original_name: ${attachment.name}`] : [],
    `media_type: ${attachment.mediaType}`,
    attachment.width && attachment.height ? `dimensions: ${attachment.width}x${attachment.height}` : '',
    `analysis_error: ${error}`,
    '</img-caption>',
  ].filter(Boolean);
  return lines.join('\n');
}

async function rewriteBlocks(blocks, analyze) {
  const next = [];
  for (const block of blocks) {
    if (block.type === 'image') {
      next.push({ type: 'text', text: await analyze(block.attachment, requestText(blocks)) });
      continue;
    }
    if (block.type === 'tool-result') {
      next.push({ ...block, content: await rewriteBlocks(block.content ?? [], analyze) });
      continue;
    }
    next.push(block);
  }
  return next;
}

async function rewriteMessages(messages, analyze) {
  const next = [];
  for (const message of messages) {
    if (!contentHasImage(message.content)) {
      next.push(message);
      continue;
    }
    next.push({ ...message, content: await rewriteBlocks(message.content, analyze) });
  }
  return next;
}

async function admitPiAiProviders(settings) {
  if (!settings?.writable) return;
  const descriptor = settings.describe({ redactSecrets: true }).find((item) => item.ns === PI_AI_NS);
  const providers = descriptor?.value?.providers;
  if (descriptor === undefined || providers === undefined || typeof providers !== 'object') return;
  const ops = [];
  for (const [id, profile] of Object.entries(providers)) {
    if (profile === null || typeof profile !== 'object') continue;
    const defaultInput = Array.isArray(profile.defaultInput) ? profile.defaultInput : ['text'];
    if (!defaultInput.includes('image')) {
      ops.push({ op: 'set', path: ['providers', id, 'defaultInput'], value: unique([...defaultInput, 'image']) });
    }
    const models = Array.isArray(profile.models) ? profile.models : [];
    models.forEach((model, index) => {
      if (model === null || typeof model !== 'object' || typeof model.id !== 'string') return;
      if (TEXT_ONLY_MODELS.has(model.id)) {
        const input = Array.isArray(model.input) ? model.input : [];
        if (input.length === 0 || input.includes('image')) {
          ops.push({ op: 'set', path: ['providers', id, 'models', index, 'input'], value: ['text'] });
        }
        return;
      }
      if (Array.isArray(model.input) && model.input.length > 0 && !model.input.includes('image')) {
        ops.push({ op: 'set', path: ['providers', id, 'models', index, 'input'], value: unique([...model.input, 'image']) });
      }
    });
  }
  if (ops.length === 0) return;
  await settings.mutate(PI_AI_NS, ops, descriptor.revision);
}

export function apply(ctx) {
  const originalResolve = ctx.llm.resolveModelInfo.bind(ctx.llm);
  const originalList = ctx.llm.listModels.bind(ctx.llm);
  const originalStream = ctx.llm.stream.bind(ctx.llm);

  ctx.llm.resolveModelInfo = async (provider, model, signal) => withImage(await originalResolve(provider, model, signal));
  ctx.llm.listModels = async (provider) => (await originalList(provider)).map(withImage);

  ctx.llm.stream = async function* (options) {
    const hasImage = options.messages.some((message) => contentHasImage(message.content));
    if (!hasImage) {
      yield* originalStream(options);
      return;
    }
    let native;
    try {
      native = await originalResolve(options.provider, options.model, options.signal);
    } catch {
      native = undefined;
    }
    if (native?.inputModalities?.includes('image')) {
      yield* originalStream(options);
      return;
    }
    const analyze = async (attachment, nearby) => {
      try {
        const prompt = nearby.length > 0 ? `${VISION_PROMPT}\n\nRequest: ${nearby}` : VISION_PROMPT;
        return await collectText(originalStream({
          provider: CAPTION_ROUTE.provider,
          model: CAPTION_ROUTE.model,
          messages: [pluginUserMessage([
            { type: 'text', text: prompt },
            { type: 'image', attachment },
          ])],
          ...options.signal === undefined ? {} : { signal: options.signal },
        }));
      } catch (error) {
        return captionFallback(attachment, String(error?.message ?? error));
      }
    };
    yield* originalStream({
      ...options,
      messages: await rewriteMessages(options.messages, analyze),
    });
  };

  ctx.inject(['settings'], (sctx) => {
    const mark = () => admitPiAiProviders(sctx.settings).catch((error) => {
      sctx.logger?.warn?.(`vision-admit: could not mark OpenAI-compat models as image-capable: ${String(error?.message ?? error)}`);
    });
    mark();
    const timer = setTimeout(mark, 1500);
    sctx.effect(() => () => clearTimeout(timer), 'vision-admit: delayed catalog mark');
  });
}
