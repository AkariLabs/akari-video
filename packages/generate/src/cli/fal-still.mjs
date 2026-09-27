import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { submit, pollStatus, fetchResponse, download } from './fal-queue.mjs';

export const FAL_STILL_MODEL = 'fal:gpt-image-2.5-flare';
const require = createRequire(import.meta.url);
const falPrice = require('../../../schemas/ai-models.json').models.find(model => model.id === FAL_STILL_MODEL)?.price;
if (falPrice?.unit !== 'usd_per_image' || !falPrice.by_quality_1024) throw new Error('fal 静止画の料金がカタログにありません');
export const FAL_STILL_AS_OF = falPrice.as_of;
export const FAL_STILL_PRICE = Object.freeze(falPrice.by_quality_1024);
const baseEndpoint = 'openai/gpt-image-2.5/flare/';
const sizes = Object.freeze({
  '16:9': 'landscape_16_9', '9:16': 'portrait_16_9', '1:1': 'square_hd',
  '4:3': 'landscape_4_3', '3:4': 'portrait_4_3',
  '4:5': { width: 1024, height: 1280 }, '3:2': { width: 1536, height: 1024 },
  '21:9': { width: 2016, height: 864 },
});

export function falStillEstimate(quality = 'high') {
  if (!(quality in FAL_STILL_PRICE)) throw new Error('品質が不正です');
  return { usd: FAL_STILL_PRICE[quality], asOf: FAL_STILL_AS_OF };
}

export function falStillRequest({ prompt, aspect, quality = 'high', referenceImages = [] }) {
  if (!sizes[aspect] || !prompt?.trim()) throw new Error('指示文か画角が不正です');
  falStillEstimate(quality);
  if (!Array.isArray(referenceImages) || referenceImages.length > 16) throw new Error('参照画像は 16 枚までです');
  return {
    endpoint: `${baseEndpoint}${referenceImages.length ? 'edit' : 'text-to-image'}`,
    body: { prompt: prompt.trim(), image_size: sizes[aspect], quality, num_images: 1,
      ...(referenceImages.length ? { image_urls: referenceImages } : {}) },
  };
}

/** AKARI_FAL_STUB_URL is a test-only loopback redirect for every fal queue and image request. */
export function falStillFetch({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const stub = env.AKARI_FAL_STUB_URL;
  if (!stub) return fetchImpl;
  const base = new URL(stub);
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
    throw new Error('AKARI_FAL_STUB_URL はローカル HTTP のみ指定できます');
  return (input, options) => {
    const original = new URL(String(input));
    if (original.hostname !== 'queue.fal.run' && original.origin !== base.origin)
      throw new Error('スタブ以外への fal 通信を拒否しました');
    const target = new URL(original.pathname + original.search, base);
    return fetchImpl(target, options);
  };
}

export async function generateFalStill({ prompt, aspect, quality = 'high', referencePaths = [], dest, key,
  env = process.env, fetchImpl = globalThis.fetch, pollIntervalMs = 5000 }) {
  if (!key) throw new Error('fal のキーがありません');
  const referenceImages = await Promise.all(referencePaths.map(async path => {
    const bytes = await readFile(path);
    const ext = path.toLowerCase().split('.').pop();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png',
      gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff' }[ext];
    if (!mime) throw new Error('参照画像の形式に対応していません');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }));
  const { endpoint, body } = falStillRequest({ prompt, aspect, quality, referenceImages });
  const fetch = falStillFetch({ fetchImpl, env });
  const started = Date.now();
  const job = await submit({ endpoint, body, key, fetchImpl: fetch });
  await pollStatus({ statusUrl: job.status_url, key, fetchImpl: fetch, intervalMs: pollIntervalMs });
  const response = await fetchResponse({ responseUrl: job.response_url, key, fetchImpl: fetch });
  const imageUrl = response.images?.[0]?.url;
  if (typeof imageUrl !== 'string') throw new Error('fal の応答に画像がありません');
  await download({ url: imageUrl, dest, fetchImpl: fetch });
  return { ok: true, elapsed_s: (Date.now() - started) / 1000, request_id: job.request_id,
    status_url: job.status_url, response_url: job.response_url };
}
