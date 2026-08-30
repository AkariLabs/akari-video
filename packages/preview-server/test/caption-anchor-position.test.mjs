import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { chromium } from 'playwright';
import { captionTextStyleVars } from '../../render-cut/src/captions.mjs';
import { captionAnchorPositionVars as bundledCaptionAnchorPositionVars } from '../public/edit-kernel.bundle.js';

const require = createRequire(import.meta.url);
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const { captionAnchorPositionVars } = require(join(repositoryRoot, 'packages/edit-store/lib/index.js'));
const serverEntry = join(packageRoot, 'src/server.mjs');
const sourceProject = join(repositoryRoot, 'test-project');

const POSITION_VARS = [
  '--caption-top', '--caption-bottom', '--caption-left', '--caption-right',
  '--caption-translate',
  '--caption-justify-content', '--caption-align-items',
  '--caption-line-margin', '--caption-line-max-width', '--caption-text-align',
];

test('shared kernel, render-cut, and browser bundle return the same anchor position variables', () => {
  const style = { text_anchor: 'tc', position: { y: 0.386458 } };
  const expected = captionTextStyleVars(style);
  const shared = captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);
  const bundled = bundledCaptionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);

  assert.deepEqual(shared, expected);
  assert.deepEqual(bundled, expected);
  assert.equal(shared['--caption-top'], '38.65%');
  assert.equal(shared['--caption-bottom'], 'auto');
});

test('shared kernel, render-cut, and browser bundle agree on bottom-anchor position.y', () => {
  const style = { text_anchor: 'bc', position: { y: 0.905 } };
  const expected = captionTextStyleVars(style);
  const shared = captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);
  const bundled = bundledCaptionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);

  assert.deepEqual(shared, expected);
  assert.deepEqual(bundled, expected);
  assert.equal(shared['--caption-top'], 'auto');
  assert.equal(shared['--caption-bottom'], '9.5%');
});

test('shared kernel, render-cut, and browser bundle agree on middle-anchor position.y', () => {
  const style = { text_anchor: 'mc', position: { y: 0.5 } };
  const expected = captionTextStyleVars(style);
  const shared = captionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);
  const bundled = bundledCaptionAnchorPositionVars(style.text_anchor, style.position, style.vertical_align);

  assert.deepEqual(shared, expected);
  assert.deepEqual(bundled, expected);
  assert.equal(shared['--caption-top'], '50%');
  assert.equal(shared['--caption-bottom'], 'auto');
  assert.equal(shared['--caption-translate'], '0 -50%');
});

test('zone-only and unspecified legacy cues keep exactly the existing zone variables', { timeout: 120_000 }, async () => {
  const captions = [
    legacyCue('c-zone', 0.5, 1.5, '右上', { zone: 'top-right' }),
    legacyCue('c-default', 2.5, 3.5, '既定下段'),
  ];
  await withPreview(captions, async page => {
    assert.deepEqual(await captionPositionVarsAt(page, 1, '右上'), {
      '--caption-top': '7%',
      '--caption-bottom': 'auto',
      '--caption-left': '4%',
      '--caption-right': '4%',
      '--caption-justify-content': 'flex-start',
      '--caption-align-items': 'flex-end',
      '--caption-line-margin': '0',
      '--caption-line-max-width': '100%',
      '--caption-text-align': 'right',
    });
    assert.deepEqual(await captionPositionVarsAt(page, 3, '既定下段'), {});
  });
});

test('default_text_style supplies anchor and position when a cue has no text_style', { timeout: 120_000 }, async () => {
  const captions = {
    default_text_style: {
      text_anchor: 'tc',
      position: { y: 0.386458 },
    },
    captions: [legacyCue('c-default-style', 0.5, 1.5, '既定位置')],
  };
  await withPreview(captions, async page => {
    const vars = await captionPositionVarsAt(page, 1, '既定位置');
    assert.equal(vars['--caption-top'], '38.65%');
    assert.equal(vars['--caption-bottom'], 'auto');
  });
});

function legacyCue(id, start, end, text, textStyle) {
  return {
    id, start, end, text, speaker: null, sourceRef: null, edited: false,
    ...(textStyle ? { text_style: textStyle } : {}),
  };
}

async function captionPositionVarsAt(page, seconds, expectedText) {
  await page.waitForFunction(({ value, text }) => {
    const seek = document.getElementById('seek');
    const plate = document.getElementById('caption-plate');
    if (!seek || !plate || !(Number(seek.max) > 0)) return false;
    // init 直後の取りこぼしに備え、字幕が一致するまで seek を再送する。
    // 停止中は seek の input でしか字幕が再描画されない。
    seek.value = String(value);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    return plate.textContent.trim() === text;
  }, { value: seconds, text: expectedText }, { timeout: 60_000 });
  return page.evaluate(names => {
    const style = document.getElementById('caption-plate').style;
    return Object.fromEntries(names.flatMap(name => {
      const value = style.getPropertyValue(name);
      return value === '' ? [] : [[name, value]];
    }));
  }, POSITION_VARS);
}

async function withPreview(captions, inspect) {
  const temporary = await mkdtemp(join(tmpdir(), 'akari-caption-anchor-position-'));
  let server;
  let browser;
  try {
    fs.cpSync(sourceProject, temporary, { recursive: true });
    await writeFile(join(temporary, 'captions.json'), JSON.stringify(captions));
    const port = await freePort();
    server = spawn(process.execPath, [serverEntry, temporary, '--port', String(port), '--no-lint'], {
      cwd: packageRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    await waitForServer(server, port);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'load' });
    await inspect(page);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) server.kill('SIGTERM');
    await rm(temporary, { recursive: true, force: true });
  }
}

async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForServer(server, port) {
  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`preview server exited ${server.exitCode}: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/summary`);
      if (response.ok) return;
      throw new Error(`preview server returned HTTP ${response.status}: ${await response.text()}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('preview server returned HTTP')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview server timeout: ${stderr}`);
}
