import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shell = join(root, 'apps/shell');
const require = createRequire(join(shell, 'package.json'));
const { chromium } = require('playwright-core');
const base = join(shell, 'node_modules/.visual-thumbnail-l1', `remount-${Date.now()}`);
const ws = join(base, 'workspace');
const evidence = join(root, 'apps/shell/extensions/akari-annotations/evidence/visual-thumbnails');
await mkdir(ws, { recursive: true }); await mkdir(evidence, { recursive: true });
await writeFile(join(ws, 'title.html'), '<div style="position:absolute;inset:0;background:#104177;color:white;display:grid;place-content:center;font:64px sans-serif">REMOUNT TITLE</div>');
await writeFile(join(ws, 'edit.json'), JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'wide', lane: 'visual', items: [{ id: 'wide-title', name: 'REMOUNT TITLE / cached image', at: 270, duration: 900,
    source: { kind: 'html', path: 'title.html' } }] }] }));
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const port = s.address().port; await new Promise(r => s.close(r)); return port; };
const port = await freePort(), backendPort = await freePort();
const env = { ...process.env, THEIA_CONFIG_DIR: join(base, 'config'), AKARI_HOME: join(base, 'akari-home') };
delete env.ELECTRON_RUN_AS_NODE;
const log = createWriteStream(join(evidence, 'r3-remount-electron.log'));
const child = spawn(join(shell, 'node_modules/electron/dist/electron.exe'), [shell, ws, `--remote-debugging-port=${port}`,
  `--port=${backendPort}`, `--user-data-dir=${join(base, 'userdata')}`, '--no-sandbox'],
{ cwd: shell, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log); child.stderr.pipe(log);
console.log(JSON.stringify({ pid: child.pid, port, ws }));
const delay = ms => new Promise(r => setTimeout(r, ms));
let browser, page;
try {
  for (let i = 0; i < 60; i++) { if (child.exitCode !== null) throw Error(`Electron exited: ${child.exitCode}`);
    try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await delay(1000); } }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  for (let i = 0; i < 60; i++) { page = browser.contexts().flatMap(c => c.pages()).find(p => /index.html/.test(p.url()));
    if (page && await page.locator('#akari-menu-widget').count()) break; await delay(1000); }
  await page.waitForFunction(() => !document.querySelector('.theia-preload'));
  await page.evaluate(() => [...document.querySelectorAll('#akari-menu-widget button')].find(b => b.textContent.trim() === 'タイムライン').click());
  await page.waitForSelector('#akari-annotations-widget');
  await page.evaluate(async () => {
    const container = window.theia.container;
    const widgetKey = [...container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && k.prototype?.getOrCreateWidget);
    const shellKey = [...container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && k.prototype?.expandBottomPanel);
    const appShell = container.get(shellKey); appShell.resize(510, 'bottom');
    await appShell.collapsePanel('left'); await appShell.collapsePanel('right');
    const w = window.__thumbnailWidget = container.get(widgetKey).getWidgets('akari-annotations-widget')[0];
    w.stripScroll.style.width = '500px'; w.stripScroll.style.flex = '0 0 500px';
    w.viewStart = 0; w.viewDuration = 10; w.renderStrip();
  });
  const selector = '[data-akari-ui="timeline:overlay:wide-title"]';
  await page.waitForFunction(selector => document.querySelector(selector)?.dataset.akariVisualThumbnail === 'ready'
    && !window.__thumbnailWidget.visualThumbnails.active, selector, { timeout: 45000 });
  await delay(500);
  const result = { revision: 'r3', startedAt: new Date().toISOString() };
  result.remount = await page.evaluate(async () => {
    const w = window.__thumbnailWidget, original = w.stripKeyedNodes.get('overlay:wide-title');
    const count = w.visualThumbnails.stats.captures;
    w.viewDuration = 1; w.renderStrip();
    if (original.isConnected || w.stripKeyedNodes.has('overlay:wide-title')) throw Error('fixture did not unmount the clip');
    let detached;
    const render = w.renderVisualThumbnail;
    w.renderVisualThumbnail = function (element, id, ...args) {
      render.call(this, element, id, ...args);
      if (id === 'wide-title') detached = { connected: element.isConnected, width: element.getBoundingClientRect().width,
        state: element.dataset.akariVisualThumbnail };
    };
    try { w.viewDuration = 10; w.renderStrip(); } finally { w.renderVisualThumbnail = render; }
    await new Promise(resolve => requestAnimationFrame(resolve));
    const node = w.stripKeyedNodes.get('overlay:wide-title');
    window.__remountedNode = node;
    return { detached, newNode: original !== node, connected: node.isConnected, width: node.getBoundingClientRect().width,
      imageVisibility: getComputedStyle(node.querySelector('img')).visibility, before: count, after: w.visualThumbnails.stats.captures };
  });
  assert.deepEqual(result.remount.detached, { connected: false, width: 0, state: 'ready' });
  assert.ok(result.remount.newNode && result.remount.connected && result.remount.width > 340);
  assert.equal(result.remount.imageVisibility, 'hidden'); assert.equal(result.remount.before, result.remount.after);
  const cdp = await page.context().newCDPSession(page);
  const bluePixels = data => page.evaluate(async data => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let blue = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 35 && pixels[i + 1] > 40 && pixels[i + 2] > 80) blue++;
    return blue;
  }, data);
  const captureSlice = async name => {
    const geometry = await page.locator(selector).evaluate(el => {
      const w = window.__thumbnailWidget, box = el.getBoundingClientRect(), view = w.stripScroll.getBoundingClientRect();
      if (view.right > w.node.getBoundingClientRect().right + 1) throw Error('fixture viewport is clipped');
      const left = Math.max(box.left, view.left), right = Math.min(box.right, view.right);
      return { relativeLeft: box.left - view.left, visibleWidth: right - left, viewportWidth: view.width,
        clip: { x: left + 2, y: box.top + 3, width: right - left - 4, height: box.height - 24 }, captures: w.visualThumbnails.stats.captures };
    });
    const data = (await page.screenshot({ path: join(evidence, `r3-${name}-slice.png`), clip: geometry.clip })).toString('base64');
    await page.locator('#akari-annotations-widget').screenshot({ path: join(evidence, `r3-${name}.png`) });
    return { ...geometry, bluePixels: await bluePixels(data) };
  };
  result.beforePan = await captureSlice('remount');
  assert.equal(result.beforePan.viewportWidth, 500); assert.ok(result.beforePan.bluePixels > 500);
  await page.mouse.move(result.beforePan.clip.x - 200, result.beforePan.clip.y + 10); await page.mouse.wheel(50, 0); await delay(500);
  result.afterPan = await captureSlice('pan');
  assert.ok(Math.abs(result.beforePan.relativeLeft - result.afterPan.relativeLeft - 50) < 1);
  assert.ok(result.afterPan.bluePixels > 500); assert.equal(result.afterPan.captures, result.beforePan.captures);
  const hover = async (name, x, y) => {
    await page.mouse.move(20, 20); await page.mouse.move(x, y);
    await page.waitForSelector('[data-akari-visual-thumbnail-hover]');
    // Surface capture on Windows synthesizes pointerleave with the OS cursor position.
    // View capture preserves the real hover and records the full Electron window.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    await writeFile(join(evidence, `r3-${name}-hover.png`), Buffer.from(data, 'base64'));
    const info = await page.locator('[data-akari-visual-thumbnail-hover]').evaluate(el => ({
      label: el.textContent, visibility: getComputedStyle(el.querySelector('img')).visibility, decoded: el.querySelector('img').naturalWidth > 0 }));
    const blue = await bluePixels(data); assert.ok(blue > 40000, 'hover pixels must be visible in the Electron screenshot');
    assert.equal(info.visibility, 'visible'); assert.equal(info.decoded, true); assert.match(info.label, /REMOUNT TITLE/);
    await page.mouse.move(20, 20); await page.waitForSelector('[data-akari-visual-thumbnail-hover]', { state: 'detached' });
    return { ...info, bluePixels: blue };
  };
  result.longHover = await hover('long', result.afterPan.clip.x + 15, result.afterPan.clip.y + 10);
  result.short = await page.evaluate(() => {
    const w = window.__thumbnailWidget; w.viewStart = 0; w.viewDuration = undefined;
    w.stripScroll.style.width = '100px'; w.stripScroll.style.flex = '0 0 100px'; w.renderStrip();
    const node = w.stripKeyedNodes.get('overlay:wide-title'), bounds = node.getBoundingClientRect();
    return { sameNode: node === window.__remountedNode, visibility: getComputedStyle(node.querySelector('img')).visibility,
      width: bounds.width, x: bounds.left + bounds.width / 2, y: bounds.top + 15 };
  });
  assert.equal(result.short.sameNode, true); assert.equal(result.short.visibility, 'visible');
  result.shortHover = await hover('short', result.short.x, result.short.y);
  result.longAgain = await page.evaluate(() => {
    const w = window.__thumbnailWidget; w.viewDuration = 10;
    w.stripScroll.style.width = '500px'; w.stripScroll.style.flex = '0 0 500px'; w.renderStrip();
    const node = w.stripKeyedNodes.get('overlay:wide-title');
    return { sameNode: node === window.__remountedNode, visibility: getComputedStyle(node.querySelector('img')).visibility,
      captures: w.visualThumbnails.stats.captures };
  });
  assert.equal(result.longAgain.sameNode, true); assert.equal(result.longAgain.visibility, 'hidden');
  assert.equal(result.longAgain.captures, result.remount.before);
  await writeFile(join(evidence, 'r3-remount-measurements.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'r3-failure.png') }).catch(() => {});
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) await new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('exit', resolve);
  });
  log.end();
}
