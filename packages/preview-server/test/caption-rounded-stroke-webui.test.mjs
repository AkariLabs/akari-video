import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { roundedCaptionStrokeShadows as webRoundedStroke } from '../public/caption-rounded-stroke.js';
import { roundedCaptionStrokeShadows as renderRoundedStroke } from '../../render-cut/src/captions.mjs';
import { resolveCaptionPlan } from '../../render-cut/src/caption-resolve.mjs';
import { readRenderEdit } from '../../render-cut/src/internal-render.mjs';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const sourceProject = join(repositoryRoot, 'test-project');
const STROKE = { color: '#102030', width_px: 3 };
const SHADOW = { color: '#000000', distance_px: 4, blur_px: 6, angle_deg: 90 };
const CUES = [
  { id: 'placed', start: 0.5, end: 2, text: '置いた文字', time_domain: 'output', text_style: { stroke: STROKE, shadow: SHADOW } },
  { id: 'spoken', src: 'main', start: 6, end: 7.5, text: '話した言葉', text_style: { stroke: STROKE, shadow: SHADOW } },
  { id: 'placed-gradient', start: 2.5, end: 4, text: 'グラデ文字', time_domain: 'output',
    text_style: { stroke: STROKE, fill_gradient: { colors: ['#ff0000', '#0000ff'], angle_deg: 90 } } },
  { id: 'placed-nostroke', start: 8, end: 9.5, text: '縁なし文字', time_domain: 'output', text_style: { color: '#ffee00' } },
];
const POLICY = {
  mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 14,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 1, wrap: 'multi',
};

test('browser copy returns exactly the render-cut rounded stroke shadows', () => {
  const strokes = [
    '3px #102030', '3.5px rgba(0, 0, 0, .8)', '0 transparent', '0px #000',
    '3 #000', '-3px #000', '1001px #000', '1000px red', '.5px blue',
    '2px #fff', '2px rgb(16 32 48 / 50%)', '2px rebeccapurple',
    undefined, null, '', '  3px  hsl(0 100% 50%)  ',
  ];
  for (const stroke of strokes) {
    for (const shadow of [undefined, 'none', '0px 4px 6px #000']) {
      assert.deepEqual(webRoundedStroke(stroke, shadow), renderRoundedStroke(stroke, shadow),
        `stroke=${String(stroke)}, shadow=${String(shadow)}`);
    }
  }
});

test('Web UI and render-cut agree for placed and spoken captions in both routes', { timeout: 240_000 }, async t => {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    t.skip('playwright is unavailable');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    t.skip('Chromium is unavailable');
    return;
  }
  try {
    for (const [route, captionsRoot] of [
      ['legacy', CUES],
      ['resolved', { display_policy: POLICY, captions: CUES }],
    ]) {
      const project = await mkdtemp(join(tmpdir(), 'akari-rounded-stroke-'));
      let server;
      try {
        await cp(sourceProject, project, { recursive: true });
        await writeFile(join(project, 'captions.json'), JSON.stringify(captionsRoot));
        let port;
        try {
          port = await freePort();
        } catch (error) {
          if (error.code === 'EPERM') { t.skip('local listen is unavailable'); return; }
          throw error;
        }
        server = spawn(process.execPath, ['src/server.mjs', project, '--port', String(port), '--no-lint'], {
          cwd: packageRoot, stdio: ['ignore', 'ignore', 'pipe'],
        });
        server.on('error', error => { server.startupError = error; });
        try {
          await waitForServer(server, port);
        } catch (error) {
          if (error.code === 'EPERM' || /listen EPERM/u.test(error.message)) {
            t.skip('local listen is unavailable'); return;
          }
          throw error;
        }
        const webPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const renderPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        try {
          const pageErrors = [];
          webPage.on('pageerror', error => pageErrors.push(String(error)));
          await webPage.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'load' });
          const { edit } = readRenderEdit(await readFile(join(project, 'edit.json'), 'utf8'),
            join(project, '.tmp'), { projectRoot: project });
          const plan = resolveCaptionPlan({ captionsRoot, edit, projectRoot: project });
          assert.ok(plan.overlays.length >= CUES.length, `${route}: render overlays`);
          for (const cue of CUES) {
            const overlay = plan.overlays.find(item => item.generatedFrom === cue.id || item.id === cue.id
              || String(item.generatedFrom ?? item.id).startsWith(`${cue.id}:`));
            assert.ok(overlay, `${route}/${cue.id}: render overlay`);
            const web = await measureWeb(webPage, cue);
            const render = await measureRender(renderPage, overlay);
            assert.equal(web.strokeWidth, render.strokeWidth, `${route}/${cue.id}: stroke width`);
            assert.equal(web.textShadow, render.textShadow, `${route}/${cue.id}: shadow`);
            if (cue.id === 'placed') {
              assert.equal(web.strokeWidth, '0px');
              assert.equal((web.textShadow.match(/rgb\(16, 32, 48\)/gu) ?? []).length, 32,
                `${route}: 32 rounded stroke offsets`);
              assert.equal((web.textShadow.match(/rgb\(0, 0, 0\)/gu) ?? []).length, 1,
                `${route}: original shadow`);
              assert.equal(web.roundedClass, true);
            } else if (cue.id === 'spoken') {
              assert.equal(web.strokeWidth, '6px');
              assert.equal(web.textShadow.includes('rgb(16, 32, 48)'), false,
                `${route}: spoken caption has no rounded stroke shadows`);
              assert.equal(web.roundedClass, false);
            } else if (cue.id === 'placed-gradient') {
              assert.equal(web.strokeWidth, '0px');
              assert.equal(web.textShadow, 'none');
            } else {
              assert.equal(web.roundedClass, false);
              assert.equal(web.roundedVar, '');
            }
          }
          assert.deepEqual(pageErrors, [], `${route}: browser errors`);
        } finally {
          await webPage.close();
          await renderPage.close();
        }
      } finally {
        if (server?.pid && server.exitCode === null && server.signalCode === null) {
          server.kill('SIGTERM');
          await new Promise(resolve => server.once('close', resolve));
        }
        await rm(project, { recursive: true, force: true });
      }
    }
  } finally {
    await browser.close();
  }
});

async function measureWeb(page, cue) {
  const second = (cue.start + cue.end) / 2;
  await page.waitForFunction(({ second, text }) => {
    const seek = document.getElementById('seek');
    const plate = document.getElementById('caption-plate');
    if (!seek || !plate || !(Number(seek.max) > 0)) return false;
    seek.value = String(second);
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    return plate.textContent.includes(text);
  }, { second, text: cue.text }, { polling: 250, timeout: 30_000 });
  return page.evaluate(() => {
    const element = document.querySelector('#caption-plate .akari-caption__line, #caption-plate .akari-caption__resolved-line');
    const row = element?.closest('.caption-row-plate');
    assertElement(element, row);
    const style = getComputedStyle(element);
    return {
      strokeWidth: style.webkitTextStrokeWidth,
      textShadow: style.textShadow,
      roundedClass: row.classList.contains('akari-caption--rounded-stroke'),
      roundedVar: row.style.getPropertyValue('--caption-rounded-stroke'),
    };
    function assertElement(line, plate) { if (!line || !plate) throw new Error('caption line missing'); }
  });
}

async function measureRender(page, overlay) {
  const vars = Object.entries(overlay.vars ?? {}).map(([name, value]) => `${name}:${value}`).join(';');
  await page.setContent(`<div style="position:relative;width:1280px;height:720px"><div style="position:absolute;inset:0;${vars}">${overlay.html}</div></div>`);
  return page.locator('.akari-caption__line').first().evaluate(element => {
    const style = getComputedStyle(element);
    return { strokeWidth: style.webkitTextStrokeWidth, textShadow: style.textShadow };
  });
}

function freePort() {
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
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (server.startupError) throw server.startupError;
    if (server.exitCode !== null) {
      const error = new Error(`preview server exited ${server.exitCode}: ${stderr}`);
      if (/EPERM/u.test(stderr)) error.code = 'EPERM';
      throw error;
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch { /* still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`preview server did not start: ${stderr}`);
}
