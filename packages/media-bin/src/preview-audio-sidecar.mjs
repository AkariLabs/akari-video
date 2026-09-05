import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { resolveFfmpeg, resolveFfprobe } from './index.mjs';

export const PREVIEW_AUDIO_RECIPE = 'preview-audio-flac-v2';
export const PREVIEW_AUDIO_PCM_RECIPE = 'preview-audio-pcm-v1';

export function pcmWindowByteRange({ sampleRate, channels, bytesPerSample, frames }, startSec, endSec) {
  if (!finitePositive(sampleRate) || !Number.isSafeInteger(channels) || channels <= 0
    || !Number.isSafeInteger(bytesPerSample) || bytesPerSample <= 0
    || !Number.isSafeInteger(frames) || frames < 0
    || !Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  const startFrame = Math.min(frames, Math.max(0, Math.floor(startSec * sampleRate)));
  const endFrame = Math.min(frames, Math.max(0, Math.ceil(endSec * sampleRate)));
  if (endFrame <= startFrame) return null;
  const stride = channels * bytesPerSample;
  return { startByte: startFrame * stride, endByte: endFrame * stride - 1,
    startFrame, frameCount: endFrame - startFrame };
}

function audioFormat(options) {
  const format = options?.format ?? 'flac';
  if (format !== 'flac' && format !== 'pcm-s16le') throw new Error('format must be flac or pcm-s16le');
  return format;
}

// Process-wide ceilings for the child processes this module starts. Both callers (the Theia
// backend that also serves media bytes over HTTP Range, and preview-server's /api/summary)
// fan sidecar requests out with Promise.all, so without a ceiling a project with many heavy
// WAVs would start one ffmpeg per request at once. Per-call `concurrency` / `timeoutMs`
// options override these defaults (tests).
export const PREVIEW_AUDIO_CONCURRENCY = Object.freeze({ ffmpeg: 2, ffprobe: 4 });
export const PREVIEW_AUDIO_TIMEOUT_MS = Object.freeze({ ffmpeg: 30 * 60 * 1000, ffprobe: 60 * 1000 });

const LOCK_STALE_MS = 30 * 60 * 1000;
const LOCK_WAIT_MS = 10 * 60 * 1000;
const LOCK_POLL_MS = 100;

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function summarize(value, fallback) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text ? text.slice(0, 1000) : fallback;
}

function formatNumber(value) {
  if (Object.is(value, -0)) return '0';
  return Number(value).toFixed(9).replace(/(?:\.0+|(\.\d*?)0+)$/u, '$1');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

// Counting semaphore whose limit is supplied per acquisition: the active count is shared by
// the whole process while each caller may state the ceiling it accepts. Waiters are woken in
// FIFO order and the count is bumped synchronously on wake-up, so the ceiling never overshoots.
class Semaphore {
  #active = 0;
  #waiters = [];

  acquire(limit) {
    if (this.#active < limit) {
      this.#active += 1;
      return Promise.resolve();
    }
    return new Promise(resolve => this.#waiters.push({ limit, resolve }));
  }

  release() {
    this.#active -= 1;
    for (let index = 0; index < this.#waiters.length;) {
      if (this.#active < this.#waiters[index].limit) {
        this.#active += 1;
        this.#waiters.splice(index, 1)[0].resolve();
      } else {
        index += 1;
      }
    }
  }

  async run(limit, task) {
    await this.acquire(limit);
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

const ffmpegSlots = new Semaphore();
const ffprobeSlots = new Semaphore();

function settingsFrom(options) {
  const concurrency = options?.concurrency ?? {};
  const timeoutMs = options?.timeoutMs ?? {};
  return {
    concurrency: {
      ffmpeg: positiveInteger(concurrency.ffmpeg, PREVIEW_AUDIO_CONCURRENCY.ffmpeg),
      ffprobe: positiveInteger(concurrency.ffprobe, PREVIEW_AUDIO_CONCURRENCY.ffprobe),
    },
    timeoutMs: {
      ffmpeg: finiteNonNegative(timeoutMs.ffmpeg) ? timeoutMs.ffmpeg : PREVIEW_AUDIO_TIMEOUT_MS.ffmpeg,
      ffprobe: finiteNonNegative(timeoutMs.ffprobe) ? timeoutMs.ffprobe : PREVIEW_AUDIO_TIMEOUT_MS.ffprobe,
    },
  };
}

// Resolving ffprobe through media-bin costs a synchronous `ffprobe -version` spawn when it
// has to look on PATH; the answer cannot change within a process, so resolve it once.
let memoizedFfprobe = null;
function defaultFfprobe() {
  memoizedFfprobe ??= resolveFfprobe();
  return memoizedFfprobe;
}

// Promise-wrapped spawn with the subset of spawnSync's result shape this module reads
// (`error`, `status`, `stdout`, `stderr`). A timeout or an oversized stream kills the child;
// the caller then sees `error` set. Resolves — never rejects — so failure handling stays in
// one place at the call site, exactly as with spawnSync.
function runProcess(command, args, { timeoutMs = 0, maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let error = null;
    let timer = null;
    let settled = false;
    let child = null;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve({
        error,
        status,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    };
    const fail = reason => {
      error ??= reason;
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    };
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (spawnError) {
      error = spawnError;
      finish(null, null);
      return;
    }
    const label = path.basename(String(command));
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) return fail(new Error(`${label} stdout exceeded ${maxBuffer} bytes`));
      stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBuffer) return fail(new Error(`${label} stderr exceeded ${maxBuffer} bytes`));
      stderr.push(chunk);
    });
    child.on('error', spawnError => {
      fail(spawnError);
      if (child.pid === undefined) finish(null, null);
    });
    // After we killed the child ourselves, do not wait for 'close': a grandchild (for example
    // a shell's `sleep`) may keep the inherited pipes open long after the child is gone.
    child.on('exit', (status, signal) => {
      if (error) finish(status, signal);
    });
    child.on('close', (status, signal) => finish(status, signal));
    if (timeoutMs > 0) {
      timer = setTimeout(() => fail(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
    }
  });
}

function processFailure(result, fallback) {
  return new Error(summarize(result.error?.message || result.stderr, fallback));
}

async function acquireFileLock(lockPath) {
  const startedAt = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    try {
      if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        fs.rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (Date.now() - startedAt >= LOCK_WAIT_MS) {
      throw new Error(`preview audio lock timed out: ${lockPath}`);
    }
    await sleep(LOCK_POLL_MS);
  }
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

export function previewAudioSidecarKey(options) {
  return keyFor(path.resolve(options.sourcePath), {
    size: options.size,
    mtimeMs: options.mtimeMs,
  }, {
    inSec: options.inSec,
    outSec: options.outSec,
    speed: options.speed,
    padBeforeSec: options.padBeforeSec ?? 0,
    padAfterSec: options.padAfterSec ?? 0,
    filters: buildPreviewAudioFilterChain(options),
    format: audioFormat(options),
  });
}

function keyFor(sourcePath, stat, values) {
  return crypto.createHash('sha1').update([
    sourcePath,
    stat.size,
    stat.mtimeMs,
    formatNumber(values.inSec),
    formatNumber(values.outSec),
    formatNumber(values.speed),
    formatNumber(values.padBeforeSec),
    formatNumber(values.padAfterSec),
    ...(values.filters ?? []),
    // Keep the complete FLAC v2 hash input unchanged, including its final recipe token.
    ...(values.format === 'pcm-s16le'
      ? [PREVIEW_AUDIO_PCM_RECIPE, 'pcm-s16le', 24000, 1, 2] : [PREVIEW_AUDIO_RECIPE]),
  ].join('|')).digest('hex');
}

function probeArguments(filePath) {
  return [
    '-hide_banner', '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels:format=duration',
    '-of', 'json', filePath,
  ];
}

function parseProbeOutput(stdout) {
  const parsed = JSON.parse(stdout || '{}');
  const stream = Array.isArray(parsed.streams) ? parsed.streams[0] : undefined;
  if (!stream) throw new Error('ffprobe: no audio stream');
  const durationSec = Number(parsed.format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (!finitePositive(durationSec) || !finitePositive(sampleRate)
    || !Number.isInteger(channels) || channels <= 0) {
    throw new Error('ffprobe returned invalid audio metadata');
  }
  return { durationSec, sampleRate, channels };
}

// Synchronous probe, kept for scripts and one-shot tools. Long-running hosts (Theia backend,
// preview-server) must use probeAudioAsync so their event loop keeps serving media bytes.
function probeAudio(filePath, ffprobe = defaultFfprobe()) {
  const result = spawnSync(ffprobe, probeArguments(filePath), { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw processFailure(result, 'ffprobe failed to inspect audio');
  }
  return parseProbeOutput(result.stdout);
}

async function probeAudioAsync(filePath, ffprobe, settings) {
  const result = await ffprobeSlots.run(settings.concurrency.ffprobe, () => runProcess(
    ffprobe, probeArguments(filePath),
    { timeoutMs: settings.timeoutMs.ffprobe, maxBuffer: 4 * 1024 * 1024 },
  ));
  if (result.error || result.status !== 0) {
    throw processFailure(result, 'ffprobe failed to inspect audio');
  }
  return parseProbeOutput(result.stdout);
}

function probeFailure(sourcePath, error) {
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

export function probePreviewAudioSource(sourcePath, options = {}) {
  try {
    const resolved = path.resolve(sourcePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`source is not a regular file: ${resolved}`);
    return { ok: true, path: resolved, bytes: stat.size, ...probeAudio(resolved, options.ffprobe) };
  } catch (error) {
    return probeFailure(sourcePath, error);
  }
}

// Same result shape as probePreviewAudioSource, but ffprobe is awaited instead of blocking.
export async function probePreviewAudioSourceAsync(sourcePath, options = {}) {
  try {
    const resolved = path.resolve(sourcePath);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) throw new Error(`source is not a regular file: ${resolved}`);
    const metadata = await (typeof options.probeAudio === 'function'
      ? options.probeAudio(resolved, options.ffprobe ?? defaultFfprobe())
      : probeAudioAsync(resolved, options.ffprobe ?? defaultFfprobe(), settingsFrom(options)));
    return { ok: true, path: resolved, bytes: stat.size, ...metadata };
  } catch (error) {
    return probeFailure(sourcePath, error);
  }
}

// Validates the request and derives the cache key / output path. Deliberately synchronous:
// ensurePreviewAudioSidecar registers the in-flight promise right after this returns, so two
// concurrent requests for the same output path cannot both slip past the in-flight check.
function prepare(options, state, createDirectory = true) {
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
  const format = audioFormat(options);
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
    format,
  };
  state.key = keyFor(sourcePath, stat, values);
  const outputDirectory = path.resolve(options.cacheDir, 'preview-audio');
  const extension = format === 'pcm-s16le' ? 'pcm' : 'flac';
  state.outputPath = path.join(outputDirectory, `${state.key}.${extension}`);
  if (createDirectory) fs.mkdirSync(outputDirectory, { recursive: true });
  return {
    sourcePath,
    outputDirectory,
    outputPath: state.outputPath,
    key: state.key,
    format, extension,
    recipe: format === 'pcm-s16le' ? PREVIEW_AUDIO_PCM_RECIPE : PREVIEW_AUDIO_RECIPE,
    startSec: Math.max(0, options.inSec - padBeforeSec),
    endSec: options.outSec + padAfterSec,
    speed: options.speed,
    clipFx: options.clipFx,
    filters: values.filters,
  };
}

function failure(outputPath, key, error) {
  return {
    ok: false, skipped: false, path: outputPath, key,
    durationSec: 0, sampleRate: 0, channels: 0,
    reason: summarize(error?.message, 'preview audio sidecar generation failed'),
  };
}

async function generate(prepared, options) {
  const { sourcePath, outputDirectory, outputPath, key } = prepared;
  const settings = settingsFrom(options);
  const ffprobeOf = () => options.ffprobe ?? defaultFfprobe();
  // テスト・呼び出し側の注入シーム（T4 由来）: probeAudio があれば同期関数として尊重する。
  const inspectAudio = async (p) => prepared.format === 'pcm-s16le' ? inspectPcm(p) : (typeof options.probeAudio === 'function'
    ? options.probeAudio(p, ffprobeOf())
    : probeAudioAsync(p, ffprobeOf(), settings));
  const fromExisting = async () => {
    let metadata = readMetadata(prepared);
    if (!metadata) {
      metadata = await inspectAudio(outputPath);
      writeMetadata(prepared, options, metadata, prepared.format === 'flac');
    }
    return {
      ok: true, skipped: true, path: outputPath, key,
      format: prepared.format,
      ...(prepared.format === 'pcm-s16le' ? { frames: metadata.frames, bytesPerSample: 2 } : {}),
      durationSec: metadata.durationSec,
      sampleRate: metadata.sampleRate,
      channels: metadata.channels,
      reason: null,
    };
  };
  if (fs.existsSync(outputPath)) return fromExisting();

  const lockPath = `${outputPath}.lock`;
  await acquireFileLock(lockPath);
  try {
    if (fs.existsSync(outputPath)) return fromExisting();
    const temporary = path.join(outputDirectory,
      `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp.${prepared.extension}`);
    try {
      const filters = prepared.filters ?? [
        'asetpts=PTS-STARTPTS',
        ...buildAtempoChain(prepared.speed).map(factor => `atempo=${formatNumber(factor)}`),
      ];
      const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
      const result = await ffmpegSlots.run(settings.concurrency.ffmpeg, () => runProcess(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        ...(!prepared.clipFx ? ['-ss', formatNumber(prepared.startSec), '-to', formatNumber(prepared.endSec)] : []),
        '-i', sourcePath,
        '-map', '0:a:0', '-vn',
        '-af', filters.join(','),
        ...(prepared.format === 'pcm-s16le'
          ? ['-ar', '24000', '-ac', '1', '-f', 's16le', '-c:a', 'pcm_s16le']
          : ['-ar', '48000', '-c:a', 'flac', '-compression_level', '5']),
        '-y', temporary,
      ], { timeoutMs: settings.timeoutMs.ffmpeg, maxBuffer: 16 * 1024 * 1024 }));
      if (result.error || result.status !== 0) {
        throw processFailure(result, 'ffmpeg failed to create the preview audio sidecar');
      }
      const outputStat = fs.statSync(temporary);
      if (!outputStat.isFile() || outputStat.size <= (prepared.format === 'pcm-s16le' ? 0 : 42)) {
        throw new Error('ffmpeg created an empty preview audio sidecar');
      }
      const metadata = await inspectAudio(temporary);
      if (prepared.format === 'flac' && metadata.sampleRate !== 48000) throw new Error('preview audio sidecar is not 48 kHz');
      fs.renameSync(temporary, outputPath);
      writeMetadata(prepared, options, metadata);
      return {
        ok: true, skipped: false, path: outputPath, key,
        format: prepared.format,
        ...(prepared.format === 'pcm-s16le' ? { frames: metadata.frames, bytesPerSample: 2 } : {}),
        durationSec: metadata.durationSec,
        sampleRate: metadata.sampleRate,
        channels: metadata.channels,
        reason: null,
      };
    } finally {
      for (const name of fs.readdirSync(outputDirectory)) {
        if (name.startsWith(`.${path.basename(outputPath)}.${process.pid}.`) && name.endsWith(`.tmp.${prepared.extension}`)) {
          fs.rmSync(path.join(outputDirectory, name), { force: true });
        }
      }
    }
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

// In-flight generations keyed by output path: concurrent requests that resolve to the same
// sidecar share one promise (and one ffmpeg). The entry is dropped as soon as it settles, so a
// later request finds the finished file and takes the "already exists → reuse" path.
const generating = new Map();
const requested = new Map();
const probing = new Map();
const listeners = new Set();
const FAILURE_RETRY_MS = 60000;

function readCacheJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function writeCacheJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp.json`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), 'utf8');
    fs.renameSync(temporary, filePath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function metadataPath(prepared) {
  return path.join(prepared.outputDirectory, `${prepared.key}.json`);
}

function readMetadata(prepared) {
  const value = readCacheJson(metadataPath(prepared));
  const format = value?.format ?? 'flac';
  return value?.recipe === prepared.recipe && value.key === prepared.key && format === prepared.format
    && finitePositive(value.durationSec) && finitePositive(value.sampleRate)
    && Number.isInteger(value.channels) && value.channels > 0 && finiteNonNegative(value.bytes)
    && (format !== 'pcm-s16le' || (value.sampleRate === 24000 && value.channels === 1
      && Number.isSafeInteger(value.frames) && value.frames > 0 && value.bytesPerSample === 2
      && value.bytes === value.frames * 2 && value.durationSec === value.frames / 24000))
    ? { ...value, format } : null;
}

function inspectPcm(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size % 2 !== 0) {
    throw new Error('preview PCM sidecar must contain complete nonempty s16le frames');
  }
  const frames = stat.size / 2;
  return { sampleRate: 24000, channels: 1, frames, bytesPerSample: 2, durationSec: frames / 24000 };
}

function writeMetadata(prepared, options, metadata, legacyFlac = false) {
  writeCacheJson(metadataPath(prepared), {
    recipe: prepared.recipe, key: prepared.key,
    ...(!legacyFlac ? { format: prepared.format } : {}),
    ...(prepared.format === 'pcm-s16le' ? { frames: metadata.frames, bytesPerSample: 2 } : {}),
    durationSec: metadata.durationSec, sampleRate: metadata.sampleRate, channels: metadata.channels,
    bytes: fs.statSync(prepared.outputPath).size,
    inSec: options.inSec, outSec: options.outSec, speed: options.speed,
    padBeforeSec: options.padBeforeSec ?? 0, padAfterSec: options.padAfterSec ?? 0,
    createdAt: Date.now(),
  });
}

export function classifyPreviewAudioFailure(reason) {
  // ffmpeg map errors (including builds which print an empty map), muxer errors,
  // and our ffprobe empty-stream result all mean this fingerprint has no audio.
  return /Stream map ['"][^'"]*['"] matches no streams|does not contain any stream|no audio stream/iu
    .test(String(reason)) ? 'no-audio' : 'transient';
}

function retryRemaining(record) {
  const createdAt = typeof record?.createdAt === 'number' ? record.createdAt : Date.parse(record?.createdAt);
  return Math.max(0, createdAt + (record?.retryAfterMs ?? FAILURE_RETRY_MS) - Date.now()) || 0;
}

// Validate even duration-less requests synchronously, but obtain their real endpoint only
// from a fingerprint-bound probe cache. No resolver or child process runs on this path.
function requestOptions(options) {
  if (options?.outSec !== undefined) {
    if (finitePositive(options.decodedBytesThreshold)) {
      prepare(options, {}, false);
      const duration = options.outSec - options.inSec + (options.padBeforeSec ?? 0) + (options.padAfterSec ?? 0);
      const heavy = duration * 48000 * 2 * 4 > options.decodedBytesThreshold;
      if (!heavy && !hasAudioClipFx(options.clipFx)) return { status: { state: 'not-needed', key: null } };
      return { options: { ...options, decodedBytesThreshold: undefined, format: heavy ? 'pcm-s16le' : 'flac' } };
    }
    return { options };
  }
  const validated = prepare({ ...options, outSec: (options?.inSec ?? 0) + 1 }, {}, false);
  const stat = fs.statSync(validated.sourcePath);
  const fingerprint = crypto.createHash('sha1')
    .update([validated.sourcePath, stat.size, stat.mtimeMs].join('|')).digest('hex');
  const probePath = path.join(validated.outputDirectory, `probe-${fingerprint}.json`);
  const cached = readCacheJson(probePath);
  if (cached?.error && (cached.error.class === 'no-audio' || retryRemaining(cached.error) > 0)) {
    return { probePath, status: {
      state: cached.error.class === 'no-audio' ? 'no-audio' : 'failed', key: null,
      reason: cached.error.reason, probe: { fingerprint },
      ...(cached.error.class === 'transient' ? { retryAfterMs: retryRemaining(cached.error) } : {}),
    } };
  }
  if (finitePositive(cached?.durationSec)) {
    const resolved = requestOptions({ ...options, outSec: cached.durationSec });
    return { ...resolved, probePath, probe: { fingerprint },
      ...(resolved.status ? { status: { ...resolved.status, probe: { fingerprint } } } : {}) };
  }
  return { probePath, status: { state: 'queued', key: null, probe: { fingerprint, pending: true } } };
}

export function previewAudioSidecarStatus(options) {
  try {
    const resolved = requestOptions(options);
    if (resolved.status) return resolved.status;
    if (resolved.probe) return { ...previewAudioSidecarStatus(resolved.options), probe: resolved.probe };
    const prepared = prepare(resolved.options, {}, false);
    const { key, outputPath, outputDirectory } = prepared;
    if (requested.has(outputPath) || generating.has(outputPath)) return { state: 'generating', key };
    const metadata = readMetadata(prepared);
    if (metadata && fs.existsSync(outputPath)) {
      const { durationSec, sampleRate, channels, bytes, format, frames, bytesPerSample } = metadata;
      return { state: 'ready', key, path: outputPath, durationSec, sampleRate, channels, bytes, format,
        ...(format === 'pcm-s16le' ? { frames, bytesPerSample } : {}) };
    }
    const noAudio = readCacheJson(path.join(outputDirectory, `${key}.no-audio.json`));
    if (noAudio?.key === key) return { state: 'no-audio', key, reason: noAudio.reason };
    const failed = readCacheJson(path.join(outputDirectory, `${key}.failed.json`));
    if (failed?.key === key && retryRemaining(failed) > 0) {
      return { state: 'failed', key, reason: failed.reason, retryAfterMs: retryRemaining(failed) };
    }
    return { state: fs.existsSync(outputPath) ? 'legacy' : 'missing', key };
  } catch (error) {
    return { state: 'invalid', reason: summarize(error?.message, 'invalid preview audio request') };
  }
}

export function subscribePreviewAudioSidecarEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitSidecarEvent(event) {
  for (const listener of [...listeners]) {
    try { listener(event); } catch (error) { console.warn('[preview-audio] listener failed', error); }
  }
}

export function requestPreviewAudioSidecar(options) {
  const status = previewAudioSidecarStatus(options);
  if (status.state === 'invalid') return status;
  const resolved = requestOptions(options);
  if (resolved.status) {
    if (!status.probe?.pending || probing.has(resolved.probePath)) return status;
    // Start after returning the declaration. The map is populated before any work runs.
    const pending = new Promise(resolve => setImmediate(resolve)).then(async () => {
      const probe = await probePreviewAudioSourceAsync(options.sourcePath, options);
      if (probe.ok) {
        writeCacheJson(resolved.probePath, probe);
        const result = requestPreviewAudioSidecar({ ...options, outSec: probe.durationSec });
        if (['ready', 'no-audio', 'failed', 'not-needed'].includes(result.state)) {
          emitSidecarEvent({ key: result.key, state: result.state, sourcePath: path.resolve(options.sourcePath),
            ...(result.state === 'ready'
              ? { path: result.path, durationSec: result.durationSec } : { reason: result.reason }) });
        }
      } else {
        const failureClass = classifyPreviewAudioFailure(probe.reason);
        writeCacheJson(resolved.probePath, {
          error: { class: failureClass, reason: probe.reason, createdAt: Date.now() },
        });
        // A failed probe settles the overall request; successful probes have no event.
        emitSidecarEvent({ key: null, state: failureClass === 'no-audio' ? 'no-audio' : 'failed',
          reason: probe.reason, sourcePath: path.resolve(options.sourcePath) });
      }
    }).catch(error => console.warn('[preview-audio] probe cache failed', error))
      .finally(() => probing.delete(resolved.probePath));
    probing.set(resolved.probePath, pending);
    return status;
  }
  if (status.state !== 'missing' && status.state !== 'legacy') return status;
  const prepared = prepare(resolved.options, {}, false);
  const pending = new Promise(resolve => setImmediate(resolve)).then(async () => {
    fs.rmSync(path.join(prepared.outputDirectory, `${prepared.key}.failed.json`), { force: true });
    const result = await ensurePreviewAudioSidecar(resolved.options);
    let state = 'ready';
    if (!result.ok) {
      state = classifyPreviewAudioFailure(result.reason) === 'no-audio' ? 'no-audio' : 'failed';
      writeCacheJson(path.join(prepared.outputDirectory, `${prepared.key}.${state}.json`), {
        key: prepared.key, reason: result.reason, createdAt: Date.now(),
        ...(state === 'failed' ? { retryAfterMs: FAILURE_RETRY_MS } : {}),
      });
    }
    return { key: prepared.key, state, sourcePath: prepared.sourcePath,
      ...(result.ok ? { path: result.path, durationSec: result.durationSec } : { reason: result.reason }) };
  }).catch(error => ({ key: prepared.key, state: 'failed', sourcePath: prepared.sourcePath,
    reason: summarize(error?.message, 'preview audio cache failed') }))
    .then(event => {
      requested.delete(prepared.outputPath);
      emitSidecarEvent(event);
    });
  requested.set(prepared.outputPath, pending);
  return { state: 'queued', key: prepared.key, ...(status.probe ? { probe: status.probe } : {}) };
}

export function ensurePreviewAudioSidecar(options) {
  const state = { outputPath: null, key: null };
  let prepared;
  try {
    prepared = prepare(options, state);
  } catch (error) {
    return Promise.resolve(failure(state.outputPath, state.key, error));
  }
  const joined = generating.get(prepared.outputPath);
  if (joined) return joined;
  const pending = generate(prepared, options)
    .catch(error => failure(prepared.outputPath, prepared.key, error));
  generating.set(prepared.outputPath, pending);
  void pending.finally(() => generating.delete(prepared.outputPath));
  return pending;
}

export function sweepPreviewAudioSidecars({ cacheDir, keepKeys, minAgeMs = 0, keepProbes }) {
  const kept = new Set(Array.from(keepKeys ?? [], value => String(value).replace(/\.(?:flac|pcm)$/u, '')));
  const keptProbes = new Set(Array.from(keepProbes ?? [], value =>
    String(value).replace(/^probe-/u, '').replace(/\.json$/u, '')));
  const outputDirectory = path.resolve(cacheDir, 'preview-audio');
  let removed = 0;
  let bytes = 0;
  try {
    for (const entry of fs.readdirSync(outputDirectory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      // 生成途中の一時ファイル（`.<key>.flac.<pid>.<ms>.tmp.flac`）も `.flac` で終わる。
      // ffmpeg が開いている最中に rm すると Windows は EPERM を投げ、以前はそれが
      // /api/summary まで抜けてサーバごと落ちた（実機 2026-09-05 14:25）。掃除の対象外にする。
      if (entry.name.startsWith('.') || /\.tmp\./u.test(entry.name)) continue;
      const match = /^(.*?)(?:\.flac|\.pcm|\.no-audio\.json|\.failed\.json|\.json)$/u.exec(entry.name);
      if (!match) continue;
      const key = match[1];
      const probingFile = key.startsWith('probe-');
      const outputPath = path.join(outputDirectory, `${key}.flac`);
      const pcmPath = path.join(outputDirectory, `${key}.pcm`);
      if ((!probingFile && kept.has(key)) || generating.has(outputPath)
        || generating.has(pcmPath) || requested.has(pcmPath)
        || (probingFile && keptProbes.has(key.slice('probe-'.length)))
        || requested.has(outputPath) || probing.has(path.join(outputDirectory, entry.name))) continue;
      const target = path.join(outputDirectory, entry.name);
      // 1 本消せないだけで掃除全体（ましてサーバ）を止めない。ロック中・消えた直後は次回に回す。
      try {
        const stat = fs.statSync(target);
        if (minAgeMs > 0 && Date.now() - stat.mtimeMs < minAgeMs) continue;
        fs.rmSync(target, { force: true });
        bytes += stat.size;
        removed += 1;
      } catch (error) {
        if (!['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      }
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
      try {
        const stat = fs.statSync(target);
        if (minAgeMs > 0 && Date.now() - stat.mtimeMs < minAgeMs) continue;
        fs.rmSync(target, { force: true });
        bytes += stat.size;
        removed += 1;
      } catch (error) {
        if (!['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes(error?.code)) throw error;
      }
    }
    if (fs.readdirSync(legacyDirectory).length === 0) fs.rmdirSync(legacyDirectory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return { removed, bytes };
}
