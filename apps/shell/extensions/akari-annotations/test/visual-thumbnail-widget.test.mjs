import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import URI from '@theia/core/lib/common/uri.js';
import { VisualThumbnailCache } from '../lib/browser/visual-thumbnail-cache.js';
import { visualThumbnailKey, visualThumbnailSnapshot } from '../lib/browser/visual-thumbnail-key.js';

const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const klass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
const method = klass.members.find(node => node.name?.getText(source) === 'renderVisualThumbnail').getText(source);
const code = ts.transpileModule(`class Widget { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
class Element {
  isConnected = true; dataset = {}; style = {}; classList = { add() {} }; children = [];
  bounds = { left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100 };
  getBoundingClientRect() { return this.isConnected ? this.bounds : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  querySelector(selector) { return selector.includes('image') ? this.children.find(el => el.className === 'akari-visual-thumbnail-image') : undefined; }
  prepend(el) { this.children.unshift(el); el.parent = this; }
  remove() { this.parent.children = this.parent.children.filter(el => el !== this); }
  addEventListener() {}
  getAttribute(name) { return this[name]; }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { const end = Date.now() + 4000; while (!predicate()) { assert.ok(Date.now() < end, 'deadline'); await wait(20); } };
function fixture(t, prepare) {
  const captures = [], frames = [];
  const Widget = new Function('window', 'document', 'URI', 'visualThumbnailKey', 'visualThumbnailSnapshot', `${code};return Widget;`)(
    { requestAnimationFrame: callback => frames.push(callback),
      electronAkariPreview: { captureVisualThumbnail: async page => { captures.push(page.marker); return page.marker; } } },
    { createElement: () => new Element() }, URI.default ?? URI, visualThumbnailKey, visualThumbnailSnapshot);
  const w = new Widget();
  const root = { value: 'A', toString() { return `file:///${this.value}/edit.json`; } };
  Object.assign(w, { location: { editUri: root }, visualInputEpoch: 0, visualDependencyRevisions: new Map(), visualDependencies: new Map(),
    failedVisualThumbnails: new Set(), visualKeys: new WeakMap(), isDisposed: false, stripScroll: new Element(),
    editDocument: { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [{ id: 'v', lane: 'visual', items: [
      { id: 'parent', at: 0, duration: 120, opacity: 1, source: { kind: 'group' }, items: [
        { id: 'title', at: 0, duration: 120, source: { kind: 'html', path: 'title.html', params: { text: 'A' } } },
        { id: 'sibling', source: { kind: 'html', path: 'unrelated.html' } }
      ] }
    ] }] },
    visualPreviewService: { prepareVisualThumbnail: prepare ?? (async request => ({ editSnapshot: request.editSnapshot,
      marker: JSON.parse(request.editSnapshot).tracks[0].items[0].items[0].source.params.text, streamIds: [], dependencyUris: [] })),
      disposeAssetStream: async () => {} }
  });
  const element = new Element();
  const render = () => w.renderVisualThumbnail(element, 'title', 'TITLE', {});
  w.visualThumbnails = new VisualThumbnailCache(render);
  t.after(() => w.visualThumbnails.dispose());
  return { w, root, element, render, captures, frames };
}

for (const change of ['project', 'dependency', 'parent']) test(`in-flight ${change} changes discard the old completion and preserve undo`, async t => {
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(release);
  let first = true;
  const f = fixture(t, async request => {
    if (first) { first = false; entered = true; await gate; }
    const doc = JSON.parse(request.editSnapshot);
    return { editSnapshot: request.editSnapshot, marker: `${request.editUri}:${doc.tracks[0].items[0].opacity}`,
      streamIds: [], dependencyUris: ['file:///A/motion/edit.json'] };
  });
  f.render(); await until(() => entered);
  if (change === 'project') f.root.value = 'B';
  if (change === 'dependency') { f.w.visualInputEpoch++; f.w.visualDependencyRevisions.set('title', 1); }
  if (change === 'parent') f.w.editDocument.tracks[0].items[0].opacity = 0.25;
  f.render(); release();
  await until(() => f.w.visualThumbnails.stats.discarded === 1 && f.captures.length === 1);
  assert.equal(f.w.visualThumbnails.size, 1);
  assert.match(f.captures[0], change === 'project' ? /\/B\// : change === 'parent' ? /:0.25$/ : /:1$/);
  f.root.value = 'A'; f.w.editDocument.tracks[0].items[0].opacity = 1;
  f.render();
  await until(() => f.element.querySelector('image')?.src === 'file:///A/edit.json:1');
});

test('a mismatched backend snapshot is never stored as a successful capture', async t => {
  const f = fixture(t, async () => ({ editSnapshot: 'newer disk content', marker: 'WRONG', streamIds: [], dependencyUris: [] }));
  f.render(); await until(() => f.w.visualThumbnails.stats.failures === 1);
  assert.deepEqual(f.captures, []);
  assert.equal(f.element.querySelector('image'), undefined);
});

test('unrelated sibling changes reuse pixels but parent transform changes generate a new image', async t => {
  const f = fixture(t); f.render(); await until(() => f.captures.length === 1);
  f.w.editDocument.tracks[0].items[0].items[1].name = 'changed sibling';
  f.render(); await wait(200); assert.equal(f.captures.length, 1);
  f.w.editDocument.tracks[0].items[0].transform = { x: 80 };
  f.render(); await until(() => f.captures.length === 2);
});

test('partially visible long clips repeat cached pixels through pan, while short clips retain contain', async t => {
  const f = fixture(t);
  f.w.stripScroll.bounds = { left: 0, right: 500, top: 0, bottom: 60, width: 500, height: 60 };
  f.element.bounds = { left: 450, right: 800, top: 0, bottom: 60, width: 350, height: 60 };
  f.render(); await until(() => f.captures.length === 1);
  const image = f.element.querySelector('image');
  assert.equal(image.style.visibility, 'hidden');
  assert.equal(f.element.style.backgroundRepeat, 'repeat-x, repeat');
  assert.equal(f.element.style.backgroundSize, 'auto 100%, 12px 12px');
  assert.match(f.element.style.backgroundImage, /^url\("A"\), repeating-conic-gradient/);
  f.element.bounds.left -= 50; f.element.bounds.right -= 50;
  f.render(); await wait(200);
  assert.equal(f.element.querySelector('image'), image);
  assert.equal(f.captures.length, 1);
  f.element.bounds.width = 12; f.element.bounds.right = f.element.bounds.left + 12;
  f.render(); await wait(150);
  assert.equal(image.style.visibility, 'visible');
  assert.equal(image.style.objectFit, 'contain');
  assert.equal(image.style.pointerEvents, 'none');
  assert.equal(f.captures.length, 1);
});

test('cached remount measures attached geometry once and existing nodes switch both directions without recapture', async t => {
  const f = fixture(t); f.render(); await until(() => f.captures.length === 1);
  const remount = new Element(); remount.isConnected = false;
  remount.bounds = { left: 450, right: 800, top: 0, bottom: 60, width: 350, height: 60 };
  f.w.renderVisualThumbnail(remount, 'title', 'TITLE', {});
  assert.equal(remount.getBoundingClientRect().width, 0);
  assert.equal(f.frames.length, 1);
  remount.isConnected = true; f.frames.shift()();
  const image = remount.querySelector('image');
  assert.equal(image.style.visibility, 'hidden');
  assert.match(remount.style.backgroundImage, /^url\("A"\)/);
  remount.bounds.width = 12; f.w.renderVisualThumbnail(remount, 'title', 'TITLE', {});
  assert.equal(image.style.visibility, 'visible');
  remount.bounds.width = 350; f.w.renderVisualThumbnail(remount, 'title', 'TITLE', {});
  assert.equal(image.style.visibility, 'hidden');
  assert.equal(f.frames.length, 0, 'connected renders must not start an animation loop');
  assert.equal(f.captures.length, 1);
});

for (const obsolete of ['key', 'disposed', 'detached']) test(`deferred remount sizing ignores ${obsolete} nodes`, async t => {
  const f = fixture(t); f.render(); await until(() => f.captures.length === 1);
  const remount = new Element(); remount.isConnected = false;
  f.w.renderVisualThumbnail(remount, 'title', 'TITLE', {});
  const image = remount.querySelector('image'); image.style.visibility = 'sentinel';
  remount.isConnected = obsolete !== 'detached';
  if (obsolete === 'key') f.w.visualKeys.set(remount, 'replacement-key');
  if (obsolete === 'disposed') f.w.isDisposed = true;
  f.frames.shift()();
  assert.equal(image.style.visibility, 'sentinel');
  assert.equal(f.frames.length, 0);
});

test('the real file watcher invalidates motion/edit.json and motion/credit.json without broad cache invalidation', () => {
  let watcher;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'this.fileService.onDidFilesChange') watcher = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(klass); assert.ok(watcher);
  const js = ts.transpileModule(`function install(){return ${watcher.getText(source)};}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const install = new Function(`${js};return install;`)();
  const U = URI.default ?? URI;
  const uri = path => new U(`file:///project/${path}`);
  let renders = 0, editReloads = 0;
  const w = { location: { root: new U('file:///project'), editUri: uri('edit.json'), reviewUri: uri('review.json'), captionsUri: uri('captions.json') },
    visualInputEpoch: 0, visualDependencies: new Map([['child', [uri('motion/edit.json'), uri('motion/credit.json')]], ['other', [uri('other.html')]]]),
    visualDependencyRevisions: new Map(), failedVisualThumbnails: new Set(), renderStrip: () => renders++,
    reloadEdit: async () => editReloads++, reloadReview: async () => {}, reloadCaptions: async () => {}, isRecentWrite: () => false };
  const change = path => install.call(w)({ changes: [{ resource: uri(path) }], contains: target => target?.toString() === uri(path).toString() });
  change('motion/edit.json'); change('motion/credit.json');
  assert.equal(w.visualDependencyRevisions.get('child'), 2);
  assert.equal(w.visualDependencyRevisions.has('other'), false);
  assert.equal(renders, 2); assert.equal(editReloads, 0);
  change('.akari/lint.json');
  assert.equal(w.visualInputEpoch, 2); assert.equal(renders, 2);
});
