import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { resolveFfmpeg, resolveFfprobe } from './index.mjs';

export const PREVIEW_AUDIO_RECIPE = 'preview-audio-flac-v1';

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
    PREVIEW_AUDIO_RECIPE,
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
    const metadata = await probeAudioAsync(resolved, options.ffprobe ?? defaultFfprobe(), settingsFrom(options));
    return { ok: true, path: resolved, bytes: stat.size, ...metadata };
  } catch (error) {
    return probeFailure(sourcePath, error);
  }
}

// Validates the request and derives the cache key / output path. Deliberately synchronous:
// ensurePreviewAudioSidecar registers the in-flight promise right after this returns, so two
// concurrent requests for the same output path cannot both slip past the in-flight check.
function prepare(options, state) {
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
  };
  state.key = keyFor(sourcePath, stat, values);
  const outputDirectory = path.resolve(options.cacheDir, 'preview-audio');
  state.outputPath = path.join(outputDirectory, `${state.key}.flac`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  return {
    sourcePath,
    outputDirectory,
    outputPath: state.outputPath,
    key: state.key,
    startSec: Math.max(0, options.inSec - padBeforeSec),
    endSec: options.outSec + padAfterSec,
    speed: options.speed,
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
  const fromExisting = async () => {
    const metadata = await probeAudioAsync(outputPath, ffprobeOf(), settings);
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
  await acquireFileLock(lockPath);
  try {
    if (fs.existsSync(outputPath)) return fromExisting();
    const temporary = path.join(outputDirectory,
      `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp.flac`);
    try {
      const filters = [
        'asetpts=PTS-STARTPTS',
        ...buildAtempoChain(prepared.speed).map(factor => `atempo=${formatNumber(factor)}`),
      ];
      const ffmpeg = options.ffmpeg ?? resolveFfmpeg();
      const result = await ffmpegSlots.run(settings.concurrency.ffmpeg, () => runProcess(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-ss', formatNumber(prepared.startSec), '-to', formatNumber(prepared.endSec),
        '-i', sourcePath,
        '-map', '0:a:0', '-vn',
        '-af', filters.join(','),
        '-ar', '48000', '-c:a', 'flac', '-compression_level', '5',
        '-y', temporary,
      ], { timeoutMs: settings.timeoutMs.ffmpeg, maxBuffer: 16 * 1024 * 1024 }));
      if (result.error || result.status !== 0) {
        throw processFailure(result, 'ffmpeg failed to create the preview audio sidecar');
      }
      const outputStat = fs.statSync(temporary);
      if (!outputStat.isFile() || outputStat.size <= 42) {
        throw new Error('ffmpeg created an empty preview audio sidecar');
      }
      const metadata = await probeAudioAsync(temporary, ffprobeOf(), settings);
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
}

// In-flight generations keyed by output path: concurrent requests that resolve to the same
// sidecar share one promise (and one ffmpeg). The entry is dropped as soon as it settles, so a
// later request finds the finished file and takes the "already exists → reuse" path.
const generating = new Map();

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
