import path from 'node:path';
import { projectSpeechDeclarations } from '../../edit-store/lib/index.js';
import { hasAudioClipFx } from '../../media-bin/src/preview-audio-sidecar.mjs';

const DECODED_BYTES_THRESHOLD = 64 * 1024 * 1024;
const isHeavy = duration => duration * 48000 * 2 * 4 > DECODED_BYTES_THRESHOLD;

export function selectPreviewAudioItemsAt(items, t) {
  if (!Number.isFinite(t)) return [];
  return items.filter(item => {
    if (item.state !== 'queued' && item.state !== 'generating') return false;
    if (item.kind === 'bgm' || item.at == null) return true;
    const at = item.at ?? 0;
    return at <= t && (!(Number.isFinite(item.durationSec) && item.durationSec > 0)
      || t < at + item.durationSec);
  }).sort((a, b) => (a.at ?? 0) - (b.at ?? 0)
    || Number(a.kind === 'speech') - Number(b.kind === 'speech'));
}

export function promotePreviewAudioSummaryAt(summary, t, { cacheDir, promoteSidecars }) {
  const selected = selectPreviewAudioItemsAt(summary?.priority ?? [], t);
  const promoted = new Set();
  // Separate calls preserve the global order even when keys and pending probes interleave.
  for (const item of [...selected].reverse()) {
    const result = promoteSidecars({ cacheDir,
      keys: item.key ? [item.key] : [], sourcePaths: item.key ? [] : [item.sourcePath] });
    for (const value of result.promoted) promoted.add(value);
  }
  return { promoted: [...new Set(selected.filter(item => promoted.has(item.key ?? item.sourcePath))
    .map(item => item.key ?? `${item.kind}:${item.id}`))] };
}

// Summary only projects declarations and requests background work. The injected requester
// returns known state synchronously; probing/transcoding belongs to media-bin.
export function prepareFrameEngineAudioSummary(readData, deps) {
  const { projectRoot, cacheDir, ffmpeg, requestSidecar } = deps;
  const sourcePathOf = deps.sourcePathOf ?? (value => path.resolve(projectRoot, value));
  const warnings = [];
  const keepKeys = new Set();
  const keepProbes = new Set();
  const items = [];
  const priority = [];
  const requests = [];
  const warn = message => { warnings.push(message); deps.warn?.(message); };
  const fps = Number(readData?.output?.fps) > 0 ? Number(readData.output.fps) : 30;
  const sources = new Map((readData?.sources ?? []).map(source => [String(source?.id ?? ''), source]));
  const speech = projectSpeechDeclarations(readData?.cuts ?? [], { fps }).map(item => ({ ...item }));
  const audio = { ...(readData?.audio ?? {}) };
  const enqueue = (target, kind, id, at, options, fallback) => {
    delete target.sidecar;
    delete target.sidecarState;
    delete target.sidecarWarningEmitted;
    requests.push({ target, kind, id, at, options, fallback });
  };
  for (const declaration of speech) {
    const declaredPath = sources.get(declaration.src)?.path;
    if (typeof declaredPath !== 'string' || !declaredPath) continue;
    enqueue(declaration, 'speech', declaration.id, declaration.atSec, {
      sourcePath: sourcePathOf(declaredPath), inSec: declaration.inSec, outSec: declaration.outSec,
      speed: declaration.speed, padBeforeSec: declaration.padBeforeSec ?? 0,
      padAfterSec: declaration.padAfterSec ?? 0,
      format: isHeavy(declaration.outSec - declaration.inSec
        + (declaration.padBeforeSec ?? 0) + (declaration.padAfterSec ?? 0)) ? 'pcm-s16le' : 'flac',
    }, `speech sidecar ${declaration.id} unavailable; using source fallback`);
  }
  const prepareRegular = (raw, kind, fallbackId) => {
    if (!raw || typeof raw !== 'object' || typeof raw.path !== 'string' || !raw.path) return raw;
    const sourcePath = sourcePathOf(raw.path);
    const clipFx = {
      ...(kind !== 'narration' && Number.isFinite(raw.speed) ? { speed: raw.speed } : {}),
      ...(kind !== 'narration' && Number.isFinite(raw.pitch_semitones) ? { pitch_semitones: raw.pitch_semitones } : {}),
      ...(kind !== 'narration' && (raw.formant === 'preserve' || raw.formant === 'shift') ? { formant: raw.formant } : {}),
      ...(raw.denoise && typeof raw.denoise === 'object' ? { denoise: raw.denoise } : {}),
      ...(Number.isFinite(raw.lowcut_hz) ? { lowcut_hz: raw.lowcut_hz } : {}),
    };
    const needsClipFx = hasAudioClipFx(clipFx);
    const inSec = Number.isFinite(raw.in) && raw.in >= 0 ? raw.in : 0;
    const outSec = Number.isFinite(raw.out) && raw.out > inSec ? raw.out : undefined;
    const heavy = outSec !== undefined && isHeavy(outSec - inSec);
    if (outSec !== undefined && !needsClipFx && !heavy) return raw;
    const target = { ...raw };
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    const label = kind === 'bgm' ? 'bgm' : `${kind} ${id}`;
    enqueue(target, kind, id, kind === 'bgm' ? 0 : (raw.t ?? 0), {
      sourcePath, inSec, ...(outSec !== undefined ? { outSec } : {}),
      speed: clipFx.speed ?? 1, padBeforeSec: 0, padAfterSec: 0,
      format: heavy || outSec === undefined ? 'pcm-s16le' : 'flac',
      ...(outSec === undefined ? { decodedBytesThreshold: DECODED_BYTES_THRESHOLD } : {}),
      ...(needsClipFx ? { clipFx } : {}),
    }, needsClipFx
      ? `${label} sidecar unavailable; using source fallback (preview approximation will differ from export)`
      : `${label} sidecar unavailable; using source`);
    return target;
  };
  if (audio.bgm !== undefined) audio.bgm = prepareRegular(audio.bgm, 'bgm', 'bgm');
  for (const kind of ['sfx', 'narration']) {
    if (Array.isArray(audio[kind])) audio[kind] = audio[kind].map((item, index) =>
      prepareRegular(item, kind, `${kind}-${index + 1}`));
  }
  requests.sort((a, b) => a.at - b.at);
  for (const { target, kind, id, at, options, fallback } of requests) {
    let result;
    try {
      result = ffmpeg ? requestSidecar({ ...options, ffmpeg, cacheDir })
        : { state: 'unavailable', reason: 'ffmpeg-missing' };
    } catch (error) {
      result = { state: 'invalid', reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.probe?.fingerprint) keepProbes.add(result.probe.fingerprint);
    if (result.state === 'not-needed') continue;
    const state = ['ready', 'queued', 'generating', 'no-audio'].includes(result.state)
      ? result.state : 'unavailable';
    target.sidecarState = state;
    if (result.key) keepKeys.add(result.key);
    if (result.probe?.fingerprint) keepProbes.add(result.probe.fingerprint);
    const durationSec = kind === 'bgm' ? undefined : kind === 'speech'
      ? target.durationSec ?? (options.outSec - options.inSec) / options.speed
      : options.outSec === undefined ? undefined : options.outSec - options.inSec;
    const item = { kind, id, key: result.key ?? null, state, at,
      ...(durationSec !== undefined ? { durationSec } : {}) };
    items.push(item);
    priority.push({ ...item, sourcePath: options.sourcePath });
    if (state === 'ready') {
      target.sidecar = {
        path: path.relative(projectRoot, result.path).split(path.sep).join('/'),
        durationSec: result.durationSec, padBeforeSec: options.padBeforeSec,
        padAfterSec: options.padAfterSec, skipped: true, bytes: result.bytes,
        ...Object.fromEntries(['format', 'sampleRate', 'channels', 'frames', 'bytesPerSample']
          .filter(field => result[field] !== undefined).map(field => [field, result[field]])),
      };
    } else if (state === 'no-audio') {
      warn(`${kind} ${id}: no audio stream: ${result.reason ?? 'no-audio'}`);
    } else if (state === 'unavailable') {
      target.sidecarWarningEmitted = true;
      warn(`${fallback}: ${result.reason ?? result.state}`);
    }
  }
  return { audio: { ...audio, speech }, warnings, keepKeys: [...keepKeys], keepProbes: [...keepProbes], items, priority };
}
