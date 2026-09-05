import fs from 'node:fs';
import path from 'node:path';
import { projectSpeechDeclarations } from '../../edit-store/lib/index.js';
import { hasAudioClipFx } from '../../media-bin/src/preview-audio-sidecar.mjs';

// Summary only projects declarations and requests background work. The injected requester
// returns known state synchronously; probing/transcoding belongs to media-bin.
export function prepareFrameEngineAudioSummary(readData, deps) {
  const { projectRoot, cacheDir, ffmpeg, requestSidecar } = deps;
  const sourcePathOf = deps.sourcePathOf ?? (value => path.resolve(projectRoot, value));
  const warnings = [];
  const keepKeys = new Set();
  const keepProbes = new Set();
  const items = [];
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
    let isHeavyWav = false;
    try {
      isHeavyWav = path.extname(sourcePath).toLowerCase() === '.wav'
        && fs.statSync(sourcePath).size > 8 * 1024 * 1024;
    } catch { /* FX requests still report invalid sources through the requester. */ }
    if (!needsClipFx && !isHeavyWav) return raw;
    const target = { ...raw };
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    const label = kind === 'bgm' ? 'bgm' : `${kind} ${id}`;
    const inSec = Number.isFinite(raw.in) && raw.in >= 0 ? raw.in : 0;
    const outSec = kind !== 'bgm' && Number.isFinite(raw.out) && raw.out > inSec ? raw.out : undefined;
    enqueue(target, kind, id, kind === 'bgm' ? 0 : (raw.t ?? 0), {
      sourcePath, inSec, ...(outSec !== undefined ? { outSec } : {}),
      speed: clipFx.speed ?? 1, padBeforeSec: 0, padAfterSec: 0,
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
  for (const { target, kind, id, options, fallback } of requests) {
    let result;
    try {
      result = ffmpeg ? requestSidecar({ ...options, ffmpeg, cacheDir })
        : { state: 'unavailable', reason: 'ffmpeg-missing' };
    } catch (error) {
      result = { state: 'invalid', reason: error instanceof Error ? error.message : String(error) };
    }
    const state = ['ready', 'queued', 'generating', 'no-audio'].includes(result.state)
      ? result.state : 'unavailable';
    target.sidecarState = state;
    if (result.key) keepKeys.add(result.key);
    if (result.probe?.fingerprint) keepProbes.add(result.probe.fingerprint);
    items.push({ kind, id, key: result.key ?? null, state });
    if (state === 'ready') {
      target.sidecar = {
        path: path.relative(projectRoot, result.path).split(path.sep).join('/'),
        durationSec: result.durationSec, padBeforeSec: options.padBeforeSec,
        padAfterSec: options.padAfterSec, skipped: true, bytes: result.bytes,
      };
    } else if (state === 'no-audio') {
      warn(`${kind} ${id}: no audio stream: ${result.reason ?? 'no-audio'}`);
    } else if (state === 'unavailable') {
      target.sidecarWarningEmitted = true;
      warn(`${fallback}: ${result.reason ?? result.state}`);
    }
  }
  return { audio: { ...audio, speech }, warnings, keepKeys: [...keepKeys], keepProbes: [...keepProbes], items };
}
