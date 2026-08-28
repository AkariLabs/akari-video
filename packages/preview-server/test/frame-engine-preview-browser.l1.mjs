import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';
import { projectLegacyEdit, readInternalEdit } from '../../edit-store/lib/index.js';

const headed = process.env.AKARI_FRAME_ENGINE_HEADED === '1';

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('preview server did not become ready');
}

test('real browser runs the cuts-only frame engine field project outside the parallel unit suite', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the deterministic moving fixture');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-field-'));
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  const sourcePath = path.join(project, 'source.mp4');
  const generated = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-g', '25', '-keyint_min', '25', '-sc_threshold', '0', '-movflags', '+faststart',
    '-y', sourcePath,
  ], { encoding: 'utf8', timeout: 30_000 });
  if (generated.status !== 0) {
    fs.rmSync(project, { recursive: true, force: true });
    throw new Error(`moving fixture generation failed: ${generated.stderr || `exit ${generated.status}`}`);
  }
  const edit = JSON.parse(fs.readFileSync(path.join(repoRoot, 'test-project', 'edit.json'), 'utf8'));
  edit.output = { width: 1280, height: 720, fps: 30 };
  edit.sources = edit.sources.filter(source => source.id === 'main');
  edit.tracks = [{
    id: 'cuts',
    lane: 'visual',
    items: [
      {
        id: 'cut-a', at: 0, duration: 45,
        source: {
          kind: 'media', src: 'main', in: 0, out: 1,
          freeze: { at_sec: 0.4, duration_sec: 0.5 },
          transition_out: { type: 'dissolve', duration: 0.2 },
        },
      },
      { id: 'cut-b', at: 39, duration: 90, source: { kind: 'media', src: 'main', in: 1, out: 4 } },
    ],
  }];
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));

  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${port}`;
  let browser;
  try {
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    context.setDefaultNavigationTimeout(60_000);

    const off = await context.newPage();
    const offRequests = [];
    off.on('request', request => offRequests.push(request.url()));
    await off.goto(`${base}/?frameEngine=0`, { waitUntil: 'load' });
    await off.waitForTimeout(500);
    assert.equal(await off.locator('#frame-engine-preview').count(), 0);
    assert.equal(offRequests.some(url => url.endsWith('/frame-engine.bundle.js')), false);
    await off.close();

    const directPage = await context.newPage();
    const directPageErrors = [];
    directPage.on('pageerror', error => directPageErrors.push(error.message));
    await directPage.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' });
    await directPage.waitForSelector(
      '#frame-engine-preview[data-frame-engine-ready="true"]',
      { timeout: 60_000 },
    );
    assert.equal(
      await directPage.locator('#frame-engine-metrics').getAttribute('data-upload-path'),
      'direct',
    );
    assert.equal(await directPage.locator('#frame-engine-error').isHidden(), true);
    assert.deepEqual(directPageErrors, []);
    await directPage.close();

    const page = await context.newPage();
    const onRequests = [];
    const pageErrors = [];
    page.on('request', request => onRequests.push(request.url()));
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(`${base}/?frameEngine=1&uploadPath=copyTo`, { waitUntil: 'load' });
    await page.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 });

    assert.equal(onRequests.some(url => url.endsWith('/frame-engine.bundle.js')), true);
    assert.equal(await page.locator('#frame-engine-canvas').count(), 1);
    assert.equal(await page.locator('#frame-engine-unsupported-banner').count(), 0);
    assert.equal(await page.locator('#preview-video').evaluate(
      element => element.checkVisibility({ checkVisibilityCSS: true }),
    ), false);
    assert.equal(await page.locator('#overlay-stage').evaluate(
      element => element.checkVisibility({ checkVisibilityCSS: true }),
    ), true);
    assert.equal(await page.locator('#caption-plate').evaluate(element => getComputedStyle(element).visibility), 'visible');
    assert.equal(await page.locator('#frame-engine-metrics').isHidden(), true);
    assert.deepEqual(await page.locator('#frame-engine-canvas').evaluate(canvas => [canvas.width, canvas.height]), [1280, 720]);
    assert.equal(await page.locator('#frame-engine-metrics').getAttribute('data-upload-path'), 'copyTo');

    const duration = Number(await page.locator('#seek').getAttribute('max'));
    assert.ok(duration > 4.2 && duration < 4.4, `freeze-adjusted duration was ${duration}`);

    const rapidSeeks = Array.from({ length: 30 }, (_unused, index) => 0.1 + ((index * 0.37) % 1.9));
    rapidSeeks.push(0.35);
    for (const value of rapidSeeks) {
      await page.locator('#seek').evaluate((input, next) => {
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    }
    await page.waitForTimeout(900);
    const seekMetrics = await page.locator('#frame-engine-metrics').evaluate(element => ({
      latest: element.dataset.seekMs,
      before: element.dataset.seekBeforeMs,
      after: element.dataset.seekAfterMs,
      late: element.dataset.lateFrames,
    }));
    const numericMetric = value => typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value);
    assert.ok(numericMetric(seekMetrics.latest), `seek latest metric was ${seekMetrics.latest}`);
    assert.ok(numericMetric(seekMetrics.before), `seek cold metric was ${seekMetrics.before}`);
    assert.ok(numericMetric(seekMetrics.after), `seek cache metric was ${seekMetrics.after}`);
    assert.ok(numericMetric(seekMetrics.late), `late metric was ${seekMetrics.late}`);

    const canvasBeforePlayback = await page.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
    const playbackRuns = [];
    for (let run = 1; run <= 2; run += 1) {
      await page.locator('#seek').evaluate(input => {
        input.value = '0.35';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const playbackStart = Number(await page.locator('#seek').inputValue());
      await page.click('#play-toggle');
      await page.waitForTimeout(1_000);
      const fpsSamples = [];
      for (let sample = 0; sample < 10; sample += 1) {
        await page.waitForTimeout(250);
        const fps = await page.locator('#frame-engine-metrics').getAttribute('data-fps');
        assert.ok(/^\d+$/u.test(fps ?? ''), `run ${run} fps sample ${sample + 1} was ${fps}`);
        fpsSamples.push(Number(fps));
      }
      const metrics = await page.locator('#frame-engine-metrics').evaluate(element => ({
        boundaryBefore: element.dataset.boundaryLateBefore,
        boundaryAfter: element.dataset.boundaryLateAfter,
      }));
      const playbackEnd = Number(await page.locator('#seek').inputValue());
      const debug = await page.evaluate(() => window.akariFrameEngineAudioDebug?.() ?? null);
      playbackRuns.push({
        run, playbackStart, playbackEnd, metrics, fpsSamples,
        fpsMedian: median(fpsSamples), driftMs: debug?.driftMs ?? null,
      });
      await page.click('#play-toggle');
    }
    const playbackMetrics = playbackRuns.at(-1).metrics;
    const boundaryTotal = value => Number(String(value).split('/')[1]);
    for (const run of playbackRuns) {
      assert.equal(run.fpsSamples.length, 10);
      assert.ok(run.fpsSamples.every(Number.isFinite),
        `run ${run.run} fps samples were ${run.fpsSamples.join(', ')}`);
      if (headed) assert.ok(run.fpsMedian >= 30,
        `run ${run.run} headed 1280x720 presented fps median was ${run.fpsMedian} (${run.fpsSamples.join(', ')})`);
      assert.ok(run.playbackEnd > run.playbackStart + 0.5,
        `run ${run.run} playback clock did not advance: ${run.playbackStart} -> ${run.playbackEnd}`);
      if (run.driftMs !== null) assert.ok(Math.abs(run.driftMs) <= 33,
        `run ${run.run} drift was ${run.driftMs}ms`);
    }
    const canvasAfterPlayback = await page.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
    assert.notEqual(canvasAfterPlayback, canvasBeforePlayback, 'playback did not present a different frame');
    assert.ok(boundaryTotal(playbackMetrics.boundaryBefore) >= 1, `cold boundary record was ${playbackMetrics.boundaryBefore}`);
    assert.ok(boundaryTotal(playbackMetrics.boundaryAfter) >= 1, `warm boundary record was ${playbackMetrics.boundaryAfter}`);
    assert.equal(await page.locator('#frame-engine-error').isHidden(), true);
    assert.deepEqual(pageErrors, []);
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('real browser renders projected video and still layers in the frame engine evaluation surface', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the deterministic layers fixture');
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-layers-'));
  const withLayersProject = path.join(root, 'with-layers');
  const withoutLayersProject = path.join(root, 'without-layers');
  fs.mkdirSync(withLayersProject, { recursive: true });
  fs.mkdirSync(withoutLayersProject, { recursive: true });

  const generateVideo = (output, filter, duration = 6) => {
    const result = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', filter, '-t', String(duration),
      '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      '-movflags', '+faststart', '-y', output,
    ], { encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) throw new Error(`video fixture generation failed: ${result.stderr || `exit ${result.status}`}`);
  };

  try {
    generateVideo(path.join(withLayersProject, 'source.mp4'), 'testsrc2=size=640x360:rate=30', 6);
    generateVideo(path.join(withLayersProject, 'broll-a.mp4'), 'testsrc2=size=640x360:rate=30,hue=h=45*t:s=1', 4);
    generateVideo(path.join(withLayersProject, 'broll-b.mp4'), 'mandelbrot=size=640x360:rate=30', 4);
    const stillResult = spawnSync(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=480x270:rate=1,drawgrid=w=48:h=27:t=3:c=yellow',
      '-frames:v', '1', '-threads', '1', '-y', path.join(withLayersProject, 'still.png'),
    ], { encoding: 'utf8', timeout: 30_000 });
    if (stillResult.status !== 0) throw new Error(`still fixture generation failed: ${stillResult.stderr || `exit ${stillResult.status}`}`);

    const edit = {
      version: 2,
      output: { width: 640, height: 360, fps: 30 },
      sources: [
        { id: 'main', path: 'source.mp4', proxy: null },
        { id: 'broll-a', path: 'broll-a.mp4', proxy: null },
        { id: 'broll-b', path: 'broll-b.mp4', proxy: null },
        { id: 'still', path: 'still.png', proxy: null },
      ],
      tracks: [
        {
          id: 'base', lane: 'visual', items: [
            { id: 'base-cut', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } },
          ],
        },
        {
          id: 'layer-a', lane: 'visual', items: [
            {
              id: 'crop-transform-layer', at: 30, duration: 60,
              transform: { x: -130, y: -35, scale: 0.48, rotate: -7 },
              crop: { x: 0.08, y: 0.1, w: 0.72, h: 0.76 },
              opacity: 0.68,
              source: { kind: 'media', src: 'broll-a', in: 0, out: 2 },
            },
          ],
        },
        {
          id: 'layer-b', lane: 'visual', items: [
            {
              id: 'keyframed-blend-layer', at: 60, duration: 75,
              transform: { x: 125, y: 25, scale: 0.44, rotate: 5 },
              blend: 'screen',
              keyframes: [
                { t: 0, transform: { x: 125, y: 25, scale: 0.44, rotate: 5 } },
                { t: 60, transform: { x: 40, y: -45, scale: 0.62, rotate: -12 }, easing: 'ease-in-out' },
              ],
              source: { kind: 'media', src: 'broll-b', in: 0, out: 2.5 },
            },
          ],
        },
        {
          id: 'layer-still', lane: 'visual', items: [
            {
              id: 'still-layer', at: 90, duration: 60,
              transform: { x: 0, y: 45, scale: 0.5, rotate: 3 },
              opacity: 0.72,
              source: { kind: 'media', src: 'still', in: 0, out: 2 },
            },
          ],
        },
      ],
    };
    const projected = projectLegacyEdit(readInternalEdit(edit));
    assert.deepEqual(
      projected.layers.map(layer => layer.id).sort(),
      ['crop-transform-layer', 'keyframed-blend-layer', 'still-layer'],
    );

    const noLayersEdit = { ...edit, tracks: [edit.tracks[0]] };
    fs.writeFileSync(path.join(withLayersProject, 'edit.json'), JSON.stringify(edit, null, 2));
    fs.writeFileSync(path.join(withoutLayersProject, 'edit.json'), JSON.stringify(noLayersEdit, null, 2));
    for (const name of ['source.mp4', 'broll-a.mp4', 'broll-b.mp4', 'still.png']) {
      fs.copyFileSync(path.join(withLayersProject, name), path.join(withoutLayersProject, name));
    }

    let withPort;
    let withoutPort;
    try {
      withPort = await freePort();
      withoutPort = await freePort();
    } catch (error) {
      if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
      throw error;
    }

    const previewDirectory = path.resolve(import.meta.dirname, '..');
    const withServer = spawn('node', ['src/server.mjs', withLayersProject, '--port', String(withPort), '--no-lint'], {
      cwd: previewDirectory, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const withoutServer = spawn('node', ['src/server.mjs', withoutLayersProject, '--port', String(withoutPort), '--no-lint'], {
      cwd: previewDirectory, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let browser;
    try {
      const withBase = `http://127.0.0.1:${withPort}`;
      const withoutBase = `http://127.0.0.1:${withoutPort}`;
      await Promise.all([
        waitForServer(`${withBase}/api/codec-info`),
        waitForServer(`${withoutBase}/api/codec-info`),
      ]);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
      context.setDefaultNavigationTimeout(60_000);
      const withPage = await context.newPage();
      const withoutPage = await context.newPage();
      const withErrors = [];
      const withoutErrors = [];
      withPage.on('pageerror', error => withErrors.push(error.message));
      withoutPage.on('pageerror', error => withoutErrors.push(error.message));
      await Promise.all([
        withPage.goto(`${withBase}/?frameEngine=1`, { waitUntil: 'load' }),
        withoutPage.goto(`${withoutBase}/?frameEngine=1`, { waitUntil: 'load' }),
      ]);
      await Promise.all([
        withPage.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 }),
        withoutPage.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 }),
      ]);

      assert.equal(await withPage.locator('#frame-engine-unsupported-banner').count(), 0);
      assert.equal(await withPage.locator('#overlay-stage').evaluate(
        element => element.checkVisibility({ checkVisibilityCSS: true }),
      ), true);

      const seekCanvas = async (page, seconds) => {
        await page.locator('#seek').evaluate((input, next) => {
          input.value = String(next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, seconds);
        await page.waitForTimeout(700);
        return page.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
      };

      const outsideCanvas = await seekCanvas(withPage, 0.3);
      const videoLayerCanvas = await seekCanvas(withPage, 1.5);
      const withoutLayerCanvas = await seekCanvas(withoutPage, 1.5);
      assert.notEqual(videoLayerCanvas, outsideCanvas, 'layer window did not differ from the outside window');
      assert.notEqual(videoLayerCanvas, withoutLayerCanvas, 'layers-on and layers-empty projects matched at the same time');

      await seekCanvas(withPage, 3.5);
      assert.equal(await withPage.locator('#frame-engine-error').isHidden(), true);
      assert.deepEqual(withErrors, []);

      const rapidSeeks = Array.from({ length: 30 }, (_unused, index) => 0.15 + ((index * 0.41) % 5.2));
      for (const value of rapidSeeks) {
        await withPage.locator('#seek').evaluate((input, next) => {
          input.value = String(next);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, value);
      }
      await withPage.waitForTimeout(900);
      const seekMs = await withPage.locator('#frame-engine-metrics').getAttribute('data-seek-ms');
      assert.ok(typeof seekMs === 'string' && /^\d+(?:\.\d+)?$/u.test(seekMs), `seek metric was ${seekMs}`);

      await seekCanvas(withPage, 0.2);
      const playbackStart = Number(await withPage.locator('#seek').inputValue());
      const canvasBeforePlayback = await withPage.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
      await withPage.click('#play-toggle');
      await withPage.waitForTimeout(1_200);
      const playbackEnd = Number(await withPage.locator('#seek').inputValue());
      const canvasAfterPlayback = await withPage.locator('#frame-engine-canvas').evaluate(canvas => canvas.toDataURL());
      assert.ok(playbackEnd > playbackStart + 0.4, `playback clock did not advance: ${playbackStart} -> ${playbackEnd}`);
      assert.notEqual(canvasAfterPlayback, canvasBeforePlayback, 'layer project playback did not change the canvas');
      assert.equal(await withPage.locator('#frame-engine-error').isHidden(), true);
      assert.deepEqual(withErrors, []);
      assert.deepEqual(withoutErrors, []);
      await context.close();
    } finally {
      await browser?.close();
      withServer.kill('SIGTERM');
      withoutServer.kill('SIGTERM');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('engine and legacy surfaces share caption, HTML overlay, and 3D overlay geometry at five times', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the overlay parity fixture');
  }
  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-frame-engine-overlays-'));
  const generated = spawnSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc2=size=640x360:rate=30:duration=6', '-an', '-c:v', 'libx264',
    '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-y', path.join(project, 'source.mp4'),
  ], { encoding: 'utf8', timeout: 30_000 });
  if (generated.status !== 0) {
    fs.rmSync(project, { recursive: true, force: true });
    throw new Error(`overlay fixture generation failed: ${generated.stderr || `exit ${generated.status}`}`);
  }

  const htmlOverlay = '<div data-l1-html style="position:absolute;left:72px;top:54px;width:220px;height:72px;'
    + 'display:grid;place-items:center;background:#ff4d8d;color:white;font:700 28px sans-serif">HTML</div>';
  const threeOverlay = '<div data-l1-three style="position:absolute;right:52px;top:38px;width:220px;height:150px">'
    + '<canvas style="width:100%;height:100%"></canvas><div data-akari-3d-fallback>3D</div>'
    + '<script type="application/json" data-akari-3d-scene>'
    + '{"texts":[{"id":"l1-title","text":"3D","font":"/assets/fonts/akari-noto-sans-jp.ttf","size":0.6}]}'
    + '<\/script></div>';
  const cubeText = 'TITLE identity\nLUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n'
    + '0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n';
  fs.mkdirSync(path.join(project, 'overlays'));
  fs.writeFileSync(path.join(project, 'overlays', 'l1-html.html'), htmlOverlay);
  fs.writeFileSync(path.join(project, 'overlays', 'l1-three.html'), threeOverlay);
  fs.writeFileSync(path.join(project, 'look.cube'), cubeText);
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify({
    version: 2,
    output: { width: 640, height: 360, fps: 30, look: { lut: './look.cube', intensity: 1 } },
    sources: [{ id: 'main', path: 'source.mp4' }],
    tracks: [
      {
        id: 'base', lane: 'visual', items: [
          { id: 'cut-main', at: 0, duration: 180, source: { kind: 'media', src: 'main', in: 0, out: 6 } },
        ],
      },
      {
        id: 'overlays', lane: 'visual', items: [
          { id: 'l1-html', at: 0, duration: 180, source: { kind: 'html', path: 'overlays/l1-html.html' } },
          { id: 'l1-3d', at: 0, duration: 180, source: { kind: 'html', path: 'overlays/l1-three.html' } },
        ],
      },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(project, 'captions.json'), JSON.stringify({
    schema: 'caption-layout/v1',
    captions: [{ id: 'caption-l1', start: 0, end: 6, text: '字幕 L1', zone: 'bottom' }],
  }, null, 2));

  const server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
    cwd: path.resolve(import.meta.dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext({ viewport: { width: 960, height: 720 } });
    context.setDefaultNavigationTimeout(60_000);
    const enginePage = await context.newPage();
    const legacyPage = await context.newPage();
    await Promise.all([
      enginePage.goto(`${base}/?frameEngine=1`, { waitUntil: 'load' }),
      legacyPage.goto(`${base}/?frameEngine=0`, { waitUntil: 'load' }),
    ]);
    await enginePage.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 });
    await legacyPage.waitForFunction(() => Number(document.querySelector('#seek')?.max) > 0, null, { timeout: 60_000 });
    const suppliedSummary = await enginePage.evaluate(async () => {
      const response = await fetch('/api/summary');
      if (!response.ok) throw new Error(`summary fetch failed: ${response.status}`);
      return response.json();
    });
    assert.equal(typeof suppliedSummary.videoFx?.look?.cubeText, 'string');
    assert.ok(suppliedSummary.videoFx.look.cubeText.length > 0);
    assert.equal(suppliedSummary.indicators?.includes('LUT'), false);
    for (const page of [enginePage, legacyPage]) {
      await page.locator('#seek').evaluate(input => {
        input.value = '0.25';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await Promise.all([enginePage, legacyPage].map(page => page.waitForFunction(() => {
      const html = document.querySelector('[data-l1-html]');
      const three = document.querySelector('[data-l1-three]');
      const caption = document.querySelector('#caption-plate .akari-caption__resolved-line');
      return html?.checkVisibility({ checkVisibilityCSS: true })
        && three?.checkVisibility({ checkVisibilityCSS: true })
        && caption?.textContent === '字幕 L1';
    }, null, { timeout: 60_000 })));
    await enginePage.waitForFunction(() => {
      const host = document.querySelector('[data-overlay-id="l1-3d"]');
      return host && window.akari?.threeRuntime?.inspect(host).status === 'ready';
    }, null, { timeout: 60_000 });

    const measure = page => page.evaluate(() => {
      const box = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        html: box('[data-l1-html]'),
        three: box('[data-l1-three]'),
        caption: box('#caption-plate .akari-caption__resolved-line'),
      };
    });
    const assertBoxesEqual = (engineBoxes, legacyBoxes, time) => {
      for (const key of ['html', 'three', 'caption']) {
        for (const field of ['x', 'y', 'width', 'height']) {
          assert.ok(Math.abs(engineBoxes[key][field] - legacyBoxes[key][field]) <= 0.5,
            `${key}.${field} differs at ${time}s: ${engineBoxes[key][field]} vs ${legacyBoxes[key][field]}`);
        }
      }
    };
    for (const seconds of [0.25, 1.25, 2.25, 3.25, 4.25]) {
      for (const page of [enginePage, legacyPage]) {
        await page.locator('#seek').evaluate((input, value) => {
          input.value = String(value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }, seconds);
      }
      await enginePage.waitForTimeout(250);
      assertBoxesEqual(await measure(enginePage), await measure(legacyPage), seconds);
      const clip = await enginePage.locator('#preview-stage').boundingBox();
      assert.ok(clip, `preview stage was not measurable at ${seconds}s`);
      await enginePage.screenshot({ path: path.join(project, `engine-${seconds}.png`), clip });
    }
    assert.equal(await enginePage.locator('#caption-plate').evaluate(element => getComputedStyle(element).filter), 'none');
    assert.equal(await enginePage.locator('#overlay-stage').evaluate(element => getComputedStyle(element).filter), 'none');
    assert.equal(await enginePage.locator('[data-l1-html]').evaluate(element => getComputedStyle(element).filter), 'none');
    assert.equal(await enginePage.locator('[data-l1-three]').evaluate(element => getComputedStyle(element).filter), 'none');
    assert.equal(await enginePage.locator('#overlay-stage').evaluate(
      element => element.checkVisibility({ checkVisibilityCSS: true }),
    ), true);
    assert.equal(await enginePage.locator('#pen-layer').evaluate(
      element => element.checkVisibility({ checkVisibilityCSS: true }),
    ), true);
    await context.close();
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
