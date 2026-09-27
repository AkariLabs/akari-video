// (4) 書き出し（OSR）で折り返し幅・字間が効くかの確認（検証専用・ラッパー作成）。
// fixture（字幕 / 置いた文字 × 低い / 高い）を 3 通りで render-cut --engine osr に通し、各字幕の時刻のフレームで
// 白い文字の画素の外接矩形（幅・高さ）を測る:
//   base   : そのまま
//   wrap25 : 全部の字幕に wrap_width_pct 25
//   ls03   : 全部の字幕に letter_spacing_em 0.3
// launcher_tier を記録する（tier 1/2 = Electron の OSR。3 = 旧経路へのフォールバック）。
// 使い方: node export-osr.mjs <出力 dir> [--repo <リポ直下>] [--label <名前>] [--variants base,wrap25,ls03]
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const repo = path.resolve(arg('repo', path.resolve(here, '../../../../../../..')));
const label = arg('label', 'after');
const outDir = path.resolve(process.argv[2] ?? path.join(here, 'export'));
const variants = arg('variants', 'base,wrap25,ls03').split(',');
await mkdir(outDir, { recursive: true });
const { default: fixture, CASES } = await import(pathToFileURL(path.join(here, 'fixture.mjs')).href);

function inkBox(file, W, H) {
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
  let l = W, r = -1, t = H, b = -1, n = 0;
  const rows = new Set();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    if (raw.stdout[i] > 235 && raw.stdout[i + 1] > 235 && raw.stdout[i + 2] > 235) { n++; if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y; rows.add(y); }
  }
  // 行の数 = 白い画素のある行の連なり（すき間 ≥ 4px で区切る）
  const ys = [...rows].sort((a, c) => a - c);
  let bands = ys.length ? 1 : 0;
  for (let k = 1; k < ys.length; k++) if (ys[k] - ys[k - 1] > 4) bands++;
  return n ? { left: l, right: r, top: t, bottom: b, width: r - l + 1, height: b - t + 1, pixels: n, bands } : { pixels: 0 };
}

const results = { label, variants: {} };
for (const variant of variants) {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `caption-wrap-width-check-export-${label}-${variant}-`)));
  const project = path.join(scratch, 'project');
  await mkdir(project, { recursive: true });
  const editPath = path.join(project, 'edit.json');
  await fixture({ project, editPath, seconds: 8 });
  const capPath = path.join(project, 'captions.json');
  const cap = JSON.parse(await readFile(capPath, 'utf8'));
  for (const c of cap.captions) {
    if (variant === 'wrap25') c.text_style = { ...(c.text_style ?? {}), wrap_width_pct: 25 };
    if (variant === 'ls03') c.text_style = { ...(c.text_style ?? {}), letter_spacing_em: 0.3 };
  }
  await writeFile(capPath, `${JSON.stringify(cap, null, 2)}\n`);
  const out = path.join(project, 'exports', 'out.mp4');
  const started = Date.now();
  const render = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', 'osr', '--force', '--no-verify-blank', '--out', out],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
      env: { ...process.env, AKARI_HOME: path.join(scratch, 'akari-home'), AKARI_EXPORT_ALLOW_DESKTOP: '0' } });
  const result = { exit: render.status, seconds: Math.round((Date.now() - started) / 1000) };
  if (render.status !== 0) result.stderr = (render.stderr || render.stdout).slice(-1500);
  else {
    const rj = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
    result.engine = rj.provenance?.engine ?? rj.engine ?? null;
    const find = (value, key) => { if (!value || typeof value !== 'object') return undefined; if (key in value) return value[key];
      for (const child of Object.values(value)) { const hit = find(child, key); if (hit !== undefined) return hit; } return undefined; };
    result.osrLauncherTier = find(rj, 'launcher_tier') ?? null;
    result.fallbackWarning = /フォールバック|fallback/i.test(`${render.stderr}\n${render.stdout}`);
    result.frames = {};
    for (const c of CASES) {
      const png = path.join(outDir, `${label}-osr-${variant}-${c.key}.png`);
      spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', String(c.at), '-i', out, '-frames:v', '1', png]);
      result.frames[c.key] = { png: path.basename(png), ink: inkBox(png, 1920, 1080) };
    }
  }
  results.variants[variant] = result;
  await rm(scratch, { recursive: true, force: true });
  console.log(variant, JSON.stringify(result).slice(0, 600));
}
const scrub = text => text.replace(/\/(?:private|tmp|Users|var)\/[^\s):"]+/g, '<path>');
await writeFile(path.join(outDir, `${label}-osr.json`), `${scrub(JSON.stringify(results, null, 2))}\n`);
