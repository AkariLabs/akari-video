#!/usr/bin/env node
// L2（書き出し側の合致・検証スクリプト・ラッパー作成）— task 2026-09-12-preview-caption-handles
// L1 が実機で書いた captions.json（runs/ws）をそのまま入力に、
//   (1) render-cut CLI の `--plan-only` が exit 0 で計画を作れる
//   (2) render-cut の字幕オーバーレイ生成（generateResolvedCaptionOverlays）が
//       text_style.scale / rotate をそのまま overlay.transform へ載せる
//   (3) OSR ラスタライザの HTML（renderOverlaySheet）の字幕コンテナに
//       --scale / --rotate が同じ値で出る（= 焼き込みの transform に効く）
//   (4) GPU 書き出しのスプライト root にも同じ transform 規則が出る
// を確かめる。出力は results-l2.json。
import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const WS = path.join(ROOT, 'runs', 'ws');
const RESULTS = path.join(ROOT, 'results-l2.json');
const out = { status: 'running', checks: [] };

const sanitizeText = value => {
  let text = String(value);
  text = text.replaceAll(REPO, '<WORKTREE>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text.replace(/\/(?:private\/)?(?:tmp|var\/folders)\/[^\s)'"\]]+/gu, '<TMP>')
    .replace(/\/Users\/[^\s)'"\]]+/gu, '<HOME>');
};
const save = async () => {
  const temporary = `${RESULTS}.tmp-${process.pid}`;
  await writeFile(temporary, `${sanitizeText(JSON.stringify(out, null, 2))}\n`);
  await rename(temporary, RESULTS);
};
const check = (name, ok, detail) => {
  out.checks.push({ name, ok, detail });
  if (!ok) out.status = 'fail';
};
const run = (command, args) => new Promise(resolve => {
  const child = spawn(command, args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.once('close', code => resolve({ code, stdout, stderr }));
});

const { resolveCaptionDisplay, readInternalEdit, projectLegacyEdit, toAnchorCaptions } =
  await import(pathToFileURL(path.join(REPO, 'packages/edit-store/lib/index.js')).href);
const { generateResolvedCaptionOverlays } =
  await import(pathToFileURL(path.join(REPO, 'packages/render-cut/src/captions.mjs')).href);
const { renderOverlaySheet } =
  await import(pathToFileURL(path.join(REPO, 'packages/render-cut/src/rasterize.mjs')).href);
const { buildGpuPage } =
  await import(pathToFileURL(path.join(REPO, 'packages/gpu-export/src/page-builder.mjs')).href);

const captionsRoot = JSON.parse(await readFile(path.join(WS, 'captions.json'), 'utf8'));
const rawEdit = JSON.parse(await readFile(path.join(WS, 'edit.json'), 'utf8'));
const written = Object.fromEntries(captionsRoot.captions
  .filter(caption => caption.text_style)
  .map(caption => [caption.id, caption.text_style]));
out.writtenTextStyles = written;
await save();

// (1) CLI --plan-only
const cli = await run(process.execPath, [path.join(REPO, 'packages/render-cut/bin/render-cut.mjs'), WS, '--plan-only']);
check('render-cut --plan-only が exit 0', cli.code === 0, { code: cli.code, stdout: cli.stdout.trim().slice(0, 200) });

// (2) 字幕オーバーレイの transform
const internal = readInternalEdit(rawEdit, { captions: toAnchorCaptions(captionsRoot) });
const legacy = projectLegacyEdit(internal);
const resolved = resolveCaptionDisplay(captionsRoot, { output: rawEdit.output, cuts: legacy.cuts }, { output: rawEdit.output });
const overlays = generateResolvedCaptionOverlays(resolved);
const byCue = new Map();
for (const overlay of overlays) byCue.set(overlay.sourceCueId, overlay.transform);
out.overlayTransforms = Object.fromEntries(byCue);
for (const [captionId, style] of Object.entries(written)) {
  const transform = byCue.get(captionId);
  check(`${captionId} の overlay.transform が text_style と一致`,
    Boolean(transform) && transform.scale === (style.scale ?? 1) && transform.rotate === (style.rotate ?? 0),
    { expected: { scale: style.scale ?? 1, rotate: style.rotate ?? 0 }, actual: transform });
}

// (3) OSR ラスタライザ HTML の --scale / --rotate
const sheet = renderOverlaySheet({
  overlays, edit: { ...rawEdit, output: rawEdit.output }, projectRoot: WS,
  duration: resolved.display_cues.at(-1).end
});
const containers = [...String(sheet).matchAll(/<div class="akari-overlay-container[^>]*style="([^"]*)"/gu)].map(match => match[1]);
out.overlayContainerStyles = containers.slice(0, 8);
for (const [captionId, style] of Object.entries(written)) {
  const scale = String(style.scale ?? 1);
  const rotate = `${style.rotate ?? 0}deg`;
  const hit = containers.some(value => value.includes(`--scale:${scale}`) && value.includes(`--rotate:${rotate}`));
  check(`${captionId} の --scale:${scale} / --rotate:${rotate} が焼き込み HTML のコンテナに出る`, hit,
    { scale, rotate, containers: containers.slice(0, 4) });
}
check('.akari-overlay-container の transform が --scale / --rotate を読む',
  String(sheet).includes('transform: translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg))'), {});

// (4) GPU スプライト root の transform 規則
const gpu = buildGpuPage({
  edit: { version: 2, output: rawEdit.output, sources: [], cuts: [], overlays: [] },
  captions: captionsRoot.captions, projectRoot: WS, duration: 8
});
const roots = String(gpu.html).match(/class="akari-sprite-root"[^>]*/gu) ?? [];
const gpuTransform = 'transform:translate(var(--x, 0px), var(--y, 0px)) scale(var(--scale, 1)) rotate(var(--rotate, 0deg));transform-origin:center;';
check('GPU の字幕スプライト root にも同じ transform 規則が出る',
  roots.length > 0 && roots.every(root => root.includes(gpuTransform)), { roots: roots.length });

if (out.status === 'running') out.status = 'pass';
await save();
process.stdout.write(`${out.status}\n`);
process.exitCode = out.status === 'pass' ? 0 : 1;
