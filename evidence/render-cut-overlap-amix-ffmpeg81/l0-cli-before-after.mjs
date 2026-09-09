#!/usr/bin/env node
/**
 * L0 の A/B 証跡 — 重なりトラックのプロジェクトを render-cut CLI に通し、
 * 修正前（`git show <base>:packages/render-cut/src/plan.mjs`）と修正後で
 * 書き出しが失敗 → 成功に変わることと、単一トラック / 既に通っていた gap-aware amix の
 * 出力が byte 一致で不変であることを実測する。
 *
 * 修正前ソースは worktree を汚さないよう、一時ディレクトリに
 * 「render-cut だけ実体コピー・他パッケージは symlink」のスクラッチ木を組んで走らせる。
 *
 * 検証専用スクリプト（製品コードではない）。
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const FFMPEG = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const FFPROBE = path.join(repoRoot, 'packages/media-bin/vendor/darwin-arm64/ffprobe');
const BASE = process.argv[2] ?? 'HEAD';

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'render-cut-amix-ab-')));
const scratch = path.join(work, 'prefix-tree');

// --- 修正前ソースのスクラッチ木 -------------------------------------------------
fs.mkdirSync(path.join(scratch, 'packages'), { recursive: true });
for (const name of fs.readdirSync(path.join(repoRoot, 'packages'))) {
  if (name === 'render-cut') continue;
  fs.symlinkSync(path.join(repoRoot, 'packages', name), path.join(scratch, 'packages', name));
}
fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(scratch, 'node_modules'));
const scratchRenderCut = path.join(scratch, 'packages', 'render-cut');
fs.mkdirSync(scratchRenderCut, { recursive: true });
fs.cpSync(path.join(repoRoot, 'packages/render-cut/src'), path.join(scratchRenderCut, 'src'), { recursive: true });
fs.cpSync(path.join(repoRoot, 'packages/render-cut/bin'), path.join(scratchRenderCut, 'bin'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'packages/render-cut/package.json'), path.join(scratchRenderCut, 'package.json'));
fs.writeFileSync(
  path.join(scratchRenderCut, 'src/plan.mjs'),
  execFileSync('git', ['-C', repoRoot, 'show', `${BASE}:packages/render-cut/src/plan.mjs`], { maxBuffer: 1 << 28 }),
);

const CLI_AFTER = path.join(repoRoot, 'packages/render-cut/bin/render-cut.mjs');
const CLI_BEFORE = path.join(scratchRenderCut, 'bin/render-cut.mjs');

const ffmpeg = (args) => {
  const result = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
};
const sha256 = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const probeDuration = (file) => {
  const out = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { encoding: 'utf8' }).stdout.trim();
  return out ? Number(out) : null;
};
const render = (cli, projectRoot, outName) => {
  const result = spawnSync(process.execPath, [cli, projectRoot, '--out', outName, '--force'], { encoding: 'utf8' });
  const lines = `${result.stdout}${result.stderr}`.trim().split('\n');
  return { exitCode: result.status, lastLine: lines[lines.length - 1] ?? '' };
};

const makeProject = (name, editDoc, tone = 'aevalsrc=0.5*sin(2*PI*(300+100*floor(t))*t):d=10:s=48000') => {
  const root = path.join(work, name);
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  const wav = path.join(root, 'source.wav');
  ffmpeg(['-f', 'lavfi', '-i', tone, '-ac', '1', wav]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x203040:s=320x180:r=30:d=10', '-i', wav,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
    '-shortest', path.join(root, 'assets/source.mp4')]);
  fs.writeFileSync(path.join(root, 'edit.json'), `${JSON.stringify(editDoc, null, 2)}\n`);
  return root;
};

const visual = (id, items) => ({ id, lane: 'visual', items });
const media = (src, inSec, outSec) => ({ kind: 'media', src, in: inSec, out: outSec });
const base = { version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'main', path: 'assets/source.mp4' }] };

const report = {
  base: execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', BASE], { encoding: 'utf8' }).trim(),
  ffmpeg: spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' }).stdout.split('\n')[0],
  cases: {},
};

// --- (1) 重なりトラック（同じ動画を V1 / V2 に重ねる） -------
{
  const root = makeProject('overlap', { ...base, tracks: [
    visual('visual-upper', [{ id: 'upper', at: 60, duration: 120, source: media('main', 6, 10) }]),
    visual('visual-lower', [{ id: 'lower', at: 0, duration: 180, source: media('main', 0, 6) }]),
  ] });
  const before = render(CLI_BEFORE, root, 'before.mp4');
  const after = render(CLI_AFTER, root, 'after.mp4');
  report.cases.overlappedTracks = {
    before: { ...before, outputExists: fs.existsSync(path.join(root, 'before.mp4')) },
    after: {
      ...after,
      outputExists: fs.existsSync(path.join(root, 'after.mp4')),
      duration: fs.existsSync(path.join(root, 'after.mp4')) ? probeDuration(path.join(root, 'after.mp4')) : null,
    },
  };
}

// --- (2) 単一トラック・連続カット（gap-aware に入らない既存経路） ------------------
{
  const root = makeProject('sequential', { ...base, tracks: [
    visual('v1', [
      { id: 'c1', at: 0, duration: 90, source: media('main', 0.7, 3.7) },
      { id: 'c2', at: 90, duration: 90, source: media('main', 5, 8) },
    ]),
  ] });
  render(CLI_BEFORE, root, 'before.mp4');
  render(CLI_AFTER, root, 'after.mp4');
  report.cases.singleTrackSequential = {
    beforeSha256: sha256(path.join(root, 'before.mp4')),
    afterSha256: sha256(path.join(root, 'after.mp4')),
    byteIdentical: sha256(path.join(root, 'before.mp4')) === sha256(path.join(root, 'after.mp4')),
  };
}

// --- (3) 単一トラック・隙間あり（gap-aware amix に入るが修正前でも通っていた経路） ---
{
  const root = makeProject('gap', { ...base, tracks: [
    visual('v1', [
      { id: 'c1', at: 0, duration: 90, source: media('main', 0.7, 3.7) },
      { id: 'c2', at: 120, duration: 90, source: media('main', 5, 8) },
    ]),
  ] });
  render(CLI_BEFORE, root, 'before.mp4');
  render(CLI_AFTER, root, 'after.mp4');
  report.cases.singleTrackWithGapAmix = {
    beforeSha256: sha256(path.join(root, 'before.mp4')),
    afterSha256: sha256(path.join(root, 'after.mp4')),
    byteIdentical: sha256(path.join(root, 'before.mp4')) === sha256(path.join(root, 'after.mp4')),
  };
}

const scrub = (value) => value
  .split(repoRoot).join('<WORKTREE>')
  .split(work).join('<TMP>')
  .split(fs.realpathSync(os.tmpdir())).join('<TMP>')
  .split(os.tmpdir()).join('<TMP>')
  .split(os.homedir()).join('<HOME>');
fs.writeFileSync(path.join(here, 'l0-cli-before-after.json'), `${scrub(JSON.stringify(report, null, 2))}\n`);
console.log(scrub(JSON.stringify(report, null, 2)));
fs.rmSync(work, { recursive: true, force: true });

const ok = report.cases.overlappedTracks.before.exitCode !== 0
  && report.cases.overlappedTracks.after.exitCode === 0
  && report.cases.singleTrackSequential.byteIdentical
  && report.cases.singleTrackWithGapAmix.byteIdentical;
if (!ok) { console.error('A/B expectation not met'); process.exit(1); }
console.log('A/B OK');
