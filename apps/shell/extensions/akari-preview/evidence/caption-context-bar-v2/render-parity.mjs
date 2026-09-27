#!/usr/bin/env node
// L1（検証専用）: 字幕の文字スタイルの項目が書き出し（OSR / GPU）で描かれるかを、同じ時刻のフレームで確かめる。
// fixtures/<captions>（既定 captions-props.json）の字幕 1 つ = 1 秒。各字幕の中央の時刻（i + 0.5 秒）のフレームを
// 書き出しから抜き、<out>/<label>-<engine>-<id>.png に置く。下地は単色の静止画（H.264 のデコードに頼らない）。
//
// 使い方: node render-parity.mjs --label before|after [--engines osr,gpu] [--captions captions-props.json] [--out <dir>]
// ffmpeg は検証にだけ使う（テストでは使わない）。GPU は AKARI_EXPORT_ALLOW_DESKTOP=0 で worktree の Electron（tier 2）を使う。

import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const label = arg('label', 'run');
const engines = arg('engines', 'osr,gpu').split(',').filter(Boolean);
const captionsFile = arg('captions', 'captions-props.json');
const outDir = path.resolve(arg('out', path.join(here, label)));
await mkdir(outDir, { recursive: true });

const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `2026-09-27-caption-context-bar-v2-render-${label}-`)));
const project = path.join(scratch, 'project');
await cp(path.join(repo, 'templates/project-default'), project, { recursive: true });
await mkdir(path.join(project, 'assets'), { recursive: true });
const ff = (args) => { const r = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
ff(['-f', 'lavfi', '-i', 'color=c=0x9ca3af:s=1920x1080', '-frames:v', '1', path.join(project, 'assets', 'base.png')]);
const captions = JSON.parse(await readFile(path.join(here, 'fixtures', captionsFile), 'utf8'));
const duration = Math.max(...captions.captions.map(c => c.end));
const edit = {
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'base', path: 'assets/base.png' }],
  tracks: [
    { id: 'v-main', lane: 'visual', name: '本編', items: [{ id: 'cut-1', at: 0, duration: duration * 30, source: { kind: 'media', src: 'base', in: 0, out: duration } }] },
    { id: 'v-text', lane: 'visual', name: 'text', items: [{ id: 'captions', name: '字幕', at: 0, duration: duration * 30, source: { kind: 'captions', path: 'captions.json' }, items: [] }] }
  ]
};
await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
await copyFile(path.join(here, 'fixtures', captionsFile), path.join(project, 'captions.json'));

const lint = spawnSync(process.execPath, [path.join(repo, 'packages/edit-lint/bin/edit-lint.mjs'), project], { encoding: 'utf8', cwd: project });
const report = { label, engines: {}, lint: { status: lint.status, tail: (lint.stdout + lint.stderr).split('\n').filter(Boolean).slice(-6) } };

for (const engine of engines) {
  await mkdir(path.join(project, 'exports'), { recursive: true });
  const out = path.join(project, 'exports', `${engine}.mp4`);
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', engine, '--out', out, '--force'],
    { encoding: 'utf8', cwd: project, env: { ...process.env, AKARI_EXPORT_ALLOW_DESKTOP: '0' }, maxBuffer: 64 * 1024 * 1024 });
  const entry = { status: r.status, seconds: Math.round((Date.now() - started) / 100) / 10, tail: (r.stdout + r.stderr).split('\n').filter(Boolean).slice(-8) };
  try {
    const dir = path.join(project, '.akari', 'reports', 'render-receipts');
    const { readdir, stat } = await import('node:fs/promises');
    const files = await Promise.all((await readdir(dir)).map(async name => ({ name, at: (await stat(path.join(dir, name))).mtimeMs })));
    files.sort((a, b) => b.at - a.at);
    const receipt = JSON.parse(await readFile(path.join(dir, files[0].name), 'utf8'));
    const p = receipt?.provenance ?? {};
    entry.provenance = { engine: p.engine ?? null, osrTier: p.osr?.provenance?.launcher_tier ?? p.osr?.launcher_tier ?? null, gpuTier: p.gpu?.provenance?.launcher_tier ?? p.gpu?.launcher_tier ?? null, keys: Object.keys(p) };
  } catch (error) { entry.provenance = { error: String(error).slice(0, 200) }; }
  entry.frames = [];
  if (r.status === 0) {
    for (const cue of captions.captions) {
      const t = cue.start + (cue.end - cue.start) / 2;
      const file = `${label}-${engine}-${cue.id}.png`;
      ff(['-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=960:-1', path.join(outDir, file)]);
      entry.frames.push({ id: cue.id, t, file });
    }
  }
  report.engines[engine] = entry;
}
const scrub = s => s.replace(/\/(?:private|tmp|Users|var)\/[^\s):"]+/g, '<path>');
await writeFile(path.join(outDir, `${label}-render.json`), `${scrub(JSON.stringify(report, null, 2))}\n`);
console.log(scrub(JSON.stringify(report, null, 2)));
if (!process.argv.includes('--keep')) await rm(scratch, { recursive: true, force: true }); else console.log('kept', scratch);
