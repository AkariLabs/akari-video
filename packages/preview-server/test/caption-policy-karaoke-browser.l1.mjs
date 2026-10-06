import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { resolveCaptionPlan } from '../../render-cut/src/caption-resolve.mjs';

const enabled = process.env.AKARI_KARAOKE_PREVIEW_L1 === '1';
const root = resolve(import.meta.dirname, '../../..');

test('resolved two-line karaoke changes one measured word across a frame boundary',
  { skip: !enabled, timeout: 120_000 }, async () => {
    const project = await mkdtemp(join(tmpdir(), 'karaoke-preview-'));
    let child;
    let browser;
    try {
      const video = join(project, 'base.mp4');
      const generated = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error',
        '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=30:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { encoding: 'utf8' });
      assert.equal(generated.status, 0, generated.stderr);
      const words = ['あいう', 'えおか', 'きくけ', 'こさし'].map((text, index) => ({
        text, start: index * 0.5, end: (index + 1) * 0.5,
      }));
      await writeFile(join(project, 'edit.json'), JSON.stringify({ version: 2,
        sources: [{ id: 'main', path: 'base.mp4' }], output: { width: 640, height: 360, fps: 30 },
        tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 60,
          source: { kind: 'media', src: 'main', in: 0, out: 2, speed: 1 } }] },
        { id: 'captions', lane: 'visual', items: [{ id: 'caption-track', at: 0, duration: 60,
          source: { kind: 'captions', path: 'captions.json' }, items: [] }] }] }));
      const captionsRoot = { display_policy: {
        mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
        unit_metric: 'ascii-half-other-one-v1', max_line_units: 12,
        minimum_fragment_duration_seconds: 0.1, locale: 'ja', lines: 2, word_style: 'karaoke',
      }, captions: [{ id: 'c-1', src: 'main', start: 0, end: 2,
        text: words.map(word => word.text).join(''), display_fragments: ['あいうえおか', 'きくけこさし'], words,
        text_style: { karaoke: { fill: 'word', done_color: '#fb923c' } } }] };
      await writeFile(join(project, 'captions.json'), JSON.stringify(captionsRoot));
      const renderEdit = { version: 1,
        sources: [{ id: 'main', path: 'base.mp4' }], cuts: [{ src: 'main', in: 0, out: 2 }],
        output: { width: 640, height: 360, fps: 30 } };
      const renderPlan = resolveCaptionPlan({ captionsRoot, edit: renderEdit });
      const port = await new Promise((resolvePort, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const address = server.address();
          server.close(error => error ? reject(error) : resolvePort(address.port));
        });
      });
      child = spawn(process.execPath, [join(root, 'packages/preview-server/src/server.mjs'),
        '--port', String(port), project], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      await new Promise((ready, reject) => {
        const timeout = setTimeout(() => reject(new Error(`preview startup: ${stderr}`)), 20_000);
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`preview exited ${code}: ${stderr}`)); });
        child.stdout.on('data', chunk => {
          if (String(chunk).includes(`bind: 127.0.0.1:${port}`)) { clearTimeout(timeout); ready(); }
        });
      });
      browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
      await page.goto(`http://127.0.0.1:${port}/?frameEngine=0`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => 'editMode' in (window.akari ?? {}));
      await page.evaluate(() => {
        const seek = document.getElementById('seek');
        seek.value = '0.2';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll('.akari-caption__resolved-line').length === 2,
        undefined, { timeout: 15_000 });
      const sample = async time => page.evaluate(time => {
        const seek = document.getElementById('seek');
        seek.value = String(time);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
          const lines = [...document.querySelectorAll('.akari-caption__resolved-line')];
          const tokens = [...document.querySelectorAll('.akari-caption__tok--karaoke')];
          resolve({ lines: lines.map(line => line.textContent),
            colors: tokens.map(token => getComputedStyle(token).color) });
        })));
      }, time);
      const before = await sample(0.5 - 1 / 30);
      const after = await sample(0.5 + 1 / 30);
      assert.deepEqual(before.lines, ['あいうえおか', 'きくけこさし']);
      assert.deepEqual(after.lines, before.lines);
      assert.equal(before.colors.length, 4);
      assert.notEqual(after.colors[1], before.colors[1]);
      assert.equal(after.colors[2], before.colors[2]);
      const renderPage = await browser.newPage({ viewport: { width: 640, height: 360 } });
      const vars = Object.entries(renderPlan.overlays[0].vars).map(([name, value]) => `${name}:${value}`).join(';');
      await renderPage.setContent(`<div style="${vars}">${renderPlan.overlays[0].html}</div>`);
      const renderColors = async time => renderPage.evaluate(time => {
        for (const animation of document.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = time * 1000;
        }
        return [...document.querySelectorAll('.akari-caption__tok--karaoke')]
          .map(token => getComputedStyle(token).color);
      }, time);
      assert.deepEqual(before.colors, await renderColors(0.5 - 1 / 30));
      assert.deepEqual(after.colors, await renderColors(0.5 + 1 / 30));

      captionsRoot.display_policy.max_line_units = 6;
      captionsRoot.display_policy.lines = 1;
      captionsRoot.captions[0].text_style.karaoke.start_index = 3;
      await writeFile(join(project, 'captions.json'), JSON.stringify(captionsRoot));
      const splitPlan = resolveCaptionPlan({ captionsRoot, edit: renderEdit });
      assert.deepEqual(splitPlan.layout.display_cues.map(cue => cue.karaoke_offset), [0, 6]);
      assert.match(splitPlan.overlays[0].html, /akari-caption__tok--karaoke-done">あいう<\/span>/u);
      assert.doesNotMatch(splitPlan.overlays[1].html, /akari-caption__tok--karaoke-done">/u);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => 'editMode' in (window.akari ?? {}));
      await page.evaluate(() => {
        const seek = document.getElementById('seek');
        seek.value = '0.2';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelector('.akari-caption__tok--karaoke-done'));
      const tokenMarkupAt = async time => page.evaluate(time => {
        const seek = document.getElementById('seek');
        seek.value = String(time);
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
          resolve([...document.querySelectorAll('.akari-caption__tok--karaoke-done,.akari-caption__tok--unlit')]
            .map(token => [token.className, token.textContent])))));
      }, time);
      assert.deepEqual((await tokenMarkupAt(0.2)).map(([, text]) => text), ['あいう']);
      assert.deepEqual(await tokenMarkupAt(1.2), []);

      captionsRoot.display_policy.max_line_units = 20;
      captionsRoot.captions[0] = { id: 'c-1', src: 'main', start: 0, end: 2,
        text: '今日は、大事な話。', words: [
          { text: '今日は', start: 0, end: 0.6 },
          { text: '大事な', start: 0.6, end: 1.2 },
          { text: '話', start: 1.2, end: 2 },
        ], text_style: { karaoke: { fill: 'word', done_color: '#fb923c' } } };
      await writeFile(join(project, 'captions.json'), JSON.stringify(captionsRoot));
      const punctuationPlan = resolveCaptionPlan({ captionsRoot, edit: renderEdit });
      assert.equal((punctuationPlan.overlays[0].html.match(/akari-caption__tok--unlit/gu) ?? []).length, 2);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => 'editMode' in (window.akari ?? {}));
      await page.evaluate(() => {
        const seek = document.getElementById('seek');
        seek.value = '0.2';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => document.querySelectorAll('.akari-caption__tok--unlit').length === 2);
      assert.deepEqual((await tokenMarkupAt(0.2)).map(([, text]) => text), ['、', '。']);
    } finally {
      await browser?.close();
      if (child && child.exitCode === null) {
        child.kill();
        await new Promise(resolveDone => child.once('exit', resolveDone));
      }
      await rm(project, { recursive: true, force: true });
    }
  });
