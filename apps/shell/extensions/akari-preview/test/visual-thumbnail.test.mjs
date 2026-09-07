import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { prepareVisualThumbnailPage } = require('../lib/node/visual-thumbnail-page.js');
const { visualThumbnailPage } = require('../lib/common/visual-thumbnail.js');
const assets = Object.fromEntries(['threeJavaScriptUrl', 'threeTextJavaScriptUrl', 'threeRuntimeJavaScriptUrl',
  'runtimeJavaScriptUrl', 'captionFontUrl'].map(key => [key, `http://127.0.0.1:1234/${key}`]));

test('isolates an item, reads updated HTML/params and dependencies, samples midpoint, releases failed streams', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-visual-thumbnail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'overlays'));
  await writeFile(join(root, 'overlays/card.html'), '<div data-akari-text="title">before<img src="../logo.png"></div>');
  await writeFile(join(root, 'logo.png'), 'image');
  const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [], tracks: [
    { id: 'v1', lane: 'visual', items: [
      { id: 'card', at: 60, duration: 120, source: { kind: 'html', path: 'overlays/card.html', params: { title: 'First' } } },
      { id: 'unrelated-missing', at: 0, duration: 300, source: { kind: 'html', path: 'missing.html' } }
    ] }
  ] };
  const path = join(root, 'edit.json'); await writeFile(path, JSON.stringify(edit));
  let streams = 0;
  const createStream = async () => ({ id: String(++streams), url: `http://127.0.0.1:1234/asset/${streams}` });
  const page = await prepareVisualThumbnailPage(path, 'card', assets, createStream, async () => {});
  assert.equal(page.width, 480); assert.equal(page.height, 270);
  assert.match(page.html, /runtime.tick\(4,false\)/);
  assert.match(page.html, /First/); assert.match(page.html, /before/);
  assert.equal(page.streamIds.length, 1);
  assert.doesNotMatch(page.html, /unrelated-missing/);
  await writeFile(join(root, 'overlays/card.html'), '<div>after</div>');
  edit.tracks[0].items[0].source.params.title = 'Changed'; await writeFile(path, JSON.stringify(edit));
  const changed = await prepareVisualThumbnailPage(path, 'card', assets, createStream, async () => {});
  assert.match(changed.html, /Changed/); assert.match(changed.html, /after/);
  const released = [];
  await writeFile(join(root, 'overlays/card.html'), '<img src="../logo.png"><img src="missing.png">');
  await assert.rejects(prepareVisualThumbnailPage(path, 'card', assets, createStream, async id => released.push(id)));
  assert.equal(released.length, 1);
});

test('capture host preserves portrait aspect, waits for fonts/images/3D, and escapes HTML data', () => {
  const page = visualThumbnailPage([{ id: 'x', html: '</script><img src=x>', start: 0, duration: 2 }],
    { width: 1080, height: 1920, fps: 30 }, 1, assets);
  assert.equal(page.height, 320); assert.equal(page.width, 180);
  assert.match(page.html, /document.fonts.ready/);
  assert.match(page.html, /img.decode/);
  assert.match(page.html, /r.inspect/);
  assert.match(page.html, /premount:false/);
  assert.doesNotMatch(page.html, /<\/script><img src=x>/);
});

test('implicit HTML parts remain renderable with file-relative image dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-thumbnail-part-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'overlays'));
  await writeFile(join(root, 'overlays/bag.html'), '<div data-akari-part="title"><img src="logo.png">PART</div>');
  await writeFile(join(root, 'overlays/logo.png'), 'image');
  const path = join(root, 'edit.json');
  await writeFile(path, JSON.stringify({ version: 2, output: { width: 1280, height: 720, fps: 30 }, sources: [], tracks: [
    { id: 'visual', lane: 'visual', items: [{ id: 'bag', at: 60, duration: 120, source: { kind: 'html', path: 'overlays/bag.html' } }] }
  ] }));
  const page = await prepareVisualThumbnailPage(path, 'bag#title', assets,
    async uri => ({ id: 'logo', url: 'http://127.0.0.1:1234/logo' }), async () => {});
  assert.match(page.html, /PART/);
  assert.match(page.html, /runtime.tick\(4,false\)/);
  assert.ok(page.dependencyUris.some(uri => uri.endsWith('/overlays/logo.png')));
});

test('capture is registered in the existing bundled Electron main and preload entries', async () => {
  const main = await readFile(new URL('../src/electron-main/electron-api-main.ts', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/electron-browser/preload.ts', import.meta.url), 'utf8');
  assert.match(main, /ipcMain.handle\(CHANNEL_CAPTURE_VISUAL_THUMBNAIL/);
  assert.match(preload, /captureVisualThumbnail: page => ipcRenderer.invoke/);
  const pkg = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.build.extraResources.some(entry => entry.to === 'packages/overlay-runtime'));
});

test('captured edit is the requested snapshot even if disk changes before preparation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-thumbnail-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const doc = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [
    { id: 'v', lane: 'visual', items: [{ id: 'card', at: 0, duration: 120, source: { kind: 'html', path: 'card.html', params: { title: 'A' } } }] }
  ] };
  await writeFile(join(root, 'card.html'), '<div data-akari-slot="title">DEFAULT</div>');
  const snapshot = JSON.stringify(doc);
  doc.tracks[0].items[0].source.params.title = 'B';
  const path = join(root, 'edit.json'); await writeFile(path, JSON.stringify(doc));
  const page = await prepareVisualThumbnailPage(path, 'card', assets, async () => { throw Error('unexpected asset'); }, async () => {}, snapshot);
  assert.equal(page.editSnapshot, snapshot);
  assert.match(page.html, /"title":"A"/);
  assert.doesNotMatch(page.html, /"title":"B"/);
});

test('external CSS, imported CSS and parent/child motion dependencies retain project paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'akari-thumbnail-deps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'motion')); await mkdir(join(root, 'overlays'));
  await writeFile(join(root, 'overlays/card.html'), '<link rel="stylesheet" href="card.css"><div data-akari-part="title" class="card">CARD</div>');
  await writeFile(join(root, 'overlays/card.css'), '@import "base.css"; .card{background-image:url(logo.svg)}');
  await writeFile(join(root, 'overlays/base.css'), '.card{color:red}');
  await writeFile(join(root, 'overlays/logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(root, 'motion/edit.json'), JSON.stringify({ items: { bag: [{ t: 0, opacity: 1 }] } }));
  await writeFile(join(root, 'motion/credit.json'), JSON.stringify({ items: { child: [{ t: 0, opacity: 1 }] } }));
  const path = join(root, 'edit.json');
  await writeFile(path, JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [
    { id: 'v', lane: 'visual', items: [{ id: 'bag', at: 0, duration: 120, keyframes: { path: 'motion/edit.json', count: 2 },
      source: { kind: 'html', path: 'overlays/card.html' }, items: [{ id: 'child', at: 0, duration: 120,
        keyframes: { path: 'motion/credit.json', count: 2 }, source: { kind: 'html', path: 'overlays/card.html', part: 'title' } }] }] }
  ] }));
  const page = await prepareVisualThumbnailPage(path, 'child', assets,
    async () => ({ id: 'logo', url: 'http://localhost/snapshot/logo.svg' }), async () => {});
  for (const suffix of ['/motion/edit.json', '/motion/credit.json', '/overlays/card.css', '/overlays/base.css', '/overlays/logo.svg']) {
    assert.ok(page.dependencyUris.some(uri => uri.endsWith(suffix)), suffix);
  }
  assert.match(page.html, /background-image:url\(http:\/\/localhost\/snapshot\/logo.svg\)/);
  assert.match(page.html, /color:red/);
});
