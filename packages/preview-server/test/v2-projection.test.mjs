import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { editToTimeline } from '../src/edit-to-timeline.mjs';
import { migratePreviewCompatibility, previewReadError, projectPreviewEdit } from '../src/preview-edit.mjs';

const require = createRequire(import.meta.url);
const { buildTimelineMap } = require('../../edit-store/lib/timeline-map.js');

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const SERVER = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'src', 'server.mjs');
const TEST_MEDIA = path.join(REPOSITORY_ROOT, 'test-project');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

const transitionTypes = ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up'];

function v2Fixture(transitionType = 'dissolve') {
  return {
    version: 2,
    output: { width: 320, height: 180, fps: 30 },
    sources: [
      { id: 'red', path: 'source.mp4' },
      { id: 'blue', path: 'source2.mp4' },
      { id: 'music', path: 'bgm.mp3' },
    ],
    tracks: [
      {
        id: 'a-bgm', lane: 'audio', items: [{
          id: 'bgm-item', at: 0, duration: 90, role: 'bgm', gain_db: -18,
          source: { kind: 'media', src: 'music', in: 0, out: 3 },
        }],
      },
      {
        id: 'a-sfx', lane: 'audio', items: [{
          id: 'sfx-item', at: 15, duration: 15, gain_db: -6, fade_in: 0.1, fade_out: 0.1,
          source: { kind: 'media', src: 'music', in: 0.2, out: 0.7 },
        }],
      },
      {
        id: 'v-main', lane: 'visual', items: [
          {
            id: 'cut-red', at: 0, duration: 60,
            source: {
              kind: 'media', src: 'red', in: 0, out: 4, speed: 2,
              transition_out: { type: transitionType, duration: 1 },
            },
          },
          {
            id: 'cut-blue', at: 30, duration: 60,
            source: { kind: 'media', src: 'blue', in: 0, out: 2 },
          },
        ],
      },
      {
        id: 'v-front', lane: 'visual', items: [{
          id: 'cut-front', at: 0, duration: 15,
          source: { kind: 'media', src: 'blue', in: 0, out: 0.5 },
        }],
      },
      {
        id: 'v-html', lane: 'visual', items: [{
          id: 'html-1', at: 0, duration: 90,
          source: { kind: 'html', path: 'overlays/title.html' },
        }],
      },
      {
        id: 'v-telop', lane: 'visual', items: [{
          id: 'telop-1', at: 15, duration: 60,
          source: { kind: 'telop', preset: 'test', params: { text: 'AKARI' }, baked: 'source2.mp4' },
        }],
      },
      {
        id: 'v-filter', lane: 'visual', items: [{
          id: 'filter-1', at: 0, duration: 90,
          source: { kind: 'filter', filter: { type: 'invert' } },
        }],
      },
    ],
  };
}

function makeProject(edit) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-preview-v2-'));
  fs.copyFileSync(path.join(TEST_MEDIA, 'source.mp4'), path.join(project, 'source.mp4'));
  fs.copyFileSync(path.join(TEST_MEDIA, 'source2.mp4'), path.join(project, 'source2.mp4'));
  fs.copyFileSync(path.join(TEST_MEDIA, 'bgm.mp3'), path.join(project, 'bgm.mp3'));
  fs.mkdirSync(path.join(project, 'overlays'));
  fs.writeFileSync(path.join(project, 'overlays', 'title.html'), '<div id="v2-html">HTML overlay</div>');
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(edit, null, 2));
  return project;
}

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

function contentType(filePath) {
  return ({
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ttf': 'font/ttf',
  })[path.extname(filePath)] || 'application/octet-stream';
}

async function installProjectRoutes(page, project, { legacy = false } = {}) {
  const raw = fs.readFileSync(path.join(project, 'edit.json'), 'utf-8');
  let summary;
  let timeline;
  let failure;
  try {
    summary = projectPreviewEdit(raw, path.join(project, '.akari', 'preview-projection'));
    timeline = editToTimeline(summary, project);
  } catch (error) {
    failure = previewReadError(error);
  }
  await page.route('http://example.test/**', async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    if (pathname === '/api/summary' || pathname === '/api/timeline') {
      if (failure) return route.fulfill({ status: failure.status, contentType: 'application/json', body: JSON.stringify(failure.body) });
      const body = pathname.endsWith('summary') ? summary : timeline;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    }
    if (pathname === '/api/captions.json') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (pathname === '/api/codec-info') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
      filePath = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'public', 'index.html');
    } else if (pathname === '/assets/fonts/akari-noto-sans-jp.ttf') {
      filePath = path.join(REPOSITORY_ROOT, 'assets', 'font', 'noto-sans-jp', 'NotoSansJP-Variable.ttf');
    } else {
      const publicFile = path.join(REPOSITORY_ROOT, 'packages', 'preview-server', 'public', pathname.slice(1));
      const projectFile = path.join(project, pathname.slice(1));
      filePath = fs.existsSync(publicFile) ? publicFile : projectFile;
    }
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return route.fulfill({ status: 404, body: 'not found' });
    }
    return route.fulfill({ status: 200, contentType: contentType(filePath), body: fs.readFileSync(filePath) });
  });
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

test('v2 summary/timeline use renderer projection and preserve all transition enums', async (t) => {
  for (const type of transitionTypes) {
    const project = makeProject(v2Fixture(type));
    try {
      const raw = fs.readFileSync(path.join(project, 'edit.json'), 'utf-8');
      const summary = projectPreviewEdit(raw, path.join(project, '.akari', 'preview-projection'));
      assert.equal(summary.cuts.length, 3);
      assert.equal(summary.overlays.length, 1);
      assert.deepEqual(summary.layers.map(layer => layer.kind).sort(), ['baked', 'filter']);
      assert.equal(summary.cuts[0].transition_out.type, type);
      assert.equal(JSON.stringify(summary).includes('transitionOut'), false);
      assert.equal(summary.audio.bgm.gain_db, -18);
      assert.equal(summary.audio.sfx[0].gain_db, -6);
      assert.equal(JSON.stringify(summary.audio).includes('gainDb'), false);
      assert.equal(migratePreviewCompatibility({ ...summary, layers: [] }).version, 2);

      const timeline = editToTimeline(summary, project);
      assert.equal(timeline.clips.length, 3);
      assert.equal(timeline.clips[1].startFrame, 30);
      assert.equal(timeline.clips[2].track, 1);
      const map = buildTimelineMap(summary.cuts.map(cut => ({
        ...cut, ...(cut.transition_out ? { transitionOut: cut.transition_out } : {}),
      })), { trackZ: track => track });
      assert.equal(map.totalDuration, 3);
      assert.equal(map.transitionWindows.length, 1);
      assert.equal(map.transitionWindows[0].type, type);
      assert.equal(map.segments.find(segment => segment.outStart === 0).cutIndex, 2,
        'larger track number must win');
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  }
});

test('v2 WebUI renders projected DOM, track winner, transition, speed and trimmed audio', async (t) => {
  const project = makeProject(v2Fixture());
  let server = null;
  try {
    server = await startServer(project);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }
  const browser = await launchChromeOrSkip(t);
  if (!browser) {
    if (server) await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
    return;
  }
  t.after(async () => {
    await browser.close();
    if (server) await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
  });

  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  if (!server) await installProjectRoutes(page, project);
  await page.goto(server?.base ?? 'http://example.test/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('preview-message').hidden === true);
  await page.waitForSelector('[data-overlay-id="html-1"]', { state: 'attached' });
  await page.waitForSelector('[data-layer-id="telop-1"]', { state: 'attached' });
  await page.waitForSelector('[data-layer-kind="filter"]', { state: 'attached' });

  const seekTo = async (seconds) => {
    await page.locator('#seek').evaluate((element, value) => {
      element.value = String(value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    }, seconds);
    await page.waitForTimeout(250);
  };

  await seekTo(0.25);
  await page.waitForFunction(() => document.getElementById('preview-video').currentSrc.includes('source2.mp4'));
  const winner = await page.locator('#preview-video').evaluate(element => element.currentSrc);
  assert.match(winner, /source2\.mp4$/);

  await seekTo(0.75);
  await page.click('#play-toggle');
  await page.waitForFunction(
    () => document.getElementById('preview-video').playbackRate === 2,
    null,
    { timeout: 5000 },
  );
  await page.waitForTimeout(300);
  const audio = await page.evaluate(() => ({
    bgmGain: window.akari.audioDebug.bgmNode?.gain.value,
    sfx: window.akari.audioDebug.sfxNodes[0]?._lastSchedule,
  }));
  assert.ok(Math.abs(audio.bgmGain - Math.pow(10, -18 / 20)) < 0.002, JSON.stringify(audio));
  assert.ok(audio.sfx, 'SFX was not scheduled');
  assert.ok(audio.sfx.offset >= 0.2 && audio.sfx.offset < 0.7, JSON.stringify(audio.sfx));
  assert.ok(audio.sfx.duration > 0 && audio.sfx.duration <= 0.5, JSON.stringify(audio.sfx));
  await page.click('#play-toggle');

  await seekTo(1.5);
  const rendered = await page.evaluate(() => {
    const previewVideo = document.getElementById('preview-video');
    const transitionVideo = document.getElementById('transition-video');
    const transitionEngineFilters = document.getElementById('transition-engine-filters');
    return {
      total: document.getElementById('time-label').textContent,
      transitionDisplay: getComputedStyle(transitionVideo).display,
      transitionOpacity: Number(getComputedStyle(transitionVideo).opacity),
      previewOpacity: Number(getComputedStyle(previewVideo).opacity),
      transitionFilter: getComputedStyle(transitionVideo).filter,
      transitionEngineFilters: Boolean(transitionEngineFilters),
      dissolveTableType: transitionEngineFilters
        ?.querySelector('feFuncA#akari-transition-dissolve-table')
        ?.getAttribute('type'),
      transitionProgress: transitionVideo.dataset.akariTransitionProgress,
      html: Boolean(document.querySelector('[data-overlay-id="html-1"]')),
      telop: Boolean(document.querySelector('[data-layer-id="telop-1"]')),
      filter: getComputedStyle(document.querySelector('[data-layer-kind="filter"]')).display,
    };
  });
  assert.match(rendered.total, /0:03\.00$/);
  assert.equal(rendered.transitionDisplay, 'block');
  assert.equal(rendered.transitionOpacity, 1);
  assert.equal(rendered.previewOpacity, 1);
  assert.match(rendered.transitionFilter, /akari-transition-dissolve/);
  assert.equal(rendered.transitionEngineFilters, true);
  assert.equal(rendered.dissolveTableType, 'discrete');
  assert.equal(rendered.transitionProgress, '0.500');
  assert.equal(rendered.html, true);
  assert.equal(rendered.telop, true);
  assert.equal(rendered.filter, 'block');
});

test('raw v1 fails loudly in HTTP and the Japanese UI migration message', async (t) => {
  const project = makeProject(v2Fixture());
  fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify({
    version: 1,
    output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'red', path: 'source.mp4' }],
    cuts: [{ src: 'red', in: 0, out: 1 }],
  }));
  let server = null;
  try {
    server = await startServer(project);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
  }
  const browser = await launchChromeOrSkip(t);
  if (!browser) {
    if (server) await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
    return;
  }
  t.after(async () => {
    await browser.close();
    if (server) await stopServer(server.child);
    fs.rmSync(project, { recursive: true, force: true });
  });

  const failure = (() => {
    try {
      projectPreviewEdit(fs.readFileSync(path.join(project, 'edit.json'), 'utf-8'), path.join(project, '.akari'));
      return null;
    } catch (error) {
      return previewReadError(error);
    }
  })();
  assert.equal(failure.status, 422);
  assert.match(failure.body.error, /akari migrate/);
  if (server) {
    const response = await fetch(`${server.base}/api/summary`);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /akari migrate/);
  }

  const page = await browser.newPage();
  if (!server) await installProjectRoutes(page, project, { legacy: true });
  await page.goto(server?.base ?? 'http://example.test/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('preview-message').hidden === false);
  assert.match(await page.locator('#preview-message-text').textContent(), /akari migrate/);
});
