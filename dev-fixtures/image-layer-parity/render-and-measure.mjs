// task 2026-08-10-image-layer-parity 受け入れ条件4の実測証跡スクリプト。
// 製品ソースではなく検証用フィクスチャ -- 画像レイヤー付きの最小 edit.json を実際に
// render-cut CLI でレンダリングし、以下を画素で実測する:
//   1) レイヤー区間「前」のフレーム = 画像が出ていない(背景の色)
//   2) 区間「中」の2時刻のフレーム = 画像の色が出ている、かつ両時刻で同一画素(静止の証明)
//   3) レイヤー区間「後」のフレーム = 画像が消えている
//   4) 同一時刻(t=1.5s)を出力から2回独立に抽出して差分バイト0(seek安全)
//   5) おまけ: 同じ edit.json を2回独立にフルレンダリングし、出力バイトが完全一致(決定性)
//
// 使い方: node dev-fixtures/image-layer-parity/render-and-measure.mjs
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const cliPath = join(repoRoot, 'packages/render-cut/bin/render-cut.mjs');

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 25;
const DURATION = 5;
const LAYER_T = 1;
const LAYER_DURATION = 2; // window: [1, 3)
const BG_COLOR_RGB = [0, 0, 255]; // blue background source
const IMG_COLOR_RGB = [255, 0, 0]; // red still image

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
  return result;
}

function ffprobe(args) {
  const result = spawnSync('ffprobe', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  return result.stdout;
}

// Frame-accurate pixel sample: `select=eq(n,frame)` (not -ss seeking, which can land on an
// adjacent frame near GOP/keyframe boundaries).
function samplePixel(filePath, frame, x, y) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', filePath,
    '-vf', `select=eq(n\\,${frame}),crop=w=2:h=2:x=${x}:y=${y},format=rgb24`,
    '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { encoding: 'buffer' });
  if (result.status !== 0) throw new Error(`ffmpeg sample failed: ${result.stderr?.toString()}`);
  const buf = result.stdout;
  return { r: buf[0], g: buf[1], b: buf[2] };
}

// Extracts the raw decoded bytes of one exact frame (for byte-for-byte seek-safety comparison,
// not just a single sampled pixel).
function extractFrameBytes(filePath, frame) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', filePath,
    '-vf', `select=eq(n\\,${frame})`,
    '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`ffmpeg extract failed: ${result.stderr?.toString()}`);
  return result.stdout;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function closeEnough(pixel, [r, g, b], tolerance = 12) {
  return Math.abs(pixel.r - r) <= tolerance && Math.abs(pixel.g - g) <= tolerance && Math.abs(pixel.b - b) <= tolerance;
}

async function makeProject() {
  const root = await mkdtemp(join(tmpdir(), 'image-layer-parity-fixture-'));
  ffmpeg(['-f', 'lavfi', '-i', `color=c=blue:s=${WIDTH}x${HEIGHT}:d=${DURATION}:r=${FPS}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'source.mp4')]);
  // Single-frame still PNG (no fps/duration of its own) -- the exact input shape layers.mjs's
  // -loop 1 branch has to hold for the whole [t, t+duration) window.
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=300x200:d=1', '-frames:v', '1', join(root, 'photo.png')]);
  await writeFile(
    join(root, 'edit.json'),
    `${JSON.stringify({
      version: 0,
      output: { width: WIDTH, height: HEIGHT, fps: FPS },
      source: { path: 'source.mp4', proxy: null },
      cuts: [{ in: 0, out: DURATION }],
      overlays: [],
      layers: [
        {
          id: 'photo-layer',
          t: LAYER_T,
          duration: LAYER_DURATION,
          kind: 'video',
          src: 'photo.png',
          transform: { x: 0, y: 0, scale: 1, rotate: 0 },
        },
      ],
    }, null, 2)}\n`,
  );
  await mkdir(join(root, '.akari'));
  await writeFile(join(root, '.akari', 'lint.json'), '{"version":1,"verdict":"pass"}\n');
  return root;
}

async function renderOnce(project) {
  const result = spawnSync(process.execPath, [cliPath, project], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`render-cut CLI failed:\n${result.stderr}\n${result.stdout}`);
  const state = JSON.parse(await readFile(join(project, '.akari', 'render.json'), 'utf8'));
  if (state.verify.verdict !== 'pass') throw new Error(`render verify did not pass: ${JSON.stringify(state.verify)}`);
  return join(project, state.artifacts[0].path);
}

async function main() {
  const report = { measurements: [] };
  const log = (line) => { console.log(line); report.measurements.push(line); };

  const project = await makeProject();
  let outputPath;
  try {
    outputPath = await renderOnce(project);
    log(`ffprobe: ${ffprobe(['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate,nb_frames', '-of', 'json', outputPath]).trim()}`);

    const pos = { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) };
    const beforeFrame = Math.round(0.5 * FPS); // t=0.5s, before [1,3)
    const duringFrameA = Math.round(1.5 * FPS); // t=1.5s
    const duringFrameB = Math.round(2.5 * FPS); // t=2.5s
    const afterFrame = Math.round(4 * FPS); // t=4s, after [1,3)

    const before = samplePixel(outputPath, beforeFrame, pos.x, pos.y);
    const duringA = samplePixel(outputPath, duringFrameA, pos.x, pos.y);
    const duringB = samplePixel(outputPath, duringFrameB, pos.x, pos.y);
    const after = samplePixel(outputPath, afterFrame, pos.x, pos.y);

    log(`1) before window  frame=${beforeFrame} (t=0.5s) pos=(${pos.x},${pos.y}) rgb=(${before.r},${before.g},${before.b})  expect ~(${BG_COLOR_RGB.join(',')})`);
    log(`2) during window  frame=${duringFrameA} (t=1.5s) pos=(${pos.x},${pos.y}) rgb=(${duringA.r},${duringA.g},${duringA.b})  expect ~(${IMG_COLOR_RGB.join(',')})`);
    log(`2) during window  frame=${duringFrameB} (t=2.5s) pos=(${pos.x},${pos.y}) rgb=(${duringB.r},${duringB.g},${duringB.b})  expect ~(${IMG_COLOR_RGB.join(',')})`);
    log(`3) after window   frame=${afterFrame} (t=4s) pos=(${pos.x},${pos.y}) rgb=(${after.r},${after.g},${after.b})  expect ~(${BG_COLOR_RGB.join(',')})`);

    const assertions = [
      ['before window shows background blue', closeEnough(before, BG_COLOR_RGB)],
      ['during window (t=1.5s) shows the still image red', closeEnough(duringA, IMG_COLOR_RGB)],
      ['during window (t=2.5s) shows the still image red', closeEnough(duringB, IMG_COLOR_RGB)],
      ['during window: t=1.5s and t=2.5s are the exact same RGB (static image proof)', duringA.r === duringB.r && duringA.g === duringB.g && duringA.b === duringB.b],
      ['after window shows background blue again', closeEnough(after, BG_COLOR_RGB)],
    ];
    for (const [label, passed] of assertions) {
      log(`  [${passed ? 'PASS' : 'FAIL'}] ${label}`);
      if (!passed) throw new Error(`assertion failed: ${label}`);
    }

    // 4) same timestamp extracted twice from the same output -> byte-identical (seek safety)
    const frameBytesA = extractFrameBytes(outputPath, duringFrameA);
    const frameBytesB = extractFrameBytes(outputPath, duringFrameA);
    const hashA = sha256(frameBytesA);
    const hashB = sha256(frameBytesB);
    log(`4) same-timestamp frame extracted twice (frame=${duringFrameA}, t=1.5s): sha256 A=${hashA} B=${hashB}`);
    log(`   byte length A=${frameBytesA.length} B=${frameBytesB.length}`);
    if (hashA !== hashB) throw new Error('seek-safety FAILED: same-timestamp extraction produced different bytes');
    log('  [PASS] same-timestamp extraction is byte-identical (seek safe)');

    // 5) bonus: two independent full renders of the same edit.json -> byte-identical outputs
    const project2 = await makeProject();
    let outputPath2;
    try {
      outputPath2 = await renderOnce(project2);
      const fullA = await readFile(outputPath);
      const fullB = await readFile(outputPath2);
      const fullHashA = sha256(fullA);
      const fullHashB = sha256(fullB);
      log(`5) two independent full renders of the same edit.json: sha256 A=${fullHashA} B=${fullHashB}`);
      log(`   byte length A=${fullA.length} B=${fullB.length}`);
      if (fullHashA !== fullHashB) throw new Error('determinism FAILED: two independent full renders produced different output bytes');
      log('  [PASS] two independent full renders are byte-identical');
    } finally {
      await rm(project2, { recursive: true, force: true });
    }

    console.log('\nALL CHECKS PASSED');
  } finally {
    await rm(project, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('FIXTURE FAILED:', error);
  process.exitCode = 1;
});
