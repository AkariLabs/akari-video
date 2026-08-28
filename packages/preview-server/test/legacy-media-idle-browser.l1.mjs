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
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4',
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-movflags', '+faststart',
    '-y', path.join(project, 'base.mp4'),
  ], 'H.264 base');

  run([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=red:size=640x360:rate=30:duration=4',
    '-f', 'lavfi', '-i',
    'color=c=black:size=640x360:rate=30:duration=4,drawbox=x=220:y=130:w=200:h=100:color=white:t=fill',
    '-filter_complex', '[0:v][1:v]alphamerge[v]', '-map', '[v]', '-an',
    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
    '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '500k',
    '-y', path.join(project, 'alpha-layer.webm'),
  ], 'VP9 alpha layer');

  run([
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=royalblue:size=320x180,drawgrid=w=40:h=30:t=3:c=white',
    '-frames:v', '1', '-threads', '1', '-y', path.join(project, 'still-layer.png'),
  ], 'PNG still layer');

  const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [
      { id: 'base', path: 'base.mp4', proxy: null },
      { id: 'alpha', path: 'alpha-layer.webm', proxy: null },
      { id: 'still', path: 'still-layer.png', proxy: null },
    ],
    tracks: [
      {
        id: 'base-track', lane: 'visual', items: [
          { id: 'base-cut', at: 0, duration: 120, source: { kind: 'media', src: 'base', in: 0, out: 4 } },
        ],
      },
      {
        id: 'alpha-track', lane: 'visual', items: [
          {
            id: 'alpha-layer', at: 0, duration: 120,
            transform: { x: 0, y: 0, scale: 1, rotate: 0 },
            source: { kind: 'media', src: 'alpha', in: 0, out: 4 },
          },
        ],
      },
      {
        id: 'still-track', lane: 'visual', items: [
          {
            id: 'still-layer', at: 0, duration: 120,
            transform: { x: -190, y: -110, scale: 1, rotate: 0 },
            source: { kind: 'media', src: 'still', in: 0, out: 4 },
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));
}

async function mediaAudit(page) {
  return page.evaluate(() => {
    const nonEmptySrc = element => Boolean(element.getAttribute('src') || element.src);
    return {
      mediaResources: performance.getEntriesByType('resource')
        .filter(entry => entry.initiatorType === 'video' || entry.initiatorType === 'img')
        .map(entry => ({ name: entry.name, initiatorType: entry.initiatorType })),
      layerSrcCount: Array.from(document.querySelectorAll('#layer-container video, #layer-container img'))
        .filter(nonEmptySrc).length,
      baseSources: ['preview-video', 'transition-video', 'preview-image']
        .map(id => {
          const element = document.getElementById(id);
          return { id, src: element?.getAttribute('src') || element?.src || '' };
        }),
      allMediaSrcCount: Array.from(document.querySelectorAll('video, img')).filter(nonEmptySrc).length,
    };
  });
}

async function assertAlphaLayerSelected(page) {
  const point = await page.locator('#preview-stage').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const selected = await page.evaluate(() => ({
    alpha: document.querySelector('[data-layer-id="alpha-layer"]')?.classList.contains('layer-selected'),
    still: document.querySelector('[data-layer-id="still-layer"]')?.classList.contains('layer-selected'),
    box: getComputedStyle(document.getElementById('layer-select-box')).display,
  }));
  await page.mouse.up();
  assert.deepEqual(selected, { alpha: true, still: false, box: 'block' });
}

test('frame engine keeps legacy video and image elements media-idle', { timeout: 180_000 }, async t => {
  let ffmpegPath;
  try {
    ffmpegPath = resolveFfmpeg();
  } catch {
    return t.skip('ffmpeg is unavailable for the media-idle fixture');
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
    await enginePage.waitForTimeout(1_000);

    const engineAudit = await mediaAudit(enginePage);
    assert.deepEqual(engineAudit.mediaResources, []);
    assert.equal(engineAudit.layerSrcCount, 0);
    assert.equal(engineAudit.allMediaSrcCount, 0);
    assert.deepEqual(engineAudit.baseSources, [
      { id: 'preview-video', src: '' },
      { id: 'transition-video', src: '' },
      { id: 'preview-image', src: '' },
    ]);

    await assertAlphaLayerSelected(enginePage);
    assert.deepEqual(engineErrors, []);
    await engineContext.close();

    const legacyContext = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(`${base}/?frameEngine=0`, { waitUntil: 'load' });
    await legacyPage.waitForFunction(() => performance.getEntriesByType('resource')
      .some(entry => entry.initiatorType === 'video' || entry.initiatorType === 'img'), null, { timeout: 30_000 });
    await legacyPage.waitForFunction(() => {
      const alpha = document.querySelector('[data-layer-id="alpha-layer"]');
      const still = document.querySelector('[data-layer-id="still-layer"]');
      return alpha?.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && still?.complete && still?.naturalWidth === 320;
    }, null, { timeout: 30_000 });
    const legacyAudit = await mediaAudit(legacyPage);
    assert.ok(legacyAudit.mediaResources.length >= 1, JSON.stringify(legacyAudit.mediaResources));
    assert.ok(legacyAudit.allMediaSrcCount >= 1);
    assert.ok(legacyAudit.layerSrcCount >= 1);
    await assertAlphaLayerSelected(legacyPage);
    await legacyContext.close();
  } finally {
    await browser?.close();
    server?.kill('SIGTERM');
    fs.rmSync(project, { recursive: true, force: true });
  }
});
