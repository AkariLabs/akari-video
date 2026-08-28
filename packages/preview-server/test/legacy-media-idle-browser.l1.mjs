import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

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

function generateFixture(ffmpegPath, project) {
  const run = (args, label) => {
    const result = spawnSync(ffmpegPath, args, { encoding: 'utf8', timeout: 30_000 });
    if (result.status !== 0) {
      throw new Error(`${label} fixture generation failed: ${result.stderr || `exit ${result.status}`}`);
    }
  };

  run([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart',
    '-y', path.join(project, 'base.mp4'),
  ], 'H.264 base');

  run([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6',
    '-f', 'lavfi', '-i',
    'color=c=black:size=640x360:rate=30:duration=6,drawbox=x=160:y=90:w=320:h=180:color=white:t=fill',
    '-filter_complex', '[0:v][1:v]alphamerge[v]', '-map', '[v]', '-an',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
    '-deadline', 'realtime', '-cpu-used', '8',
    '-b:v', '20M', '-minrate', '20M', '-maxrate', '20M',
    '-y', path.join(project, 'alpha-layer.webm'),
  ], 'VP9 alpha layer');

  run([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=royalblue:size=320x180,drawgrid=w=40:h=30:t=3:c=white',
    '-frames:v', '1', '-threads', '1', '-y', path.join(project, 'still-layer.png'),
  ], 'PNG still layer');

  const edit = {
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [
      { id: 'base', path: 'base.mp4', proxy: null },
      { id: 'alpha', path: 'alpha-layer.webm', proxy: null },
      { id: 'still', path: 'still-layer.png', proxy: null },
    ],
    tracks: [
      {
        id: 'base-track', lane: 'visual', items: [
          { id: 'base-cut', at: 0, duration: 180, source: { kind: 'media', src: 'base', in: 0, out: 6 } },
        ],
      },
      {
        id: 'alpha-track', lane: 'visual', items: [
          {
            id: 'alpha-layer', at: 0, duration: 180,
            transform: { x: 0, y: 0, scale: 2, rotate: 0 },
            source: { kind: 'media', src: 'alpha', in: 0, out: 6 },
          },
        ],
      },
      {
        id: 'still-track', lane: 'visual', items: [
          {
            id: 'still-layer', at: 0, duration: 180,
            transform: { x: -380, y: -220, scale: 1, rotate: 0 },
            source: { kind: 'media', src: 'still', in: 0, out: 6 },
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));
}

async function mediaAudit(page) {
  return await page.evaluate(() => {
    const nonEmptySrc = element => Boolean(element.getAttribute('src') || element.src);
    const resources = performance.getEntriesByType('resource')
      .filter(entry => entry.initiatorType === 'video' || entry.initiatorType === 'img')
      .map(entry => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        encodedBodySize: entry.encodedBodySize,
      }));
    const videoResources = resources.filter(entry => entry.initiatorType === 'video');
    return {
      resources,
      videoResources,
      imgResources: resources.filter(entry => entry.initiatorType === 'img'),
      videoEncodedBodySize: videoResources.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      videoBodyEntryCount: videoResources.filter(entry => entry.encodedBodySize > 0).length,
      layerSrcCount: Array.from(document.querySelectorAll('#layer-container video, #layer-container img'))
        .filter(nonEmptySrc).length,
      baseSources: ['preview-video', 'transition-video', 'preview-image']
        .map(id => {
          const element = document.getElementById(id);
          return { id, src: element?.getAttribute('src') || element?.src || '' };
        }),
      layerVideos: Array.from(document.querySelectorAll('#layer-container video')).map(element => ({
        id: element.dataset.layerId,
        preload: element.preload,
        playedLength: element.played.length,
        seeking: element.seeking,
        currentTime: element.currentTime,
        paused: element.paused,
      })),
    };
  });
}

function assertEngineMediaAudit(audit, alphaFileSize) {
  assert.ok(audit.videoResources.length > 0, JSON.stringify(audit.videoResources));
  assert.ok(audit.videoResources.length <= 4, JSON.stringify(audit.videoResources));
  assert.ok(audit.videoResources.every(entry => new URL(entry.name).pathname.endsWith('/alpha-layer.webm')),
    JSON.stringify(audit.videoResources));
  assert.ok(audit.videoEncodedBodySize < alphaFileSize * 0.2,
    `${audit.videoEncodedBodySize} should be less than 20% of ${alphaFileSize}`);
  assert.ok(audit.videoBodyEntryCount <= 1, JSON.stringify(audit.videoResources));
  assert.equal(audit.imgResources.length, 1, JSON.stringify(audit.imgResources));
  assert.ok(new URL(audit.imgResources[0].name).pathname.endsWith('/still-layer.png'));
  assert.deepEqual(audit.layerVideos, [{
    id: 'alpha-layer',
    preload: 'metadata',
    playedLength: 0,
    seeking: false,
    currentTime: 0,
    paused: true,
  }]);
}

async function clickOutputPoint(page, outputX, outputY) {
  const client = await page.locator('#layer-container').evaluate((element, point) => {
    const rect = element.getBoundingClientRect();
    const viewScale = rect.width / element.offsetWidth;
    return { x: rect.left + point.x * viewScale, y: rect.top + point.y * viewScale };
  }, { x: outputX, y: outputY });
  await page.mouse.click(client.x, client.y);
}

async function selectionState(page) {
  return await page.evaluate(() => {
    const container = document.getElementById('layer-container');
    const box = document.getElementById('layer-select-box');
    const containerRect = container.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const viewScale = containerRect.width / container.offsetWidth;
    return {
      alpha: document.querySelector('[data-layer-id="alpha-layer"]')?.classList.contains('layer-selected'),
      still: document.querySelector('[data-layer-id="still-layer"]')?.classList.contains('layer-selected'),
      display: getComputedStyle(box).display,
      rect: getComputedStyle(box).display === 'none' ? null : {
        x: (boxRect.left - containerRect.left) / viewScale,
        y: (boxRect.top - containerRect.top) / viewScale,
        width: boxRect.width / viewScale,
        height: boxRect.height / viewScale,
      },
    };
  });
}

function assertRectClose(actual, expected, tolerance = 1) {
  assert.ok(actual, 'selection rectangle should be visible');
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(actual[key] - expected[key]) <= tolerance,
      `${key}: expected ${expected[key]}±${tolerance}, got ${actual[key]}`);
  }
}

async function seekFiveTimes(page) {
  for (const value of [0.25, 1.25, 3.5, 5.5, 0]) {
    await page.locator('#seek').evaluate((element, next) => {
      element.value = String(next);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    await page.waitForTimeout(100);
  }
}

test('frame engine keeps legacy layer media metadata-only', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the metadata-only fixture');
  }

  let port;
  try {
    port = await freePort();
  } catch (error) {
    if (error?.code === 'EPERM') return t.skip('local listen is unavailable in this sandbox');
    throw error;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-legacy-media-idle-'));
  const previewDirectory = path.resolve(import.meta.dirname, '..');
  let browser;
  let server;
  try {
    generateFixture(ffmpegPath, project);
    const alphaFileSize = fs.statSync(path.join(project, 'alpha-layer.webm')).size;
    server = spawn('node', ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
      cwd: previewDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/api/codec-info`);
    browser = await chromium.launch({ headless: true });

    const engineContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const enginePage = await engineContext.newPage();
    const engineErrors = [];
    enginePage.on('pageerror', error => engineErrors.push(error.message));
    await enginePage.goto(`${base}/`, { waitUntil: 'load' });
    await enginePage.waitForSelector('#frame-engine-preview[data-frame-engine-ready="true"]', { timeout: 60_000 });
    await enginePage.waitForFunction(() => {
      const alpha = document.querySelector('[data-layer-id="alpha-layer"]');
      const still = document.querySelector('[data-layer-id="still-layer"]');
      return alpha?.videoWidth === 640 && alpha?.videoHeight === 360
        && still?.naturalWidth === 320 && still?.naturalHeight === 180;
    }, null, { timeout: 30_000 });
    await enginePage.waitForTimeout(1_000);

    const engineAuditBefore = await mediaAudit(enginePage);
    console.log('engine metadata-only media audit (before playback)', {
      alphaFileSize,
      videoRawEntries: engineAuditBefore.videoResources.length,
      videoBodyEntries: engineAuditBefore.videoBodyEntryCount,
      videoEncodedBodySize: engineAuditBefore.videoEncodedBodySize,
    });
    assertEngineMediaAudit(engineAuditBefore, alphaFileSize);
    assert.equal(engineAuditBefore.layerSrcCount, 2);
    assert.deepEqual(engineAuditBefore.baseSources, [
      { id: 'preview-video', src: '' },
      { id: 'transition-video', src: '' },
      { id: 'preview-image', src: '' },
    ]);

    await enginePage.locator('#play-toggle').click();
    await enginePage.waitForTimeout(2_500);
    await enginePage.locator('#play-toggle').click();
    await seekFiveTimes(enginePage);
    await enginePage.waitForTimeout(500);

    const engineAuditAfter = await mediaAudit(enginePage);
    console.log('engine metadata-only media audit (after playback/seeks)', {
      alphaFileSize,
      videoRawEntries: engineAuditAfter.videoResources.length,
      videoBodyEntries: engineAuditAfter.videoBodyEntryCount,
      videoEncodedBodySize: engineAuditAfter.videoEncodedBodySize,
    });
    assertEngineMediaAudit(engineAuditAfter, alphaFileSize);
    assert.equal(engineAuditAfter.videoEncodedBodySize, engineAuditBefore.videoEncodedBodySize);
    assert.equal(engineAuditAfter.videoBodyEntryCount, engineAuditBefore.videoBodyEntryCount);

    // 要素の箱は left=output.width/2+x、top=output.height/2+y、width/height=実寸×scale を
    // translate(-50%,-50%) する。alpha は left=640, top=360, 1280x720 → 出力
    // (0,0)-(1280,720)。ソース不透明部 (160,90)-(480,270) は scale 2 で要素ローカル
    // (320,180)-(960,540) → 出力も同矩形、中心は (640,360)。still は left=260,
    // top=140, 320x180 → 出力 (100,50)-(420,230)、中心は (260,140)。
    await clickOutputPoint(enginePage, 640, 360);
    let selected = await selectionState(enginePage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still, display: selected.display },
      { alpha: true, still: false, display: 'block' });
    assertRectClose(selected.rect, { x: 0, y: 0, width: 1280, height: 720 });

    await clickOutputPoint(enginePage, 260, 140);
    selected = await selectionState(enginePage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still, display: selected.display },
      { alpha: false, still: true, display: 'block' });
    assertRectClose(selected.rect, { x: 100, y: 50, width: 320, height: 180 });

    await clickOutputPoint(enginePage, 1100, 650);
    selected = await selectionState(enginePage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still }, { alpha: true, still: false });
    assert.deepEqual(engineErrors, []);
    await engineContext.close();

    const legacyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const legacyPage = await legacyContext.newPage();
    const legacyErrors = [];
    legacyPage.on('pageerror', error => legacyErrors.push(error.message));
    await legacyPage.goto(`${base}/?frameEngine=0`, { waitUntil: 'load' });
    await legacyPage.waitForFunction(() => performance.getEntriesByType('resource')
      .some(entry => entry.initiatorType === 'video' || entry.initiatorType === 'img'), null, { timeout: 30_000 });
    await legacyPage.waitForFunction(() => {
      const alpha = document.querySelector('[data-layer-id="alpha-layer"]');
      const still = document.querySelector('[data-layer-id="still-layer"]');
      return alpha?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && alpha?.videoWidth === 640 && still?.complete && still?.naturalWidth === 320;
    }, null, { timeout: 30_000 });
    const legacyAudit = await mediaAudit(legacyPage);
    assert.ok(legacyAudit.resources.length >= 1, JSON.stringify(legacyAudit.resources));
    assert.ok(legacyAudit.layerSrcCount >= 1);

    await clickOutputPoint(legacyPage, 640, 360);
    selected = await selectionState(legacyPage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still }, { alpha: true, still: false });

    await clickOutputPoint(legacyPage, 260, 140);
    selected = await selectionState(legacyPage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still }, { alpha: false, still: true });

    await clickOutputPoint(legacyPage, 1100, 650);
    selected = await selectionState(legacyPage);
    assert.deepEqual({ alpha: selected.alpha, still: selected.still }, { alpha: false, still: false });
    assert.deepEqual(legacyErrors, []);
    await legacyContext.close();
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
