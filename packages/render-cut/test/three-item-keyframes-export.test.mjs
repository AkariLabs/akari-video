// 実書き出し: AKARI_TEST_3D_KEYFRAME_EXPORT=1 node --test packages/render-cut/test/three-item-keyframes-export.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { renderProject } from '../src/render-cut.mjs';
import { readRenderEdit } from '../src/internal-render.mjs';
import { lintProject } from '../../edit-lint/src/edit-lint.mjs';
import { resolveOsrLauncher } from '../../osr-export/src/index.mjs';
import { resolveGpuLauncher } from '../../gpu-export/src/runner.mjs';

const require = createRequire(import.meta.url);
const { evaluateOverlayVars } = require('../../overlay-runtime/src/item-motion.js');
const fps = 10;
const width = 320;
const height = 180;
const frameBytes = width * height * 3;
const sampledFrames = [5, 15, 24];
const CENTER_TOLERANCE_PX = 2;
const WIDTH_TOLERANCE_PX = 2;

function ffmpeg(args, maxBuffer = 16 * 1024 * 1024) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args],
    { encoding: null, maxBuffer });
  assert.equal(result.status, 0, result.stderr?.toString('utf8'));
  return result.stdout;
}

function measureFrame(frame) {
  let count = 0;
  let xTotal = 0;
  let screenCount = 0;
  let screenLum = 0;
  let minX = width;
  let maxX = -1;
  for (let y = 10; y < height - 10; y++) {
    for (let x = 10; x < width - 10; x++) {
      const at = (y * width + x) * 3;
      const r = frame[at], g = frame[at + 1], b = frame[at + 2];
      if (Math.max(r, g, b) > 25) {
        count++; xTotal += x;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      if (r > 25 && r > g + 20 && r > b + 20) {
        screenCount++;
        screenLum += r;
      }
    }
  }
  return { count, centerX: xTotal / count, boxWidth: maxX - minX + 1, screenCount,
    screenMean: screenLum / screenCount };
}

function brightnessStage(mean) {
  if (mean < 100) return '暗';
  if (mean < 165) return '中';
  return '明';
}

function compareFrames(name, gpu, osr) {
  for (const index of sampledFrames.keys()) {
    const diff = { centerX: gpu[index].centerX - osr[index].centerX,
      boxWidth: gpu[index].boxWidth - osr[index].boxWidth };
    const detail = JSON.stringify({ name, frame: sampledFrames[index], gpu: gpu[index], osr: osr[index], diff });
    assert.ok(Math.abs(diff.centerX) <= CENTER_TOLERANCE_PX, detail);
    assert.ok(Math.abs(diff.boxWidth) <= WIDTH_TOLERANCE_PX, detail);
    assert.equal(brightnessStage(gpu[index].screenMean), brightnessStage(osr[index].screenMean), detail);
  }
}

function gpuUnavailable(error) {
  return /WebCodecs H\.264 config is unsupported|GPU export unavailable/u
    .test(error.originalMessage ?? error.message);
}

test('3D のキー・キャンバス親子・動画画面を GPU と OSR の実書き出しで比べる',
  { skip: process.env.AKARI_TEST_3D_KEYFRAME_EXPORT !== '1', timeout: 900_000 }, async t => {
    if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0
      || (await resolveOsrLauncher()).tier === 3) return t.skip('ffmpeg または Electron が使えません');
    const root = await mkdtemp(join(tmpdir(), 'three-keyframes-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'overlays'));
    await mkdir(join(root, 'assets'));
    await mkdir(join(root, '.akari'));
    const model = fileURLToPath(new URL('../../../assets/scene3d/smartphone-mockup/model.glb', import.meta.url));
    await cp(model, join(root, 'overlays', 'model.glb'));
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=2.5',
      '-frames:v', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'assets', 'base.mp4')]);
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x500000:s=64x128:r=10:d=0.7',
      '-f', 'lavfi', '-i', 'color=c=0xa00000:s=64x128:r=10:d=0.7',
      '-f', 'lavfi', '-i', 'color=c=0xf00000:s=64x128:r=10:d=0.6',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]',
      '-map', '[v]', '-frames:v', '20', '-c:v', 'libx264', join(root, 'assets', 'screen.mp4')]);
    const descriptor = {
      model: 'overlays/model.glb', camera: { position: [-70, 0, -260], lookAt: [0, 0, 0], fov: 45 },
      lights: [{ type: 'ambient', intensity: 2 }],
      materialOverrides: { ScreenMaterial: { texture: 'assets/screen.mp4',
        textureVar: '--akari-screen-src' } },
    };
    const html = '<div style="position:absolute;inset:0"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>'
      + '<script type="application/json" data-akari-3d-scene>' + JSON.stringify(descriptor) + '</script></div>';
    await writeFile(join(root, 'overlays', 'scene.html'), html);
    const points = [{ t: 0, transform: { x: -45 }, vars: { '--akari-3d-rot-y': 0 } },
      { t: 19, transform: { x: 45 }, vars: { '--akari-3d-rot-y': 90 } }];
    const scene = { id: 'scene', at: 5, duration: 20,
      source: { kind: 'html', path: 'overlays/scene.html',
        vars: { '--akari-screen-src': 'assets/screen.mp4' } }, keyframes: points };
    const base = { version: 2, output: { width, height, fps },
      sources: [{ id: 'base', path: 'assets/base.mp4' }], tracks: [
        { id: 'base', lane: 'visual', items: [{ id: 'base', at: 0, duration: 25,
          source: { kind: 'media', src: 'base', in: 0, out: 2.5 } }] },
      ] };
    const canvas = { id: 'canvas', at: 5, duration: 20,
      source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
      transform: { x: 45, scale: 0.7 }, items: [{ ...scene, at: 0 }] };
    const cases = [
      { name: 'single-keyed', item: scene },
      { name: 'canvas-child-keyed', item: canvas },
      { name: 'canvas-parent-keyed', item: { ...canvas,
        keyframes: [{ t: 0, transform: { x: -40 } }, { t: 19, transform: { x: 40 } }],
        items: [{ ...canvas.items[0], keyframes: undefined }] } },
      { name: 'canvas-static', item: { ...canvas, transform: { x: 45, scale: 0.8 },
        items: [{ ...canvas.items[0], keyframes: undefined }] } },
    ];
    const gpuAvailable = (await resolveGpuLauncher()).tier !== 3;
    let gpuEncoderAvailable = gpuAvailable;
    const render = async (name, edit, engine) => {
      await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
      const logs = [];
      const result = await renderProject(root, { engine, noAudio: true,
        env: engine === 'osr' ? process.env : { ...process.env, AKARI_EXPORT_GPU_PREFERENCE: 'auto' },
        out: `exports/${name}-${engine}.mp4`, settle: false, verifyBlank: false, progress: true },
      { log: line => logs.push(line), error: line => logs.push(line) });
      assert.equal(result.verify.verdict, 'pass', JSON.stringify(result.verify.findings));
      assert.equal(result.provenance.engine, engine === 'auto' ? 'gpu' : engine, logs.join('\n'));
      if (engine === 'auto') assert.ok(logs.some(line => /ENGINE gpu/u.test(line)), logs.join('\n'));
      const raw = ffmpeg(['-i', resolve(root, result.plan.output), '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      assert.equal(raw.length, 25 * frameBytes);
      return sampledFrames.map(index => measureFrame(raw.subarray(index * frameBytes,
        (index + 1) * frameBytes)));
    };
    for (const { name, item } of cases) {
      await t.test(name, async subtest => {
        const edit = { ...base, tracks: [...base.tracks,
          { id: 'scene', lane: 'visual', items: [item] }] };
        const projected = readRenderEdit(JSON.stringify(edit), join(root, '.akari', 'render-tmp'),
          { projectRoot: root }).edit.overlays.find(overlay => overlay.id === 'scene');
        assert.ok(projected);
        if (name === 'single-keyed' || name === 'canvas-child-keyed') {
          assert.equal(evaluateOverlayVars(projected, 2.4, fps)['--akari-3d-rot-y'], 90);
        }
        if (name === 'canvas-parent-keyed') {
          assert.equal(projected.keyframes, undefined);
          assert.equal(projected.motionParents?.[0]?.keyframes?.length, 2);
        }
        await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
        const lint = await lintProject(root);
        assert.equal(lint.verdict, 'pass', JSON.stringify(lint.findings));
        const osr = await render(name, edit, 'osr');
        subtest.diagnostic(JSON.stringify({ name, osr }));
        assert.ok(osr.every(frame => frame.count > 100 && frame.screenCount > 20), JSON.stringify(osr));
        assert.deepEqual(osr.map(frame => brightnessStage(frame.screenMean)), ['暗', '中', '明']);
        if (name !== 'canvas-static') {
          assert.ok(osr[0].centerX + 15 < osr[1].centerX
            && osr[1].centerX + 15 < osr[2].centerX, JSON.stringify(osr));
        }
        await subtest.test('GPU と OSR の 3 コマを比較する', async gpuTest => {
          if (!gpuEncoderAvailable) return gpuTest.skip('GPU の Electron または H.264 が使えません');
          let gpu;
          try { gpu = await render(name, edit, 'gpu'); }
          catch (error) {
            if (!gpuUnavailable(error)) throw error;
            gpuEncoderAvailable = false;
            return gpuTest.skip('GPU の H.264 エンコーダーが使えません');
          }
          gpuTest.diagnostic(JSON.stringify({ name, gpu, osr }));
          assert.ok(gpu.every(frame => frame.count > 100 && frame.screenCount > 20), JSON.stringify(gpu));
          compareFrames(name, gpu, osr);
        });
        if (name === 'single-keyed') {
          await subtest.test('auto はキーあり 3D に GPU を選ぶ', async autoTest => {
            if (!gpuEncoderAvailable) return autoTest.skip('GPU の H.264 エンコーダーが使えません');
            const auto = await render(name, edit, 'auto');
            autoTest.diagnostic(JSON.stringify({ name, auto, osr }));
            compareFrames(name, auto, osr);
          });
        }
      });
    }
  });
