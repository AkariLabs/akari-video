import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveFfmpeg } from './index.mjs';

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

// ffmpeg atempo accepts factors in [0.5, 2.0]. Keep this as the single definition used by
// preview sidecars and render-cut so both surfaces decompose every speed identically.
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
      throw new Error(`speech atempo lock timed out: ${lockPath}`);
    }
    Atomics.wait(waitArray, 0, 0, 100);
  }
}

function outputKey(sourcePath, stat, inSec, outSec, speed, chain) {
  return crypto.createHash('sha1').update([
    sourcePath,
    stat.size,
    stat.mtimeMs,
    formatNumber(inSec),
    formatNumber(outSec),
    formatNumber(speed),
    chain.map(formatNumber).join(','),
  ].join('|')).digest('hex');
}

function ensureSpeechAtempoSync(options) {
  let outputPath = null;
  try {
    if (!options || typeof options.sourcePath !== 'string' || !options.sourcePath) {
      throw new Error('sourcePath is required');
    }
    if (!finiteNonNegative(options.inSec) || !finitePositive(options.outSec)
      || options.outSec <= options.inSec || !finitePositive(options.speed)) {
      throw new Error('inSec, outSec, and speed must describe a positive source range');
    }
    if (typeof options.cacheDir !== 'string' || !options.cacheDir) {
      throw new Error('cacheDir is required');
    }
    const sourcePath = path.resolve(options.sourcePath);
    const stat = fs.statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`source is not a regular file: ${sourcePath}`);
    const chain = buildAtempoChain(options.speed);
    const outputDirectory = path.resolve(options.cacheDir, 'speech-atempo');
    outputPath = path.join(outputDirectory,
      `${outputKey(sourcePath, stat, options.inSec, options.outSec, options.speed, chain)}.wav`);
    fs.mkdirSync(outputDirectory, { recursive: true });
    if (fs.existsSync(outputPath)) {
      return {
        ok: true,
        skipped: true,
        path: outputPath,
        durationSec: (options.outSec - options.inSec) / options.speed,
        reason: null,
      };
    }
    const lockPath = `${outputPath}.lock`;
    acquireFileLock(lockPath);
    try {
      if (fs.existsSync(outputPath)) {
        return {
          ok: true,
          skipped: true,
          path: outputPath,
          durationSec: (options.outSec - options.inSec) / options.speed,
          reason: null,
        };
      }
      const temporary = path.join(outputDirectory,
        `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp.wav`);
      try {
        const filters = ['asetpts=PTS-STARTPTS', ...chain.map(factor => `atempo=${formatNumber(factor)}`)];
        const result = spawnSync(options.ffmpeg ?? resolveFfmpeg(), [
          '-hide_banner', '-nostdin', '-loglevel', 'error',
          '-ss', formatNumber(options.inSec), '-to', formatNumber(options.outSec),
          '-i', sourcePath,
          '-map', '0:a:0', '-vn',
          '-af', filters.join(','),
          '-ar', '48000', '-c:a', 'pcm_s16le', '-y', temporary,
        ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (result.error || result.status !== 0) {
          throw new Error(summarize(result.stderr || result.error?.message,
            'ffmpeg failed to create the speech atempo sidecar'));
        }
        const outputStat = fs.statSync(temporary);
        if (!outputStat.isFile() || outputStat.size <= 44) {
          throw new Error('ffmpeg created an empty speech atempo sidecar');
        }
        fs.renameSync(temporary, outputPath);
      } finally {
        for (const name of fs.readdirSync(outputDirectory)) {
          if (name.startsWith(`.${path.basename(outputPath)}.${process.pid}.`) && name.endsWith('.tmp.wav')) {
            fs.rmSync(path.join(outputDirectory, name), { force: true });
          }
        }
      }
      return {
        ok: true,
        skipped: false,
        path: outputPath,
        durationSec: (options.outSec - options.inSec) / options.speed,
        reason: null,
      };
    } finally {
      fs.rmSync(lockPath, { recursive: true, force: true });
    }
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      path: outputPath,
      durationSec: 0,
      reason: summarize(error?.message, 'speech atempo sidecar generation failed'),
    };
  }
}

export function ensureSpeechAtempo(options) {
  const key = options && typeof options.sourcePath === 'string'
    ? [path.resolve(options.sourcePath), options.inSec, options.outSec, options.speed,
      path.resolve(String(options.cacheDir ?? ''))].join('\0')
    : JSON.stringify(options);
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = Promise.resolve().then(() => ensureSpeechAtempoSync(options));
  inFlight.set(key, pending);
  void pending.finally(() => inFlight.delete(key));
  return pending;
}
