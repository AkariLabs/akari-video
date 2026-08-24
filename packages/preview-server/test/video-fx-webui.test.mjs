import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';
import { editToTimeline } from '../src/edit-to-timeline.mjs';
import { projectPreviewEdit } from '../src/preview-edit.mjs';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'src', 'server.mjs');
const FIXTURES = path.join(REPOSITORY_ROOT, 'dev-fixtures', 'preview-lut-chroma');
const VIDEO_FX_SOURCE = path.join(REPOSITORY_ROOT, 'packages', 'overlay-runtime', 'src', 'video-fx.js');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 180;

async function freePort() {
  return await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(project) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER, project, '--port', String(port), '--no-lint'], {
    cwd: REPOSITORY_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`preview server timeout: ${stderr}`)), 15_000);
    child.once('exit', code => reject(new Error(`preview server exited ${code}: ${stderr}`)));
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes(`:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}

async function launchChromeOrSkip(t) {
  try {
    return await chromium.launch({
      headless: true,
      ...(SYSTEM_CHROME && fs.existsSync(SYSTEM_CHROME) ? { executablePath: SYSTEM_CHROME } : {}),
    });
  } catch (error) {
    t.skip(`headless Chrome is unavailable in this sandbox: ${error.message.split('\n')[0]}`);
    return null;
  }
}

async function openProject(browser, project, testOptions = {}) {
  const server = await startServer(project);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  if (Object.keys(testOptions).length > 0) {
    await page.addInitScript(options => { window.__akariVideoFxTestOptions = options; }, testOptions);
  }
  await page.goto(server.base, { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('preview-message').hidden === true);
  return { page, server };
}

async function closeProject(opened) {
  await opened.page.close();
  await stopServer(opened.server.child);
}

async function seekTo(page, seconds) {
  await page.locator('#seek').evaluate((element, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, seconds);
}

function referenceFrame(referencePath) {
  const result = spawnSync(resolveFfmpeg(), [
    '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', referencePath,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], { encoding: null, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, 'ffmpeg must decode the reference frame');
  return result.stdout;
}

async function compositeFrame(page) {
  const base64 = await page.evaluate(({ width, height }) => {
    const output = document.createElement('canvas');
    output.width = width;
    output.height = height;
    const context = output.getContext('2d', { willReadFrequently: true });
    const baseRail = document.querySelector('canvas[data-akari-video-fx-role="source"]');
    const baseVideo = document.getElementById('preview-video');
    const baseImage = document.getElementById('preview-image');
    if (baseRail && baseRail.dataset.akariVideoFxStatus === 'ready') {
      context.drawImage(baseRail, 0, 0, width, height);
    } else if (getComputedStyle(baseImage).display !== 'none' && baseImage.complete) {
      context.drawImage(baseImage, 0, 0, width, height);
    } else {
      context.drawImage(baseVideo, 0, 0, width, height);
    }
    for (const rail of document.querySelectorAll('canvas[data-akari-video-fx-role^="layer:"]')) {
      const style = getComputedStyle(rail);
      if (style.display === 'none' || rail.dataset.akariVideoFxStatus !== 'ready') continue;
      const railWidth = Number.parseFloat(style.width) || rail.width;
      const railHeight = Number.parseFloat(style.height) || rail.height;
      const left = Number.parseFloat(style.left) - railWidth / 2;
      const top = Number.parseFloat(style.top) - railHeight / 2;
      context.globalAlpha = Number(style.opacity);
      context.drawImage(rail, left, top, railWidth, railHeight);
      context.globalAlpha = 1;
    }
    const bytes = context.getImageData(0, 0, width, height).data;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x4000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
    }
    return btoa(binary);
  }, { width: FRAME_WIDTH, height: FRAME_HEIGHT });
  return Buffer.from(base64, 'base64');
}

function frameMad(actual, expected) {
  assert.equal(actual.length, expected.length);
  let absolute = 0;
  for (let index = 0; index < actual.length; index += 4) {
    absolute += Math.abs(actual[index] - expected[index]);
    absolute += Math.abs(actual[index + 1] - expected[index + 1]);
    absolute += Math.abs(actual[index + 2] - expected[index + 2]);
  }
  return absolute / ((actual.length / 4) * 3 * 255);
}

async function measureFixture(browser, fixtureName, testOptions = {}) {
  const project = path.join(FIXTURES, fixtureName);
  const opened = await openProject(browser, project, testOptions);
  try {
    const summary = await opened.page.evaluate(() => fetch('/api/summary').then(response => response.json()));
    const timeline = await opened.page.evaluate(() => fetch('/api/timeline').then(response => response.json()));
    assert.ok(summary.videoFx, 'summary must expose the projected video FX');
    assert.ok(timeline.videoFx, 'timeline must expose the projected video FX');
    await seekTo(opened.page, 1);
    await opened.page.waitForFunction(() => {
      const rails = window.akari?.videoFx?.inspect?.() ?? [];
      return document.getElementById('preview-video').readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && rails.some(rail => rail.status === 'ready')
        && [...document.querySelectorAll('canvas.akari-video-fx-rail')]
          .some(canvas => canvas.width > 0 && canvas.height > 0);
    }, null, { timeout: 10_000 });
    await opened.page.waitForTimeout(300);
    const baseRectDelta = await opened.page.evaluate(() => {
      const rail = document.querySelector('canvas[data-akari-video-fx-role="source"]');
      if (!rail) return null;
      const mediaRect = document.getElementById('preview-video').getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      return Math.max(
        Math.abs(mediaRect.left - railRect.left), Math.abs(mediaRect.top - railRect.top),
        Math.abs(mediaRect.width - railRect.width), Math.abs(mediaRect.height - railRect.height),
      );
    });
    if (baseRectDelta !== null) assert.ok(baseRectDelta <= 1, `base rail geometry drifted by ${baseRectDelta}px`);
    const actual = await compositeFrame(opened.page);
    const expected = referenceFrame(path.join(project, 'exports', 'reference.mp4'));
    const mad = frameMad(actual, expected);
    const mode = testOptions.forceWebGl1 ? ' WebGL1' : '';
    console.log(`[video-fx MAD] ${fixtureName}${mode}: ${mad.toFixed(6)}`);
    assert.ok(mad <= 0.01, `${fixtureName}${mode} MAD ${mad} exceeds 0.01`);
    if (testOptions.forceWebGl1) {
      const versions = await opened.page.evaluate(() => window.akari.videoFx.inspect().map(rail => rail.webglVersion));
      assert.ok(versions.length > 0 && versions.every(version => version === 1));
    }
    return mad;
  } finally {
    await closeProject(opened);
  }
}

test('video FX projection resolves LUT and source/layer chroma without mutating legacy fields', () => {
  const project = name => path.join(FIXTURES, name);
  const projectSummary = name => {
    const root = project(name);
    return projectPreviewEdit(
      fs.readFileSync(path.join(root, 'edit.json'), 'utf8'),
      path.join(root, '.akari', 'preview-projection'),
      root,
    );
  };
  const sourceChroma = projectSummary('a-source-chroma');
  assert.equal(sourceChroma.sources[0].chroma_key.background, '0x2040FF');
  assert.deepEqual(sourceChroma.videoFx.sources.main.background, { type: 'color', color: '0x2040FF' });
  assert.equal(sourceChroma.videoFx.sources.main.mode, 'source');

  const lut = projectSummary('b-lut-050');
  assert.equal(lut.output.look.lut, 'cinematic');
  assert.equal(lut.videoFx.look.intensity, 0.5);
  assert.match(lut.videoFx.look.cubeText, /LUT_3D_SIZE/);
  assert.deepEqual(editToTimeline(lut, project('b-lut-050')).videoFx, lut.videoFx);

  const layer = projectSummary('d-layer-chroma');
  assert.deepEqual(layer.videoFx.sources, {});
  assert.equal(layer.layers.some(value => value.chroma_key?.color === '0x00FF00'), true);

  const inert = projectSummary('inert');
  assert.equal(inert.videoFx, undefined);
  assert.deepEqual(inert.indicators, []);

  const masterEdit = JSON.parse(fs.readFileSync(path.join(project('inert'), 'edit.json'), 'utf8'));
  masterEdit.audio = { master: { denoise: 'std', loudnorm: -14 } };
  const master = projectPreviewEdit(
    masterEdit,
    path.join(project('inert'), '.akari', 'preview-projection'),
    project('inert'),
  );
  assert.deepEqual(master.indicators, ['音声マスター処理']);
});

function makeAudioMasterProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-fx-master-'));
  const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'inert', 'edit.json'), 'utf8'));
  fixture.audio = { master: { denoise: 'std', loudnorm: -14 } };
  fs.mkdirSync(path.join(project, 'media'));
  fs.copyFileSync(
    path.join(FIXTURES, 'inert', 'media', 'pattern.mp4'),
    path.join(project, 'media', 'pattern.mp4'),
  );
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(fixture, null, 2));
  return project;
}

test('WebUI video FX rail matches render references in Chrome', async (t) => {
  const browser = await launchChromeOrSkip(t);
  if (!browser) return;
  t.after(() => browser.close());

  for (const fixtureName of ['a-source-chroma', 'b-lut-100', 'b-lut-050', 'd-layer-chroma']) {
    await t.test(fixtureName, async () => {
      await measureFixture(browser, fixtureName);
    });
  }
  await t.test('b-lut-100 forceWebGl1', async () => {
    await measureFixture(browser, 'b-lut-100', { forceWebGl1: true });
  });
});

test('video FX runtime is served from its single repository source', async (t) => {
  let server;
  try {
    server = await startServer(path.join(FIXTURES, 'inert'));
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    t.skip('local preview server sockets are unavailable in this sandbox');
    return;
  }
  t.after(() => stopServer(server.child));
  const response = await fetch(`${server.base}/video-fx.js`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), fs.readFileSync(VIDEO_FX_SOURCE, 'utf8'));
});

test('undeclared project keeps the video FX rail structurally inert', async (t) => {
  const browser = await launchChromeOrSkip(t);
  if (!browser) return;
  const opened = await openProject(browser, path.join(FIXTURES, 'inert'));
  t.after(async () => { await closeProject(opened); await browser.close(); });
  await opened.page.waitForFunction(() => document.getElementById('preview-video').readyState >= 2);
  const state = await opened.page.evaluate(() => ({
    railCount: document.querySelectorAll('canvas.akari-video-fx-rail').length,
    inspect: window.akari.videoFx.inspect(),
    baseNext: document.getElementById('preview-video').nextElementSibling?.id,
    transitionNext: document.getElementById('transition-video').nextElementSibling?.id,
  }));
  assert.deepEqual(state, {
    railCount: 0,
    inspect: [],
    baseNext: 'transition-video',
    transitionNext: 'preview-image',
  });
});

test('audio.master is disclosed in the indicators popup', async (t) => {
  const browser = await launchChromeOrSkip(t);
  if (!browser) return;
  const project = makeAudioMasterProject();
  const opened = await openProject(browser, project);
  t.after(async () => {
    await closeProject(opened);
    await browser.close();
    fs.rmSync(project, { recursive: true, force: true });
  });
  await opened.page.click('#indicator-toggle');
  assert.match(await opened.page.locator('#indicator-popup').textContent(), /音声マスター処理/);
});

test('forced rail failure collapses canvases, discloses LUT and keeps playback running', async (t) => {
  const browser = await launchChromeOrSkip(t);
  if (!browser) return;
  const opened = await openProject(browser, path.join(FIXTURES, 'b-lut-100'), { forceFailure: true });
  t.after(async () => { await closeProject(opened); await browser.close(); });
  await opened.page.waitForFunction(() => document.getElementById('preview-video').readyState >= 2);
  assert.equal(await opened.page.locator('canvas.akari-video-fx-rail').count(), 0);
  await opened.page.click('#indicator-toggle');
  assert.match(await opened.page.locator('#indicator-popup').textContent(), /LUT/);
  await opened.page.click('#play-toggle');
  const before = await opened.page.locator('#preview-video').evaluate(video => video.currentTime);
  await opened.page.waitForTimeout(400);
  const playback = await opened.page.locator('#preview-video').evaluate(video => ({
    readyState: video.readyState,
    paused: video.paused,
    currentTime: video.currentTime,
  }));
  assert.ok(playback.readyState >= 2);
  assert.equal(playback.paused, false);
  assert.ok(playback.currentTime > before + 0.1, JSON.stringify(playback));
});
