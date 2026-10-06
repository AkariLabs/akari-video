#!/usr/bin/env node
// Render one generated fixture, then compare each animated cue with its still twin.
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordsDir } from './records.mjs';
import { neutralCheck, neutralPass } from './neutral-checks.mjs';
import { isCaptionMotionSupported } from '../../../../../../../packages/gpu-export/src/eligibility.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../../');
const root = path.resolve(process.argv[2] || '');
const variant = process.argv[3];
const engine = process.argv[4];
if (!process.argv[2] || !root.includes('tl-caption-motion-render') || !['legacy', 'policy'].includes(variant) || !['osr', 'auto'].includes(engine)) throw new Error('usage: run-export.mjs <dedicated fixture> legacy|policy osr|auto');
const project = path.join(root, variant, 'project');
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json')));
const resultName = `export-${variant}-${engine}-${manifest.label ? `${manifest.label}-` : ''}${manifest.chunkStart ?? 0}.json`;
const resultDir = recordsDir;
const output = path.join(project, 'exports', `tl-caption-motion-render-${variant}-${engine}.mp4`);
await mkdir(resultDir, { recursive: true });
await mkdir(path.dirname(output), { recursive: true });
const isolation = path.join(root, `tl-caption-motion-render-export-${variant}-${engine}`);
await mkdir(isolation, { recursive: true });
const safe = message => String(message || '').replace(/\/(?:Users|private|var|tmp)\/[^\s)'"`]+/gu, '<machine-path>').slice(-3000);
const compareOnly = process.argv.includes('--compare-only');
if (compareOnly) await stat(output);
const render = compareOnly ? { status: 0, stderr: '' } : spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project, '--force', '--no-verify-blank', '--engine', engine, '--out', output], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 7200000,
  env: { ...process.env, AKARI_HOME: path.join(isolation, 'akari-home'), THEIA_CONFIG_DIR: path.join(isolation, 'theia-config'), TMPDIR: isolation }
});
const result = { variant, engine, renderExit: render.status, renderError: render.status === 0 ? null : safe(render.stderr), rows: [] };
if (render.status === 0) {
  const readFrame = t => {
    const frame = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', t.toFixed(3), '-i', output, '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 320 * 180 * 3 + 1024 });
    if (frame.status !== 0) throw new Error(safe(frame.stderr));
    return frame.stdout;
  };
  const compare = (a, b) => {
    let sum = 0, changed = 0;
    const baseA = a.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
    const baseB = b.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
    for (let i = 320 * 90 * 3; i < a.length; i += 3) {
      const d = Math.max(Math.abs((a[i] - baseA[0]) - (b[i] - baseB[0])),
        Math.abs((a[i + 1] - baseA[1]) - (b[i + 1] - baseB[1])),
        Math.abs((a[i + 2] - baseA[2]) - (b[i + 2] - baseB[2])));
      sum += d; if (d > 12) changed++;
    }
    return { mean: sum / (320 * 90), changed };
  };
  const inkPixels = rgb => {
    const base = rgb.subarray(320 * 100 * 3, 320 * 100 * 3 + 3);
    let count = 0;
    for (let i = 320 * 90 * 3; i < rgb.length; i += 3) {
      if (Math.max(Math.abs(rgb[i] - base[0]), Math.abs(rgb[i + 1] - base[1]),
        Math.abs(rgb[i + 2] - base[2])) > 35) count++;
    }
    return count;
  };
  for (const [index, row] of manifest.rows.entries()) {
    const slots = Object.keys(row.animation);
    const checks = [];
    for (const slot of slots) {
      const offset = { in: .3, loop: 1.5, out: 2.7 }[slot];
      const a = readFrame(index * 6 + offset);
      const b = readFrame(index * 6 + 3 + offset);
      const pixels = compare(a, b);
      checks.push({ slot, offset, ...pixels, pass: pixels.changed > 20 && pixels.mean > .08 });
    }
    const neutral = neutralCheck(row);
    const neutralResult = neutral.included ? {
      ...neutral, ...compare(readFrame(index * 6 + neutral.offset), readFrame(index * 6 + 3 + neutral.offset))
    } : neutral;
    if (neutralResult.included) neutralResult.pass = neutralPass(neutralResult);
    const item = { key: row.key, checks, neutral: neutralResult,
      pass: checks.every(check => check.pass) && (!neutralResult.included || neutralResult.pass) };
    if (row.key === 'rich:typewriter') {
      const halfInk = inkPixels(readFrame(index * 6 + .7));
      const fullInk = inkPixels(readFrame(index * 6 + 1.5));
      const ratio = fullInk ? halfInk / fullInk : null;
      item.richHalf = { halfInk, fullInk, ratio, pass: ratio !== null && ratio >= .3 && ratio <= .7 };
      item.pass &&= item.richHalf.pass;
      if (engine === 'osr') {
        for (const [offset, label] of [[.7, '50'], [1.5, 'final'], [4.5, 'control-final']]) {
          const name = `rich-typewriter-osr-${variant}-${label}.png`;
          const frame = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-ss', String(index * 6 + offset), '-i', output, '-frames:v', '1', path.join(resultDir, name)]);
          if (frame.status !== 0) throw new Error(`failed to extract ${name}: ${safe(frame.stderr)}`);
        }
      }
    }
    result.rows.push(item);
  }
  if (manifest.chunkStart === 0 && manifest.rows[1]?.key === 'owner:typewriter') {
    const delta = compare(readFrame(7.7), readFrame(10.7));
    result.typewriterFinal = { ...delta, pass: delta.changed <= 30 && delta.mean <= .7 };
  }
  const receipt = JSON.parse(await readFile(path.join(project, '.akari/render.json')));
  result.selectedEngine = receipt.provenance?.engine ?? receipt.engine ?? null;
  if (engine === 'auto') for (const item of result.rows) {
    const animation = manifest.rows.find(row => row.key === item.key).animation;
    const unsupported = isCaptionMotionSupported(animation).unsupported;
    item.autoReasonJa = unsupported.length
      ? unsupported.map(id => id === 'typewriter' ? '文字送りは OSR で書き出します'
        : `動き「${id}」は GPU 非対応のため OSR で書き出します`).join('、')
      : 'GPU 適格のため GPU で書き出します';
  }
  // A frozen 50% entrance frame is kept for visual inspection of whole graphemes.
  if (variant === 'legacy' && engine === 'osr' && manifest.chunkStart === 0) {
    for (const [time, name] of [['6.7', 'typewriter-osr-50.png'], ['7.7', 'typewriter-osr-final.png'], ['10.7', 'typewriter-osr-control-final.png']]) {
      const frame = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', time, '-i', output, '-frames:v', '1', path.join(resultDir, name)]);
      if (frame.status !== 0) throw new Error(`failed to extract ${name}: ${safe(frame.stderr)}`);
    }
  }
}
await writeFile(path.join(resultDir, resultName), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ variant, engine, renderExit: result.renderExit, passes: result.rows.filter(row => row.pass).length, rows: result.rows.length }));
if (render.status !== 0 || result.typewriterFinal?.pass === false || result.rows.some(row => !row.pass)) process.exitCode = 1;
