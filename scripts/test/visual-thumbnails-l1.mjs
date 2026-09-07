import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const shell = join(root, 'apps/shell');
const app = join(root, 'node_modules/.visual-thumbnail-app');
const require = createRequire(join(shell, 'package.json'));
const { chromium } = require('playwright-core');
const base = join(shell, 'node_modules/.visual-thumbnail-l1');
const ws = join(base, `workspace-${Date.now()}`);
const evidence = join(root, 'apps/shell/extensions/akari-annotations/evidence/visual-thumbnails');
await mkdir(ws, { recursive: true }); await mkdir(evidence, { recursive: true });
// A failed run must never leave an earlier successful measurement under the current name.
for (const name of await readdir(evidence)) {
  if (name.endsWith('.png') || name === 'measurements.json') await unlink(join(evidence, name));
}
await new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x172432:s=320x180:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '14', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', join(ws, 'base.mp4')], { windowsHide: true, stdio: 'inherit' });
  p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(Error(`ffmpeg: ${code}`)));
});
await copyFile(join(root, 'assets/font/noto-sans-jp/NotoSansJP-Variable.ttf'), join(ws, 'font.ttf'));
const title = `<style>.title{position:absolute;inset:0;display:grid;place-content:center;color:#fff;font-size:90px;font-weight:900;text-shadow:0 3px 5px #004;background:linear-gradient(125deg,#104177,#148c95)}[data-akari-active] .title{animation:enter 1s both}@keyframes enter{from{opacity:0;transform:translateY(100px)}to{opacity:1;transform:none}}</style><div class="title" data-akari-text="title">AKARI TITLE</div>`;
const html = '<div style="position:absolute;inset:40px;border:6px solid #45d5de;border-radius:24px;display:flex;align-items:center;justify-content:space-evenly;color:#fff;font:72px sans-serif"><div style="background:#275cb5;padding:30px">INPUT</div><div>→</div><div style="background:#24765f;padding:30px">OUTPUT</div></div>';
const scene = { camera: { fov: 40, position: [0, 0, 4] }, texts: [{ id: 'title', text: '3D', font: 'font.ttf', size: 1.2, mode: 'extrude', depth: 0.3, color: '#ffbd36' }] };
const three = `<div style="position:absolute;inset:0"><canvas style="width:100%;height:100%"></canvas><script type="application/json" data-akari-3d-scene>${JSON.stringify(scene)}</script></div>`;
await writeFile(join(ws, 'title.html'), title); await writeFile(join(ws, 'diagram.html'), html); await writeFile(join(ws, 'three.html'), three);
const item = (id, name, at, duration, path) => ({ id, name, at, duration, source: { kind: 'html', path } });
const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [{ id: 'main', path: 'base.mp4' }], tracks: [
  { id: 'visual', lane: 'visual', items: [item('title', 'タイトル / AKARI TITLE', 0, 120, 'title.html'),
    item('diagram', 'HTML図解 / INPUT → OUTPUT', 120, 120, 'diagram.html'),
    item('three', 'Three.js / 立体文字', 240, 120, 'three.html'),
    item('short', '短い図解の内容', 363, 3, 'diagram.html'),
    item('overlap', '重なりの図解', 180, 100, 'diagram.html')] },
  { id: 'captions', lane: 'visual', items: [{ id: 'captions-bag', at: 0, duration: 390, source: { kind: 'captions', path: 'captions.json' } }] },
  { id: 'main', lane: 'visual', items: [{ id: 'base', at: 0, duration: 420, source: { kind: 'media', src: 'main', in: 0, out: 14 } }] }
] };
await writeFile(join(ws, 'edit.json'), JSON.stringify(edit, null, 2));
await writeFile(join(ws, 'captions.json'), JSON.stringify({ version: 1, captions: [{ id: 'c1', start: 0, end: 3, text: '字幕は細い行のまま', time_domain: 'output', edited: false, sourceRef: null, speaker: null }] }));
const freePort = async () => { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise(r => s.close(r)); return p; };
const port = await freePort(); const backendPort = await freePort();
const log = createWriteStream(join(evidence, 'electron.log'));
const env = { ...process.env, THEIA_CONFIG_DIR: join(base, `config-${Date.now()}`), AKARI_HOME: join(base, 'akari-home') };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(join(shell, 'node_modules/electron/dist/electron.exe'), [app, ws,
  `--remote-debugging-port=${port}`, `--port=${backendPort}`, `--user-data-dir=${join(base, `userdata-${Date.now()}`)}`, '--no-sandbox'], {
  cwd: shell, windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.pipe(log); child.stderr.pipe(log);
console.log(JSON.stringify({ pid: child.pid, port, ws }));
const delay = ms => new Promise(r => setTimeout(r, ms));
let browser;
try {
  for (let i = 0; i < 90; i++) { if (child.exitCode !== null) throw Error(`Electron exited: ${child.exitCode}`); try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await delay(1000); } }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let i = 0; i < 90; i++) {
    page = browser.contexts().flatMap(c => c.pages()).find(p => /index.html/.test(p.url()));
    if (page && await page.locator('#akari-menu-widget').count()) break;
    await delay(1000);
  }
  await page.waitForSelector('#akari-menu-widget', { timeout: 30000, state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('.theia-preload'), { timeout: 30000 });
  await page.evaluate(() => [...document.querySelectorAll('#akari-menu-widget button')].find(b => b.textContent.trim() === 'タイムライン')?.click());
  await page.waitForSelector('#akari-annotations-widget', { timeout: 30000 });
  const cdp = await page.context().newCDPSession(page);
  const captureHover = async name => {
    // Windows surface capture synthesizes pointerleave at the OS cursor position.
    // Capture the view directly to preserve the hover in the full Electron window.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
    const bytes = Buffer.from(data, 'base64'); await writeFile(join(evidence, name), bytes);
    return bytes;
  };
  await page.evaluate(() => {
    const container = window.theia.container;
    const key = [...container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && k.prototype?.getOrCreateWidget);
    window.__thumbnailWidget = container.get(key).getWidgets('akari-annotations-widget')[0];
    const w = window.__thumbnailWidget;
    const shellKey = [...container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && k.prototype?.expandBottomPanel);
    container.get(shellKey).resize(510, 'bottom');
    w.renderStrip();
  });
  const result = { startedAt: new Date().toISOString(), revision: 'r2', cold: {}, captures: [] };
  for (const id of ['title', 'diagram', 'three', 'short', 'overlap']) {
    const selector = `[data-akari-ui="timeline:overlay:${id}"]`;
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.waitForFunction(selector => document.querySelector(selector)?.dataset.akariVisualThumbnail === 'ready', selector, { timeout: 45000 });
    const data = await page.locator(selector).evaluate(async el => {
      const image = el.querySelector('img'); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) visible++;
      return { image: image.src, height: el.getBoundingClientRect().height, label: el.textContent, visible };
    });
    assert.ok(data.visible > 500, `${id} must show actual rendered pixels`);
    await writeFile(join(evidence, `${id}.png`), Buffer.from(data.image.split(',')[1], 'base64'));
    result.captures.push({ id, height: data.height, label: data.label, visiblePixels: data.visible });
  }
  result.cold = await page.evaluate(() => ({ ...window.__thumbnailWidget.visualThumbnails.stats }));
  await page.locator('#akari-annotations-widget').screenshot({ path: join(evidence, 'timeline.png') });
  const shortClip = page.locator('[data-akari-ui="timeline:overlay:short"]');
  await shortClip.hover();
  await page.waitForSelector('[data-akari-visual-thumbnail-hover]');
  assert.match(await page.locator('[data-akari-visual-thumbnail-hover]').innerText(), /短い図解の内容/);
  await captureHover('short-hover.png');
  assert.equal(await page.locator('[data-akari-visual-thumbnail-hover]').count(), 1);
  await page.mouse.move(20, 20);
  const resize = page.locator('[data-akari-timeline-track-id="visual"] [data-akari-resize="height"]');
  const captionHeight = await page.locator('.akari-annotations-strip-caption').evaluate(el => el.getBoundingClientRect().height);
  const resizeBounds = await resize.boundingBox();
  await page.mouse.move(resizeBounds.x + 20, resizeBounds.y + resizeBounds.height / 2);
  await page.mouse.down(); await page.mouse.move(resizeBounds.x + 20, resizeBounds.y + resizeBounds.height / 2 + 24); await page.mouse.up();
  result.resized = await page.evaluate(() => {
    const w = window.__thumbnailWidget;
    const a = document.querySelector('[data-akari-ui="timeline:overlay:diagram"]').getBoundingClientRect();
    const b = document.querySelector('[data-akari-ui="timeline:overlay:overlap"]').getBoundingClientRect();
    return { height: a.height, rowDistance: b.top - a.top,
      captionHeight: document.querySelector('.akari-annotations-strip-caption').getBoundingClientRect().height,
      stored: w.trackHeights.get('visual') };
  });
  assert.equal(result.resized.height, 72); assert.equal(result.resized.rowDistance, 74);
  assert.equal(result.resized.captionHeight, captionHeight);
  // Stable input: redraw, zoom and pan do not replace keyed clip DOM or capture again.
  result.reuse = await page.evaluate(() => {
    const w = window.__thumbnailWidget; const before = w.stripKeyedNodes.get('overlay:title');
    const count = w.visualThumbnails.stats.captures; const start = performance.now();
    for (let i = 0; i < 30; i++) { w.viewDuration = 15 + i % 2; w.viewStart = i % 2 * 0.1; w.stripScroll.scrollTop = i % 2 * 10; w.renderStrip(); }
    return { sameNode: before === w.stripKeyedNodes.get('overlay:title'), count, ms: performance.now() - start };
  });
  await delay(1200);
  assert.equal(await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures), result.reuse.count);
  assert.equal(result.reuse.sameNode, true);
  // Clip hit testing still selects and trims at the resized row geometry.
  // The overlap fixture intentionally violates v2's no-overlap edit gate; remove it for commit testing.
  const trimmable = structuredClone(edit);
  trimmable.tracks[0].items = trimmable.tracks[0].items.filter(item => item.id !== 'overlap');
  await writeFile(join(ws, 'edit.json'), JSON.stringify(trimmable, null, 2));
  await page.evaluate(async () => { await window.__thumbnailWidget.reloadEdit(); });
  await delay(1000);
  const titleClip = page.locator('[data-akari-ui="timeline:overlay:title"]');
  await titleClip.click();
  result.selection = await page.evaluate(() => window.__thumbnailWidget.selectionModel.snapshot);
  assert.match(JSON.stringify(result.selection), /title/);
  await delay(1500);
  const trimBounds = await titleClip.boundingBox();
  await page.mouse.move(trimBounds.x + trimBounds.width - 2, trimBounds.y + 20);
  await page.mouse.down(); await page.mouse.move(trimBounds.x + trimBounds.width - 25, trimBounds.y + 20, { steps: 5 });
  await page.mouse.up();
  for (let i = 0; i < 50; i++) {
    const changed = JSON.parse(await readFile(join(ws, 'edit.json'), 'utf8'));
    result.trimmedDuration = changed.tracks[0].items[0].duration;
    if (result.trimmedDuration !== 120) break;
    await delay(100);
  }
  assert.ok(result.trimmedDuration > 0 && result.trimmedDuration < 120);
  edit.tracks[0].items = trimmable.tracks[0].items;
  await writeFile(join(ws, 'edit.json'), JSON.stringify(edit, null, 2));
  await page.evaluate(async () => { await window.__thumbnailWidget.reloadEdit(); });
  await delay(1000);
  assert.equal(await titleClip.evaluate(el => el.getBoundingClientRect().height), 72, 'saved height survives edit reload');
  await page.waitForFunction(() => !window.__thumbnailWidget.visualThumbnails.active, { timeout: 45000 });
  // Change actual source while playing: watcher invalidates, capture remains deferred until stop.
  await page.evaluate(async () => {
    const w = window.__thumbnailWidget;
    await w.commands.executeCommand('akari.preview.seekOutput', { editUri: w.location.editUri.toString(), time: 1 });
  });
  // Seeking opens the preview and can redraw/enqueue the just-reloaded timeline.
  // Finish that work before measuring captures initiated by the subsequent source change.
  await page.waitForFunction(() => !window.__thumbnailWidget.visualThumbnails.active
    && [...document.querySelectorAll('[data-akari-visual-thumbnail]')].every(el => el.dataset.akariVisualThumbnail === 'ready'), { timeout: 45000 });
  await page.evaluate(async () => { const w = window.__thumbnailWidget;
    await w.commands.executeCommand('akari.preview.togglePlayback', { editUri: w.location.editUri.toString() }); });
  await page.waitForFunction(() => window.__thumbnailWidget.visualPlaying);
  await page.evaluate(() => {
    window.__playingSamples = [];
    window.__playingTimer = setInterval(() => {
      const w = window.__thumbnailWidget;
      window.__playingSamples.push({ playing: w.visualPlaying, paused: w.visualThumbnails.isPaused,
        captures: w.visualThumbnails.stats.captures, active: !!w.visualThumbnails.active, time: w.playheadT });
    }, 50);
  });
  const before = await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures);
  await writeFile(join(ws, 'title.html'), title.replace('AKARI TITLE', 'UPDATED TITLE'));
  await delay(1800);
  result.playbackSamples = await page.evaluate(() => { clearInterval(window.__playingTimer); return window.__playingSamples; });
  const playingSamples = result.playbackSamples.filter(sample => sample.playing);
  assert.ok(playingSamples.length > 0);
  // Source hot reload may stop the real preview. Captures may resume only after that stop.
  assert.ok(playingSamples.every(sample => sample.paused && !sample.active && sample.captures === before));
  result.playbackDeferred = true;
  await page.evaluate(async () => { const w = window.__thumbnailWidget;
    if (w.visualPlaying) await w.commands.executeCommand('akari.preview.togglePlayback', { editUri: w.location.editUri.toString() }); });
  await page.waitForFunction(() => !window.__thumbnailWidget.visualPlaying);
  await page.waitForFunction(count => window.__thumbnailWidget.visualThumbnails.stats.captures > count, before, { timeout: 45000 });
  result.resumed = true;
  await page.waitForFunction(() => !window.__thumbnailWidget.visualThumbnails.active, { timeout: 45000 });
  // Pointer-held changes use the same suspension gate as trims and item drags.
  const pointerBefore = await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures);
  await page.mouse.move(40, 40); await page.mouse.down();
  await writeFile(join(ws, 'diagram.html'), html.replace('INPUT', 'SOURCE'));
  await delay(1500);
  assert.equal(await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures), pointerBefore);
  await page.mouse.up();
  await page.waitForFunction(count => window.__thumbnailWidget.visualThumbnails.stats.captures > count, pointerBefore, { timeout: 45000 });
  result.pointerDeferred = true;
  // Explicit group expansion, focus/KF rows and header geometry must use the same resized stride.
  edit.tracks.push({ id: 'group-track', lane: 'visual', items: [{ id: 'group', name: '展開グループ', at: 0, duration: 180,
    source: { kind: 'group' }, items: [item('group-title', 'グループ内タイトル', 0, 180, 'title.html')] }] });
  await writeFile(join(ws, 'edit.json'), JSON.stringify(edit, null, 2));
  await page.evaluate(async () => { await window.__thumbnailWidget.reloadEdit(); });
  await page.locator('[data-akari-tree-toggle="group"]').click();
  await page.waitForSelector('[data-akari-tree-row-id="group-title"]');
  result.tree = await page.evaluate(() => {
    const header = document.querySelector('[data-akari-tree-row-id="group-title"]');
    const clip = document.querySelector('.akari-timeline-tree-item[data-akari-item-id="group-title"]');
    const a = header.getBoundingClientRect(), b = clip.getBoundingClientRect();
    return { topDelta: a.top - b.top, heightDelta: a.height - b.height };
  });
  assert.ok(Math.abs(result.tree.topDelta) <= 1); assert.equal(result.tree.heightDelta, 0);
  await page.locator('[data-akari-tree-row-id="group-title"]').dblclick();
  await page.waitForSelector('[data-akari-keyframe-property-header]');
  result.keyframes = await page.evaluate(() => [...document.querySelectorAll('[data-akari-keyframe-property-header]')].map(header => {
    const key = header.dataset.akariKeyframePropertyHeader;
    const row = [...document.querySelectorAll('[data-akari-keyframe-property-row]')].find(el => el.dataset.akariKeyframePropertyRow === key);
    const a = header.getBoundingClientRect(), b = row.getBoundingClientRect();
    return { key, topDelta: a.top - b.top, heightDelta: a.height - b.height };
  }));
  assert.ok(result.keyframes.length >= 5);
  assert.ok(result.keyframes.every(row => Math.abs(row.topDelta) <= 1 && row.heightDelta === 0));
  await page.waitForSelector('.akari-timeline-tree-item[data-akari-item-id="group-title"][data-akari-visual-thumbnail="ready"]', { timeout: 45000 });
  await page.locator('#akari-annotations-widget').screenshot({ path: join(evidence, 'keyframes.png') });
  await page.waitForFunction(() => !window.__thumbnailWidget.visualThumbnails.active, { timeout: 45000 });
  // Open the real output preview, then check capture isolation and real playback ticks.
  await page.evaluate(async () => {
    const w = window.__thumbnailWidget;
    w.visualThumbnails.setPaused(true);
    await w.commands.executeCommand('akari.preview.seekOutput', { editUri: w.location.editUri.toString(), time: 1.25 });
  });
  await page.waitForFunction(() => Math.abs(window.__thumbnailWidget.playheadT - 1.25) < 0.05, { timeout: 45000 });
  result.previewIsolation = await page.evaluate(async () => {
    const w = window.__thumbnailWidget;
    const before = { time: w.playheadT, selection: JSON.stringify(w.selectionModel.snapshot) };
    const shot = await w.visualPreviewService.prepareVisualThumbnail({ editUri: w.location.editUri.toString(), itemId: 'title', editSnapshot: JSON.stringify(w.editDocument) });
    try { await window.electronAkariPreview.captureVisualThumbnail(shot); }
    finally { await Promise.all(shot.streamIds.map(id => w.visualPreviewService.disposeAssetStream(id))); }
    return { before, after: { time: w.playheadT, selection: JSON.stringify(w.selectionModel.snapshot) } };
  });
  assert.deepEqual(result.previewIsolation.before, result.previewIsolation.after);
  await page.evaluate(async () => { const w = window.__thumbnailWidget; await w.commands.executeCommand('akari.preview.togglePlayback', { editUri: w.location.editUri.toString() }); });
  await page.waitForFunction(() => window.__thumbnailWidget.visualPlaying && window.__thumbnailWidget.playheadT > 1.5, { timeout: 30000 });
  const playingCount = await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures);
  await delay(1200);
  assert.equal(await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.stats.captures), playingCount);
  await page.evaluate(async () => { const w = window.__thumbnailWidget; await w.commands.executeCommand('akari.preview.togglePlayback', { editUri: w.location.editUri.toString() }); });
  await page.waitForFunction(() => !window.__thumbnailWidget.visualPlaying);
  result.realPlayback = true;
  await page.evaluate(() => window.__thumbnailWidget.visualThumbnails.setPaused(true));
  await page.waitForFunction(() => !window.__thumbnailWidget.visualThumbnails.active, { timeout: 45000 });
  const capturePage = shot => page.evaluate(shot => window.electronAkariPreview.captureVisualThumbnail(shot), shot);
  const prepare = (snapshot, itemId) => page.evaluate(async ({ snapshot, itemId }) => {
    const w = window.__thumbnailWidget;
    return w.visualPreviewService.prepareVisualThumbnail({ editUri: w.location.editUri.toString(), editSnapshot: JSON.stringify(snapshot), itemId });
  }, { snapshot, itemId });
  const release = shot => page.evaluate(async ids => { await Promise.all(ids.map(id => window.__thumbnailWidget.visualPreviewService.disposeAssetStream(id))); }, shot.streamIds);
  const pixels = data => page.evaluate(async data => {
    const img = new Image(); img.src = data; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const bytes = ctx.getImageData(0, 0, img.width, img.height).data;
    let visible = 0, pink = 0, blue = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i + 3] > 8) visible++;
      if (bytes[i] > 180 && bytes[i + 1] < 70 && bytes[i + 2] < 110 && bytes[i + 3] > 200) pink++;
      if (bytes[i] < 35 && bytes[i + 1] > 40 && bytes[i + 2] > 80 && bytes[i + 3] > 200) blue++;
    }
    return { visible, pink, blue };
  }, data);
  const staggered = { ...edit, tracks: [{ id: 'staggered', lane: 'visual', items: [{ id: 'staggered-group', at: 0, duration: 180,
    source: { kind: 'group' }, items: [item('early-three', 'EARLY', 0, 30, 'three.html'), item('late-three', 'LATE', 60, 120, 'three.html')] }] }] };
  const staggeredPage = await prepare(staggered, 'staggered-group');
  try {
    const data = await capturePage(staggeredPage);
    result.staggeredThree = await pixels(data); assert.ok(result.staggeredThree.visible > 500);
    await writeFile(join(evidence, 'r1-staggered-three.png'), Buffer.from(data.split(',')[1], 'base64'));
  } finally { await release(staggeredPage); }
  await writeFile(join(ws, 'slow.html'), '<link rel="stylesheet" href="slow.css"><div class="slow-bg">DELAYED BACKGROUND</div>');
  await writeFile(join(ws, 'slow.css'), '.slow-bg{position:absolute;inset:0;background-image:url(slow.svg);color:white;font:60px sans-serif}');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><path fill="#e11d48" d="M0 0H1280V720H0Z"/></svg>';
  await writeFile(join(ws, 'slow.svg'), svg);
  const slow = { ...edit, tracks: [{ id: 'slow', lane: 'visual', items: [item('slow', 'SLOW CSS', 0, 120, 'slow.html')] }] };
  const slowPage = await prepare(slow, 'slow');
  let received = 0, responded = 0;
  const server = createHttpServer((request, response) => {
    received = Date.now();
    setTimeout(() => { responded = Date.now(); response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public,max-age=3600' }); response.end(svg); }, 1800);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const originalUrl = slowPage.html.match(/http:\/\/127\.0\.0\.1:\d+\/asset\/[a-z0-9]+\.svg/)?.[0];
    assert.ok(originalUrl, 'external CSS background must be resolved through the asset service');
    slowPage.html = slowPage.html.replaceAll(originalUrl, `http://127.0.0.1:${server.address().port}/slow.svg`);
    const started = Date.now(); const data = await capturePage(slowPage); const finished = Date.now();
    result.delayedCss = { elapsedMs: finished - started, responseDelayMs: responded - received, ...(await pixels(data)) };
    assert.ok(responded > 0 && finished >= responded);
    assert.ok(result.delayedCss.pink > 40000, 'successful image must contain the delayed background pixels');
    await writeFile(join(evidence, 'r1-delayed-css.png'), Buffer.from(data.split(',')[1], 'base64'));
  } finally { await release(slowPage); await new Promise(resolve => server.close(resolve)); }
  // A real long title starts at 90% of a 500px viewport and ends beyond its right edge.
  // Assert rendered pixels in the visible slice, rather than merely inspecting CSS.
  const wide = { ...edit, tracks: [{ id: 'wide', lane: 'visual', items: [item('wide-title', 'LONG TITLE / partial viewport', 270, 900, 'title.html')] }] };
  await writeFile(join(ws, 'edit.json'), JSON.stringify(wide, null, 2));
  await page.evaluate(async () => {
    const w = window.__thumbnailWidget;
    await w.reloadEdit();
    const container = window.theia.container;
    const shellKey = [...container._bindingDictionary._map.keys()].find(k => typeof k === 'function' && k.prototype?.expandBottomPanel);
    await container.get(shellKey).collapsePanel('left');
    await container.get(shellKey).collapsePanel('right');
    w.focusScope.rootId = null;
    w.stripScroll.style.width = '500px'; w.stripScroll.style.flex = '0 0 500px';
    w.viewDuration = 10; w.viewStart = 0;
    w.visualThumbnails.setPaused(false); w.refreshTimelineTreeRows();
  });
  await delay(1000);
  const wideSelector = '[data-akari-ui="timeline:overlay:wide-title"]';
  await page.waitForFunction(selector => document.querySelector(selector)?.dataset.akariVisualThumbnail === 'ready'
    && !window.__thumbnailWidget.visualThumbnails.active, wideSelector, { timeout: 45000 });
  await page.evaluate(selector => { window.__wideNode = document.querySelector(selector); }, wideSelector);
  const wideSlice = async name => {
    const geometry = await page.locator(wideSelector).evaluate(el => {
      const rect = el.getBoundingClientRect(), viewport = window.__thumbnailWidget.stripScroll.getBoundingClientRect();
      const widget = window.__thumbnailWidget.node.getBoundingClientRect();
      if (viewport.right > widget.right + 1) throw Error('The fixture viewport is clipped by the dock panel');
      const left = Math.max(rect.left, viewport.left), right = Math.min(rect.right, viewport.right);
      return { relativeLeft: rect.left - viewport.left, width: rect.width, viewportWidth: viewport.width, visibleWidth: right - left,
        clip: { x: left + 2, y: rect.top + 3, width: right - left - 4, height: rect.height - 24 },
        sameNode: window.__wideNode === el, imageVisibility: getComputedStyle(el.querySelector('img')).visibility,
        captures: window.__thumbnailWidget.visualThumbnails.stats.captures };
    });
    const shot = await page.screenshot({ path: join(evidence, `r2-wide-visible-${name}.png`), clip: geometry.clip });
    await page.locator('#akari-annotations-widget').screenshot({ path: join(evidence, `r2-wide-${name}.png`) });
    return { ...geometry, ...(await pixels(`data:image/png;base64,${shot.toString('base64')}`)) };
  };
  const wideBefore = await wideSlice('before');
  assert.equal(wideBefore.viewportWidth, 500);
  assert.ok(Math.abs(wideBefore.relativeLeft - 450) <= 1);
  assert.ok(wideBefore.blue > 500, 'the partially visible title must already show its blue image');
  await page.mouse.move(wideBefore.clip.x - 200, wideBefore.clip.y + 10);
  await page.mouse.wheel(50, 0);
  await delay(1500);
  const wideAfter = await wideSlice('after');
  assert.ok(Math.abs(wideBefore.relativeLeft - wideAfter.relativeLeft - 50) <= 1);
  assert.ok(wideAfter.blue > 500, 'the title image must remain visible after horizontal pan');
  assert.equal(wideAfter.captures, wideBefore.captures);
  assert.equal(wideAfter.sameNode, true);
  assert.equal(wideAfter.imageVisibility, 'hidden', 'long clip uses the repeated bitmap while retaining its img node');
  await page.mouse.move(wideAfter.clip.x + 15, wideAfter.clip.y + 10);
  await page.waitForSelector('[data-akari-visual-thumbnail-hover]');
  const wideHover = await page.locator('[data-akari-visual-thumbnail-hover]').evaluate(el => ({
    label: el.textContent, visibility: getComputedStyle(el.querySelector('img')).visibility,
    decoded: el.querySelector('img').naturalWidth > 0
  }));
  assert.equal(wideHover.visibility, 'visible'); assert.equal(wideHover.decoded, true);
  assert.match(wideHover.label, /LONG TITLE \/ partial viewport/);
  const hoverShot = await captureHover('r2-wide-hover.png');
  wideHover.pixels = await pixels(`data:image/png;base64,${hoverShot.toString('base64')}`);
  assert.ok(wideHover.pixels.blue > 40000, 'the hover enlargement must be visibly painted on screen');
  result.wideClip = { before: wideBefore, after: wideAfter, hover: wideHover };
  result.final = await page.evaluate(() => ({ stats: window.__thumbnailWidget.visualThumbnails.stats,
    queue: window.__thumbnailWidget.visualThumbnails.queued, bytes: window.__thumbnailWidget.visualThumbnails.memoryBytes,
    tracks: window.__thumbnailWidget.laneLayout.tracks }));
  await writeFile(join(evidence, 'measurements.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  const page = browser?.contexts().flatMap(c => c.pages()).find(p => /index.html/.test(p.url()));
  if (page) {
    await page.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
    console.error(await page.evaluate(() => ({ body: document.body.innerText.slice(-2500),
      thumbnails: [...document.querySelectorAll('[data-akari-visual-thumbnail]')].map(el => ({ id: el.dataset.akariItemId, state: el.dataset.akariVisualThumbnail })),
      stats: window.__thumbnailWidget?.visualThumbnails.stats })).catch(() => ({})));
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  // Only terminate the process tree launched by this script.
  if (child.exitCode === null) {
    if (process.platform === 'win32') await new Promise(r => { const p = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); p.on('exit', r); });
    else child.kill();
  }
  log.end();
}
