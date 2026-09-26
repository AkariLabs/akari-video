import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './cli/catalog.mjs';
import { FAL_TTS_ENGINES, DIRECT_TTS_ENGINES } from '../../akari-launcher/src/tts-engines.mjs';

const defaultRoot = fileURLToPath(new URL('../../..', import.meta.url));
const inputSlots = Object.freeze({ prompt: null, first_frame: null, last_frame: null,
  reference_images: null, reference_videos: null, reference_audios: null,
  source_video: null, negative_prompt: null, camera: null });

function fromGeneration(source) {
  return {
    kind: source.kind, name: source.family, family: source.family,
    via: source.provider === 'codex' ? 'subscription' : 'api', provider: source.provider,
    inputs: source.inputs, outputs: {
      aspects: source.aspects, aspect_mode: source.aspects ? 'param' : source.kind === 'image' ? 'prompt' : 'source',
      resolutions: source.resolutions ?? null, duration: source.duration ?? null, audio_out: source.audio_out ?? null,
      seed: source.seed ?? null
    },
    price: source.price && { ...source.price, as_of: source.price.as_of ?? source.as_of,
      source_url: source.price.source_url ?? source.price_url ?? null },
    as_of: source.as_of
  };
}

function fromTts(source) {
  return {
    kind: 'voice', name: source.label, family: source.label, via: source.place === 'cloud' ? 'api' : 'local',
    provider: source.provider, inputs: { text: true, style: source.supports.style,
      voice_clone: source.supports.clone, reference_audio: source.supports.clone === 'per-request', speed: source.supports.speed },
    outputs: { aspects: null, aspect_mode: null, resolutions: null, duration: null, audio_out: true,
      voices: source.voices?.map(voice => voice.id) ?? null },
    price: source.price?.value == null ? null : { unit: source.price.unit, value: source.price.value,
      as_of: source.price.as_of, source_url: null }, as_of: source.price?.as_of ?? null
  };
}

export async function loadAiModels({ repoRoot = defaultRoot } = {}) {
  const [catalog, supplements] = await Promise.all([
    loadCatalog(repoRoot),
    readFile(path.join(repoRoot, 'packages/schemas/ai-models.json'), 'utf8').then(JSON.parse)
  ]);
  if (supplements.version !== 1 || !Array.isArray(supplements.models)) throw new Error('ai-models.json の形式が不正です');
  const generation = new Map(catalog.models.map(row => [row.id, row]));
  const tts = new Map([...FAL_TTS_ENGINES, ...DIRECT_TTS_ENGINES].map(row => [row.id, row]));
  const ids = new Set(), mains = new Map(), groups = new Set();
  const result = supplements.models.map(row => {
    if (ids.has(row.id)) throw new Error(`AI model id が重複: ${row.id}`);
    ids.add(row.id);
    groups.add(row.group);
    if (row.main) {
      if (mains.has(row.group)) throw new Error(`group の代表が複数: ${row.group}`);
      mains.set(row.group, row.id);
    }
    let base = {};
    if (row.ref) {
      if (row.inputs !== undefined || row.outputs !== undefined || row.price !== undefined) throw new Error(`ref 行に複製値: ${row.id}`);
      if (row.ref.startsWith('gen-models:')) {
        const source = generation.get(row.ref.slice('gen-models:'.length));
        if (!source) throw new Error(`ref の先が無い: ${row.ref}`);
        base = fromGeneration(source);
      } else if (row.ref.startsWith('tts:')) {
        const source = tts.get(row.ref.slice('tts:'.length));
        if (!source) throw new Error(`ref の先が無い: ${row.ref}`);
        base = fromTts(source);
      } else throw new Error(`ref の形式が不正: ${row.ref}`);
    }
    const { ref, observed, price_as_of, ...metadata } = row;
    const resolved = { ...base, ...metadata };
    resolved.inputs = { ...inputSlots, ...resolved.inputs };
    if (price_as_of && resolved.price) resolved.price = { ...resolved.price, as_of: price_as_of };
    if (observed) resolved.outputs = { ...resolved.outputs, ...observed };
    resolved.speed_s ??= null;
    resolved.price ??= null;
    resolved.as_of ??= null;
    return resolved;
  });
  for (const group of groups) if (!mains.has(group)) throw new Error(`group の代表が無い: ${group}`);
  return result;
}
