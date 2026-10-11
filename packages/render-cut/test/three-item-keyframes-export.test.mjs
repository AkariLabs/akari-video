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

test('3D の向き・位置と画面の動画が auto → OSR の実書き出しで進む',
  { skip: process.env.AKARI_TEST_3D_KEYFRAME_EXPORT !== '1', timeout: 600_000 }, async t => {
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
      '-map', '[v]', '-frames:v', '20', '-c:v', 'libx264',
      join(root, 'assets', 'screen.mp4')]);
    const descriptor = {
      model: 'overlays/model.glb', camera: { position: [-70, 0, -260], lookAt: [0, 0, 0], fov: 45 },
      lights: [{ type: 'ambient', intensity: 2 }],
      materialOverrides: { ScreenMaterial: { texture: 'assets/screen.mp4',
        textureVar: '--akari-screen-src' } },
    };
    const html = '<div style="position:absolute;inset:0"><canvas style="position:absolute;inset:0;width:100%;height:100%"></canvas>'
      + '<script type="application/json" data-akari-3d-scene>'
      + JSON.stringify(descriptor) + '</script></div>';
    await writeFile(join(root, 'overlays', 'phone.html'), html);
    const points = [
      { t: 0, transform: { x: -45 }, vars: { '--akari-3d-rot-y': 0 } },
      { t: 19, transform: { x: 45 }, vars: { '--akari-3d-rot-y': 90 } },
    ];
    const edit = { version: 2, output: { width, height, fps },
      sources: [{ id: 'base', path: 'assets/base.mp4' }], tracks: [
        { id: 'base', lane: 'visual', items: [{ id: 'base', at: 0, duration: 25,
          source: { kind: 'media', src: 'base', in: 0, out: 2.5 } }] },
        { id: 'scene', lane: 'visual', items: [{ id: 'phone', at: 5, duration: 20,
          source: { kind: 'html', path: 'overlays/phone.html',
            vars: { '--akari-screen-src': 'assets/screen.mp4' } }, keyframes: points }] },
      ] };
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    const projected = readRenderEdit(JSON.stringify(edit), join(root, '.akari', 'render-tmp'),
      { projectRoot: root }).edit.overlays.find(overlay => overlay.id === 'phone');
    assert.ok(projected);
    assert.equal(evaluateOverlayVars(projected, 2.4, fps)['--akari-3d-rot-y'], 90);
    const lint = await lintProject(root);
    assert.equal(lint.verdict, 'pass', JSON.stringify(lint.findings));
    const logs = [];
    const state = await renderProject(root, { engine: 'auto', noAudio: true,
      out: 'exports/keyed.mp4', settle: false, verifyBlank: false,
      progress: true }, { log: line => logs.push(line), error: line => logs.push(line) });
    assert.equal(state.verify.verdict, 'pass', JSON.stringify(state.verify.findings));
    assert.equal(state.provenance.engine, 'osr');
    assert.ok(logs.some(line => /ENGINE osr reasons=.*three-item-keyframes/u.test(line)), logs.join('\n'));
    assert.ok(state.warnings.some(line => line.includes('three-item-keyframes')));
    const rendered = resolve(root, state.plan.output);
    const pixels = ffmpeg(['-i', rendered, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    assert.equal(pixels.length, 25 * frameBytes);
    const frames = [5, 15, 24].map(index => measureFrame(
      pixels.subarray(index * frameBytes, (index + 1) * frameBytes)));
    const preview = [0.5, 1.5, 2.4].map(seconds =>
      evaluateOverlayVars({ start: 0.5, keyframeUnit: 'frames', keyframes: points }, seconds, fps)['--akari-3d-rot-y']);
    assert.ok(preview[0] === 0 && preview[1] > 40 && preview[1] < 50 && preview[2] === 90);
    t.diagnostic(JSON.stringify({ frames, preview }));
    assert.ok(frames.every(frame => frame.count > 100 && frame.screenCount > 20), JSON.stringify(frames));
    assert.ok(frames[0].centerX + 15 < frames[1].centerX
      && frames[1].centerX + 15 < frames[2].centerX, JSON.stringify(frames));
    assert.ok(frames[0].screenCount > frames[1].screenCount
      && frames[1].screenCount > frames[2].screenCount, JSON.stringify(frames));
    assert.ok(frames[0].screenMean + 20 < frames[1].screenMean
      && frames[1].screenMean + 20 < frames[2].screenMean, JSON.stringify(frames));

    const renderCanvas = async (name, canvas) => {
      const grouped = { ...edit, tracks: [edit.tracks[0],
        { id: 'scene', lane: 'visual', items: [canvas] }] };
      await writeFile(join(root, 'edit.json'), JSON.stringify(grouped));
      const child = readRenderEdit(JSON.stringify(grouped), join(root, '.akari', 'render-tmp'),
        { projectRoot: root }).edit.overlays.find(overlay => overlay.id === 'phone');
      assert.ok(child);
      const checked = await lintProject(root);
      assert.equal(checked.verdict, 'pass', JSON.stringify(checked.findings));
      const output = [];
      const result = await renderProject(root, { engine: 'auto', noAudio: true,
        out: `exports/${name}.mp4`, settle: false, verifyBlank: false,
        progress: true }, { log: line => output.push(line), error: line => output.push(line) });
      assert.equal(result.verify.verdict, 'pass', JSON.stringify(result.verify.findings));
      assert.equal(result.provenance.engine, 'osr');
      assert.ok(output.some(line => /ENGINE osr reasons=.*three-item-keyframes/u.test(line)),
        output.join('\n'));
      const raw = ffmpeg(['-i', resolve(root, result.plan.output), '-pix_fmt', 'rgb24',
        '-f', 'rawvideo', 'pipe:1']);
      assert.equal(raw.length, 25 * frameBytes);
      const measured = [5, 15, 24].map(index => measureFrame(
        raw.subarray(index * frameBytes, (index + 1) * frameBytes)));
      t.diagnostic(JSON.stringify({ name, measured }));
      return { child, measured };
    };
    const childCanvas = { id: 'canvas', at: 5, duration: 20,
      source: { kind: 'group', canvas: { origin: 'user', durationMode: 'fixed' } },
      transform: { x: 45, scale: 0.7 }, items: [{ ...edit.tracks[1].items[0], at: 0 }] };
    const keyed = await renderCanvas('canvas-child-keyed', childCanvas);
    assert.equal(keyed.child.keyframes.length, 2);
    assert.equal(evaluateOverlayVars(keyed.child, 2.4, fps)['--akari-3d-rot-y'], 90);
    assert.ok(keyed.measured.every(frame => frame.count > 100 && frame.screenCount > 20),
      JSON.stringify(keyed.measured));
    assert.ok(keyed.measured[0].screenCount > keyed.measured[1].screenCount
      && keyed.measured[1].screenCount > keyed.measured[2].screenCount,
    JSON.stringify(keyed.measured));
    assert.ok(keyed.measured[0].centerX > frames[0].centerX + 20,
      JSON.stringify({ plain: frames[0], canvas: keyed.measured[0] }));
    assert.ok(keyed.measured[0].boxWidth < frames[0].boxWidth * 0.85,
      JSON.stringify({ plain: frames[0], canvas: keyed.measured[0] }));

    const parentCanvas = { ...childCanvas,
      keyframes: [{ t: 0, transform: { x: -40 } },
        { t: 19, transform: { x: 40 } }],
      items: [{ ...childCanvas.items[0], keyframes: undefined }] };
    const parent = await renderCanvas('canvas-parent-keyed', parentCanvas);
    assert.equal(parent.child.keyframes, undefined);
    assert.equal(parent.child.motionSource?.keyframes, undefined);
    assert.equal(parent.child.motionParents?.[0]?.keyframes?.length, 2);
    assert.ok(parent.measured.every(frame => frame.count > 100 && frame.screenCount > 20),
      JSON.stringify(parent.measured));
    assert.ok(parent.measured[0].centerX + 25 < parent.measured[1].centerX
      && parent.measured[1].centerX + 25 < parent.measured[2].centerX,
      JSON.stringify(parent.measured));

    await t.test('キーなしのキャンバス子 3D は GPU と OSR で位置・大きさが一致する',
      async staticTest => {
        const staticCanvas = { ...childCanvas,
          transform: { x: 45, scale: 0.8 },
          items: [{ ...childCanvas.items[0], keyframes: undefined }] };
        const staticEdit = { ...edit, tracks: [edit.tracks[0],
          { id: 'scene', lane: 'visual', items: [staticCanvas] }] };
        await writeFile(join(root, 'edit.json'), JSON.stringify(staticEdit));
        const checked = await lintProject(root);
        assert.equal(checked.verdict, 'pass', JSON.stringify(checked.findings));
        const measured = {};
        for (const engine of ['osr', 'gpu']) {
          if (engine === 'gpu' && (await resolveGpuLauncher()).tier === 3) {
            return staticTest.skip('GPU 用 Electron が見つからないため比較できません');
          }
          let result;
          try {
            result = await renderProject(root, { engine, noAudio: true,
              env: engine === 'gpu' ? { ...process.env, AKARI_GPU_SOFT: '1' } : process.env,
              out: `exports/canvas-static-${engine}.mp4`, settle: false, verifyBlank: false,
              progress: true }, { log() {}, error() {} });
          } catch (error) {
            if (engine === 'gpu' && /WebCodecs H\.264 config is unsupported|GPU export unavailable/u
              .test(error.originalMessage ?? error.message)) {
              staticTest.diagnostic(JSON.stringify({ staticCanvas: measured }));
              return staticTest.skip('GPU の H.264 エンコーダが使えないため比較できません');
            }
            throw error;
          }
          assert.equal(result.verify.verdict, 'pass', JSON.stringify(result.verify.findings));
          assert.equal(result.provenance.engine, engine);
          const raw = ffmpeg(['-i', resolve(root, result.plan.output), '-pix_fmt', 'rgb24',
            '-f', 'rawvideo', 'pipe:1']);
          assert.equal(raw.length, 25 * frameBytes);
          measured[engine] = measureFrame(raw.subarray(15 * frameBytes, 16 * frameBytes));
          assert.ok(measured[engine].count > 100, JSON.stringify(measured));
          if (engine === 'osr') {
            assert.ok(measured.osr.centerX > frames[1].centerX + 20,
              JSON.stringify({ plain: frames[1], staticCanvas: measured.osr }));
            assert.ok(measured.osr.boxWidth < frames[1].boxWidth * 0.9,
              JSON.stringify({ plain: frames[1], staticCanvas: measured.osr }));
          }
        }
        staticTest.diagnostic(JSON.stringify({ staticCanvas: measured }));
        assert.ok(Math.abs(measured.gpu.centerX - measured.osr.centerX) <= 4,
          JSON.stringify(measured));
        assert.ok(Math.abs(measured.gpu.boxWidth - measured.osr.boxWidth) <= 4,
          JSON.stringify(measured));
      });
  });
