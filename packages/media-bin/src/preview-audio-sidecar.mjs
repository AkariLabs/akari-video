import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveFfmpeg, resolveFfprobe } from './index.mjs';

export const PREVIEW_AUDIO_RECIPE = 'preview-audio-flac-v2';

const inFlight = new Map();
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 10 * 60 * 1000;

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function summarize(value, fallback) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text ? text.slice(0, 1000) : fallback;
}

function formatNumber(value) {
  if (Object.is(value, -0)) return '0';
  return Number(value).toFixed(9).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}

export function normalizeAudioClipFx(value = {}) {
  const denoise = value?.denoise && typeof value.denoise === 'object'
    && (value.denoise.method === 'fft' || value.denoise.method === 'nlm')
    && finiteNonNegative(value.denoise.strength) && value.denoise.strength <= 1
    ? { method: value.denoise.method, strength: value.denoise.strength }
    : null;
  return {
    speed: finitePositive(value?.speed) ? value.speed : 1,
    pitchSemitones: typeof value?.pitch_semitones === 'number' && Number.isFinite(value.pitch_semitones)
      ? value.pitch_semitones : 0,
    formant: value?.formant === 'shift' ? 'shift' : 'preserve',
    denoise,
    lowcutHz: finiteNonNegative(value?.lowcut_hz) ? value.lowcut_hz : 0,
  };
}

export function hasAudioClipFx(value = {}) {
  const normalized = normalizeAudioClipFx(value);
  return normalized.speed !== 1 || normalized.pitchSemitones !== 0
    || normalized.denoise !== null || normalized.lowcutHz > 0;
}

// Single canonical clip-FX chain shared by render-cut and preview sidecars.
export function buildAudioClipFxFilters(value = {}) {
  const normalized = normalizeAudioClipFx(value);
  const filters = [];
  if (normalized.lowcutHz > 0) {
    const highpass = `highpass=f=${formatNumber(normalized.lowcutHz)}:p=2`;
    filters.push(highpass, highpass);
  }
  if (normalized.denoise?.method === 'fft') {
    filters.push(`afftdn=nr=${formatNumber(12 + normalized.denoise.strength * 76)}:nf=-30`);
  } else if (normalized.denoise?.method === 'nlm') {
    filters.push(`anlmdn=s=${formatNumber(0.00001 + normalized.denoise.strength * 0.0002)}`);
  }
  if (normalized.speed !== 1 || normalized.pitchSemitones !== 0) {
    filters.push([
      `rubberband=tempo=${formatNumber(normalized.speed)}`,
      `pitch=${formatNumber(2 ** (normalized.pitchSemitones / 12))}`,
      `formant=${normalized.formant === 'shift' ? 'shifted' : 'preserved'}`,
      'pitchq=quality',
    ].join(':'));
  }
  return filters;
}

export function buildPreviewAudioFilterChain(options) {
  const padBeforeSec = options?.padBeforeSec ?? 0;
  const padAfterSec = options?.padAfterSec ?? 0;
  if (options?.clipFx) {
    return [
      `atrim=start=${formatNumber(Math.max(0, options.inSec - padBeforeSec))}:end=${formatNumber(options.outSec + padAfterSec)}`,
      'asetpts=PTS-STARTPTS',
      ...buildAudioClipFxFilters(options.clipFx),
    ];
  }
  return [
    'asetpts=PTS-STARTPTS',
    ...buildAtempoChain(options?.speed ?? 1).map(factor => `atempo=${formatNumber(factor)}`),
  ];
}

// ffmpeg atempo accepts factors in [0.5, 2.0]. This remains the single definition shared
// by preview sidecars and render-cut, including factors outside one native atempo stage.
export function buildAtempoChain(speed) {
  if (speed === 1) return [];
  const factors = [];
  let remaining = speed;
  while (remaining > 2 + 1e-9) {
    factors.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-9) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return factors;
}

function acquireFileLock(lockPath) {
  const startedAt = Date.now();
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  let waited = false;
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return waited;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      waited = true;
    }
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        waited = false;
        continue;
      }
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (Date.now() - startedAt >= LOCK_WAIT_MS) {
      throw new Error(`preview audio lock timed out: ${lockPath}`);
    }
    Atomics.wait(waitArray, 0, 0, 100);
  }
}

function keyFor(sourcePath, stat, values) {
  return crypto.createHash('sha1').update([
    sourcePath,
    stat.size,
    stat.mtimeMs,
    formatNumber(values.inSec),
    formatNumber(values.outSec),
    formatNumber(values.padBeforeSec),
    formatNumber(values.padAfterSec),
    values.filters.join(','),
    PREVIEW_AUDIO_RECIPE,
  ].join('|')).digest('hex');
}

export function previewAudioSidecarKey(options) {
  return keyFor(path.resolve(options.sourcePath), {
    size: options.size,
    mtimeMs: options.mtimeMs,
  }, {
    inSec: options.inSec,
    outSec: options.outSec,
    padBeforeSec: options.padBeforeSec ?? 0,
    padAfterSec: options.padAfterSec ?? 0,
    filters: buildPreviewAudioFilterChain(options),
  });
}

function probeAudio(filePath, ffprobe = resolveFfprobe()) {
  const result = spawnSync(ffprobe, [
    '-hide_banner', '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels:format=duration',
    '-of', 'json', filePath,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr || result.error?.message, 'ffprobe failed to inspect audio'));
  }
  const parsed = JSON.parse(result.stdout || '{}');
  const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : undefined;
  const durationSec = Number(parsed.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (!finitePositive(durationSec) || !finitePositive(sampleRate)
    || !Number.isInteger(channels) || channels <= 0) {
    throw new Error('ffprobe returned invalid audio metadata');
  }
  return { durationSec, sampleRate, channels };
}

export function probePreviewAudioSource(sourcePath, options = {}) {
  try {
    const resolved = path.resolve(sourcePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`source is not a regular file: ${resolved}`);
    return { ok: true, path: resolved, bytes: stat.size, ...probeAudio(resolved, options.ffprobe) };
  } catch (error) {
    return {
      ok: false,
      path: typeof sourcePath === 'string' ? path.resolve(sourcePath) : null,
      bytes: 0,
      durationSec: 0,
      sampleRate: 0,
      channels: 0,
      reason: summarize(error?.message, 'audio probe failed'),
    };
  }
}

function ensureSync(options) {
  let outputPath = null;
  let key = null;
  try {
    if (!options || typeof options.sourcePath !== 'string' || !options.sourcePath) {
      throw new Error('sourcePath is required');
    }
    const padBeforeSec = options.padBeforeSec ?? 0;
    const padAfterSec = options.padAfterSec ?? 0;
    if (!finiteNonNegative(options.inSec) || !finitePositive(options.outSec)
      || options.outSec <= options.inSec || !finitePositive(options.speed)
      || !finiteNonNegative(padBeforeSec) || !finiteNonNegative(padAfterSec)) {
      throw new Error('inSec, outSec, speed, and pads must describe a positive source range');
    }
    if (options.clipFx) validateAudioClipFx(options.clipFx);
    if (typeof options.cacheDir !== 'string' || !options.cacheDir) {
      throw new Error('cacheDir is required');
    }
    const sourcePath = path.resolve(options.sourcePath);
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`source is not a regular file: ${sourcePath}`);
    const values = {
      inSec: options.inSec,
      outSec: options.outSec,
      speed: options.speed,
      padBeforeSec,
      padAfterSec,
      filters: buildPreviewAudioFilterChain({ ...options, padBeforeSec, padAfterSec }),
    };
    key = keyFor(sourcePath, stat, values);
    const outputDirectory = path.resolve(options.cacheDir, 'preview-audio');
    outputPath = path.join(outputDirectory, `${key}.flac`);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const inspectAudio = typeof options.probeAudio === 'function' ? options.probeAudio : probeAudio;
    const fromExisting = () => {
      const metadata = inspectAudio(outputPath, options.ffprobe ?? resolveFfprobe());
      return {
        ok: true, skipped: true, path: outputPath, key,
        durationSec: metadata.durationSec,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        reason: null,
      };
    };
    if (fs.existsSync(outputPath)) return fromExisting();

    const lockPath = `${outputPath}.lock`;
    acquireFileLock(lockPath);
    try {
      if (fs.existsSync(outputPath)) return fromExisting();
      const temporary = path.join(outputDirectory,
        `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp.flac`);
      try {
        const startSec = Math.max(0, options.inSec - padBeforeSec);
        const endSec = options.outSec + padAfterSec;
        const filters = values.filters;
        const result = spawnSync(options.ffmpeg ?? resolveFfmpeg(), [
          '-hide_banner', '-nostdin', '-loglevel', 'error',
          ...(!options.clipFx ? ['-ss', formatNumber(startSec), '-to', formatNumber(endSec)] : []),
          '-i', sourcePath,
          '-map', '0:a:0', '-vn',
          '-af', filters.join(','),
          '-ar', '48000', '-c:a', 'flac', '-compression_level', '5',
          '-y', temporary,
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (result.error || result.status !== 0) {
          throw new Error(summarize(result.stderr || result.error?.message,
            'ffmpeg failed to create the preview audio sidecar'));
        }
        const outputStat = fs.statSync(temporary);
        if (!outputStat.isFile() || outputStat.size <= 42) {
          throw new Error('ffmpeg created an empty preview audio sidecar');
        }
        const metadata = inspectAudio(temporary, options.ffprobe ?? resolveFfprobe());
        if (metadata.sampleRate !== 48000) throw new Error('preview audio sidecar is not 48 kHz');
        fs.renameSync(temporary, outputPath);
        return {
          ok: true, skipped: false, path: outputPath, key,
          durationSec: metadata.durationSec,
          sampleRate: metadata.sampleRate,
          channels: metadata.channels,
          reason: null,
        };
      } finally {
        for (const name of fs.readdirSync(outputDirectory)) {
          if (name.startsWith(`.${path.basename(outputPath)}.${process.pid}.`) && name.endsWith('.tmp.flac')) {
            fs.rmSync(path.join(outputDirectory, name), { force: true });
          }
        }
      }
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false, skipped: false, path: outputPath, key,
      durationSec: 0, sampleRate: 0, channels: 0,
      reason: summarize(error?.message, 'preview audio sidecar generation failed'),
    };
  }
}

export function ensurePreviewAudioSidecar(options) {
  const filters = options?.clipFx
    ? buildAudioClipFxFilters(options.clipFx)
    : finitePositive(options?.speed)
      ? buildAtempoChain(options.speed).map(factor => `atempo=${formatNumber(factor)}`)
      : [];
  const identity = options && typeof options.sourcePath === 'string'
    ? [path.resolve(options.sourcePath), options.inSec, options.outSec, options.speed,
      options.padBeforeSec ?? 0, options.padAfterSec ?? 0,
      filters.join(','),
      path.resolve(String(options.cacheDir ?? '')), PREVIEW_AUDIO_RECIPE].join('\0')
    : JSON.stringify(options);
  if (inFlight.has(identity)) return inFlight.get(identity);
  const pending = Promise.resolve().then(() => ensureSync(options));
  inFlight.set(identity, pending);
  void pending.finally(() => inFlight.delete(identity));
  return pending;
}

function validateAudioClipFx(value) {
  if (!value || typeof value !== 'object') throw new Error('clipFx must be an object');
  if (value.speed !== undefined && (!finitePositive(value.speed) || value.speed <= 0.25 || value.speed > 4)) {
    throw new Error('clipFx.speed must be within (0.25, 4]');
  }
  if (value.pitch_semitones !== undefined && (typeof value.pitch_semitones !== 'number'
      || !Number.isFinite(value.pitch_semitones) || value.pitch_semitones < -24 || value.pitch_semitones > 24)) {
    throw new Error('clipFx.pitch_semitones must be within [-24, 24]');
  }
  if (value.formant !== undefined && value.formant !== 'preserve' && value.formant !== 'shift') {
    throw new Error('clipFx.formant must be preserve or shift');
  }
  if (value.lowcut_hz !== undefined && (!finiteNonNegative(value.lowcut_hz) || value.lowcut_hz > 400)) {
    throw new Error('clipFx.lowcut_hz must be within [0, 400]');
  }
  if (value.denoise !== undefined && (!value.denoise || typeof value.denoise !== 'object'
      || (value.denoise.method !== 'fft' && value.denoise.method !== 'nlm')
      || !finiteNonNegative(value.denoise.strength) || value.denoise.strength > 1)) {
    throw new Error('clipFx.denoise must contain fft|nlm and strength within [0, 1]');
  }
}

export function sweepPreviewAudioSidecars({ cacheDir, keepKeys }) {
  const kept = new Set(Array.from(keepKeys ?? [], value => String(value).replace(/\.flac$/u, '')));
  const outputDirectory = path.resolve(cacheDir, 'preview-audio');
  let removed = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.flac')) continue;
      const key = entry.name.slice(0, -'.flac'.length);
      if (kept.has(key)) continue;
      const target = path.join(outputDirectory, entry.name);
      bytes += fs.statSync(target).size;
      fs.rmSync(target, { force: true });
      removed += 1;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  // The unified FLAC recipe replaces the legacy uncompressed cache entirely.
  const legacyDirectory = path.resolve(cacheDir, 'speech-atempo');
  try {
    for (const entry of fs.readdirSync(legacyDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.wav')) continue;
      const target = path.join(legacyDirectory, entry.name);
      bytes += fs.statSync(target).size;
      fs.rmSync(target, { force: true });
      removed += 1;
    }
    if (fs.readdirSync(legacyDirectory).length === 0) fs.rmdirSync(legacyDirectory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { removed, bytes };
}
