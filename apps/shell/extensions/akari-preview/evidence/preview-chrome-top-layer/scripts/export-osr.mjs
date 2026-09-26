// (f) 書き出し（OSR）に UI 層が写らないことの確認（検証専用・ラッパー作成）。
// fixture を 3 秒に縮めて render-cut --engine osr で書き出し、1 秒のフレームを PNG に落として、
// 選択枠の色（#4da3ff）とガイドの色（#ff8b2c）に近い画素を数える。launcher_tier も記録する。
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../../..');
const orient = process.argv[2] ?? 'landscape';
const outDir = path.resolve(process.argv[3] ?? path.join(here, 'export'));
await mkdir(outDir, { recursive: true });
const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), `2026-09-26-preview-chrome-top-layer-export-${orient}-`)));
const project = path.join(scratch, 'project');
await mkdir(project, { recursive: true });
const editPath = path.join(project, 'edit.json');
const fx = (await import(pathToFileURL(path.join(here, 'fixture.mjs')).href)).default;
await fx({ project, repo, orient, editPath });
const edit = JSON.parse(await readFile(editPath, 'utf8'));
for (const track of edit.tracks) for (const item of track.items) {
  item.duration = 3 * edit.output.fps;
  if (item.source.kind === 'media') item.source.out = 3;
  if (item.keyframes) item.keyframes = [{ t: 0, transform: { scale: 0.35 } }, { t: 89, transform: { scale: 0.55 } }];
}
await writeFile(editPath, `${JSON.stringify(edit, null, 2)}\n`);
const cap = JSON.parse(await readFile(path.join(project, 'captions.json'), 'utf8'));
for (const c of cap.captions) c.end = 3;
await writeFile(path.join(project, 'captions.json'), `${JSON.stringify(cap, null, 2)}\n`);
const out = path.join(project, 'exports', 'out.mp4');
const started = Date.now();
const render = spawnSync(process.execPath, [path.join(repo, 'packages/render-cut/bin/render-cut.mjs'), project, '--engine', 'osr', '--force', '--no-verify-blank', '--out', out],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL', env: { ...process.env, AKARI_HOME: path.join(scratch, 'akari-home'), AKARI_EXPORT_ALLOW_DESKTOP: '0' } });
const seconds = Math.round((Date.now() - started) / 1000);
const result = { orient, exit: render.status, seconds };
if (render.status !== 0) { result.stderr = (render.stderr || render.stdout).slice(-1500); }
else {
  const rj = JSON.parse(await readFile(path.join(project, '.akari', 'render.json'), 'utf8'));
  result.engine = rj.provenance?.engine ?? rj.engine ?? null;
  result.osrLauncherTier = rj.provenance?.osr?.launcher_tier ?? null;
  result.provenance = JSON.stringify(rj.provenance ?? {}).slice(0, 1500);
  const png = path.join(outDir, `after-f-export-osr-${orient}.png`);
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-ss', '1', '-i', out, '-frames:v', '1', png]);
  const W = edit.output.width, H = edit.output.height;
  const raw = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', '1', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: W * H * 4 });
  let accent = 0, orange = 0;
  for (let i = 0; i < raw.stdout.length; i += 3) {
    const r = raw.stdout[i], g = raw.stdout[i + 1], b = raw.stdout[i + 2];
    if (Math.abs(r - 77) < 20 && Math.abs(g - 163) < 20 && Math.abs(b - 255) < 20) accent++;
    if (Math.abs(r - 255) < 20 && Math.abs(g - 139) < 20 && Math.abs(b - 44) < 20) orange++;
  }
  result.frame = path.basename(png);
  result.pixels = { total: raw.stdout.length / 3, accentBlue4da3ff: accent, guideOrangeff8b2c: orange };
}
await writeFile(path.join(outDir, `after-f-export-osr-${orient}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
await rm(scratch, { recursive: true, force: true });
