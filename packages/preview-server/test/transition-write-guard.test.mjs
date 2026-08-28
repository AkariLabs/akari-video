import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { chromium } from 'playwright';
import { editForPut, normalizeLegacyCutTransitions } from '../public/transition-write-guard.js';

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require('../../edit-store/lib/migrate/index.js');

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PROJECT = path.resolve(PACKAGE_ROOT, '..', '..', 'test-project');
const SYSTEM_CHROME = process.env.CHROME_PATH
  || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);
const TRANSITION_TYPES = ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up'];

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

async function waitForServer(url, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* retry while the server starts */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview-server did not start within ${timeout}ms`);
}

function pollutedFixture() {
  return {
    version: 0,
    output: { width: 320, height: 180, fps: 30 },
    source: { path: 'source.mp4' },
    cuts: [
      {
        in: 0,
        out: 2,
        transition_out: { type: 'dissolve', duration: 0.25 },
        transitionOut: { type: 'fade-white', duration: 0.75 },
        transitionIn: { type: 'fade-black', duration: 0.4 },
      },
      { in: 2, out: 4 },
    ],
    overlays: [],
  };
}

async function openFirstCutEditor(page) {
  await page.evaluate(() => {
    const seek = document.getElementById('seek');
    seek.value = '0.25';
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await page.waitForSelector('#cut-inp-to-type', { state: 'visible' });
}

async function applyTransition(page, type, duration) {
  await openFirstCutEditor(page);
  await page.selectOption('#cut-inp-to-type', type);
  await page.fill('#cut-inp-to-dur', String(duration));
  const [response] = await Promise.all([
    page.waitForResponse(candidate => candidate.url().endsWith('/api/edit.json')
      && candidate.request().method() === 'PUT'),
    page.click('#cut-apply-btn'),
  ]);
  assert.equal(response.status(), 200, `transition ${type} PUT failed`);
}

function readEdit(project) {
  return JSON.parse(fs.readFileSync(path.join(project, 'edit.json'), 'utf8'));
}

function firstVideoItem(edit) {
  return edit.tracks.flatMap(track => track.items ?? [])
    .find(item => item.source?.kind === 'media');
}

function assertNoCamelCaseTransitions(edit) {
  const text = JSON.stringify(edit);
  assert.equal(text.includes('transitionOut'), false, 'transitionOut must not be persisted');
  assert.equal(text.includes('transitionIn'), false, 'transitionIn must not be persisted');
}

test('pure guard: camelCase OUT を優先吸収し、IN を purge する', () => {
  const edit = pollutedFixture();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    assert.equal(normalizeLegacyCutTransitions(edit), edit);
  } finally {
    console.warn = originalWarn;
  }
  assertNoCamelCaseTransitions(edit);
  assert.deepEqual(edit.cuts[0].transition_out, { type: 'fade-white', duration: 0.75 });
  assert.ok(warnings.some(message => message.includes('transitionOut')));
});

test('pure guard: PUT body 組み立て時にも残留キーを浄化する', () => {
  const edit = pollutedFixture();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(editForPut(edit), edit);
  } finally {
    console.warn = originalWarn;
  }
  assertNoCamelCaseTransitions(edit);
  assert.deepEqual(edit.cuts[0].transition_out, { type: 'fade-white', duration: 0.75 });
});

test('実 Web UI は transition_out だけを保存し、汚染キーを浄化して 5 種を往復する', {
  timeout: 45000,
}, async (t) => {
  if (!SYSTEM_CHROME || !fs.existsSync(SYSTEM_CHROME)) {
    t.skip('system Chrome is unavailable');
    return;
  }

  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-transition-write-guard-'));
  let server = null;
  let browser = null;
  try {
    fs.cpSync(SOURCE_PROJECT, project, { recursive: true });
    const sanitized = pollutedFixture();
    const originalWarn = console.warn;
    console.warn = () => {};
    try { normalizeLegacyCutTransitions(sanitized); } finally { console.warn = originalWarn; }
    const initial = migrateEditToV2(sanitized);
    assert.equal(initial.ok, true, JSON.stringify(initial));
    fs.writeFileSync(path.join(project, 'edit.json'), JSON.stringify(initial.doc, null, 2));

    let port;
    try { port = await freePort(); }
    catch (error) {
      if (error?.code === 'EPERM') { t.skip('local listen is unavailable in this sandbox'); return; }
      throw error;
    }
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [
      'src/server.mjs', project, '--port', String(port), '--no-lint',
    ], { cwd: PACKAGE_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let serverError = '';
    server.stderr.on('data', chunk => { serverError += chunk; });
    await waitForServer(`${base}/api/codec-info`);

    browser = await chromium.launch({ headless: true, executablePath: SYSTEM_CHROME });
    const page = await browser.newPage();
    const warnings = [];
    page.on('console', message => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    await page.goto(`${base}/?frameEngine=0`, { waitUntil: 'load', timeout: 15000 });
    await page.waitForFunction(() => Number(document.getElementById('seek')?.max) > 0);

    await openFirstCutEditor(page);
    assert.equal(await page.locator('#cut-inp-ti-type').count(), 0,
      'unsupported IN transition selector must be removed');
    assert.deepEqual(await page.locator('#cut-inp-to-type option').evaluateAll(options =>
      options.map(option => option.value)), ['', ...TRANSITION_TYPES]);
    assert.equal(await page.locator('#cut-inp-to-type').inputValue(), 'fade-white',
      'camelCase transitionOut must win when both keys exist');
    assert.equal(await page.locator('#cut-inp-to-dur').inputValue(), '0.75');
    assert.equal(warnings.some(message => message.includes('transitionOut')), false,
      `v2 summary must not contain legacy transitionOut: ${JSON.stringify(warnings)}`);

    // 汚染ファイルを開いた直後の summary model をそのまま UI から保存する。
    await applyTransition(page, 'fade-white', 0.75);
    let saved = readEdit(project);
    assertNoCamelCaseTransitions(saved);
    assert.deepEqual(firstVideoItem(saved).source.transition_out, { type: 'fade-white', duration: 0.75 });
    assert.equal(saved.version, 2);

    // 実 UI の全 option を選び、PUT 後の実ファイルから保存往復を確認する。
    for (const [index, type] of TRANSITION_TYPES.entries()) {
      const duration = 0.3 + index * 0.1;
      await applyTransition(page, type, duration);
      saved = readEdit(project);
      assertNoCamelCaseTransitions(saved);
      assert.deepEqual(firstVideoItem(saved).source.transition_out, { type, duration });

      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => Number(document.getElementById('seek')?.max) > 0);
      await openFirstCutEditor(page);
      assert.equal(await page.locator('#cut-inp-to-type').inputValue(), type);
      assert.ok(Math.abs(Number(await page.locator('#cut-inp-to-dur').inputValue()) - duration) < 0.000001,
        `transition ${type} duration did not survive reload`);
    }

    assert.equal(serverError, '', `preview-server stderr: ${serverError}`);
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => server.once('exit', resolve));
    }
    fs.rmSync(project, { recursive: true, force: true });
  }
});
