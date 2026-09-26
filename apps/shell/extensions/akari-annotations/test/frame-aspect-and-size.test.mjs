import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emptyFrameTransform, frameAspectTransform, frameDimensions } from '../lib/browser/inspector/frame-geometry.js';
import { FrameAspectLive, frameSizeFromPng, frameSizeFromResolution } from '../lib/browser/inspector/frame-aspect-live.js';
import { appendAiStillPanel, replaceStillInEdit } from '../lib/browser/inspector/ai-still-panel.js';
import { initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import ts from 'typescript';

const tracks = [
  { id: 'v1', lane: 'visual', items: [{ at: 10, duration: 100 }] },
  { id: 'v2', lane: 'visual', items: [] },
  { id: 'a1', lane: 'audio', items: [] }
];

test('emptyFrameTransform: overlapping lower video gets width 50% at center', () => {
  assert.deepEqual(emptyFrameTransform(tracks, 'v2', 20, 30), { x: 0, y: 0, scale: 0.5 });
});
test('emptyFrameTransform: no lower video stays fullscreen', () => {
  assert.equal(emptyFrameTransform(tracks, 'v1', 20, 30), undefined);
  assert.equal(emptyFrameTransform(tracks, 'v2', 110, 30), undefined);
});
test('emptyFrameTransform: audio is outside video rule', () => {
  assert.equal(emptyFrameTransform(tracks, 'a1', 20, 30), undefined);
});

for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }]) {
  for (const aspect of ['16:9', '9:16', '1:1']) {
    test(`frameDimensions: ${aspect} in ${canvas.width}x${canvas.height}`, () => {
      const result = frameDimensions(aspect, canvas);
      const [w, h] = aspect.split(':').map(Number);
      assert.ok(result.width <= canvas.width && result.height <= canvas.height);
      assert.ok(Math.abs(result.width / result.height - w / h) < 0.002);
      assert.ok(result.width + w > canvas.width || result.height + h > canvas.height);
    });
  }
}

test('frameAspectTransform: quarter area and moved center survive every aspect', () => {
  const canvas = { width: 1920, height: 1080 };
  let old = canvas;
  let transform = { x: 140, y: -35, scale: 0.5 };
  for (const aspect of ['9:16', '1:1', '16:9']) {
    const next = frameDimensions(aspect, canvas);
    transform = frameAspectTransform(old, next, transform);
    assert.equal(transform.x, 140);
    assert.equal(transform.y, -35);
    assert.ok(Math.abs(next.width * next.height * transform.scale ** 2 - canvas.width * canvas.height / 4) < 0.001);
    old = next;
  }
  assert.equal(frameAspectTransform(canvas, frameDimensions('9:16', canvas), undefined), undefined);
});

test('portrait card in a widescreen canvas is 608x1080', () => {
  assert.deepEqual(frameDimensions('9:16', { width: 1920, height: 1080 }), { width: 608, height: 1080 });
});

test('aspect replacement changes source and transform in one undo entry', () => {
  let doc = { sources: [{ id: 'old', path: 'old.png' }], tracks: [{ items: [{ id: 'frame', source: { kind: 'media', src: 'old' }, transform: { x: 20, y: 0, scale: 0.5 } }] }] };
  const before = structuredClone(doc);
  const history = [];
  const commit = mutation => { const previous = structuredClone(doc); doc = mutation(structuredClone(doc)); history.push(() => { doc = previous; }); };
  commit(value => {
    replaceStillInEdit(value, 'frame', 'new.png');
    value.tracks[0].items[0].transform = frameAspectTransform({ width: 1920, height: 1080 }, { width: 607, height: 1080 }, value.tracks[0].items[0].transform);
    return value;
  });
  assert.equal(history.length, 1);
  assert.equal(doc.tracks[0].items[0].source.src, 'still-src-1');
  assert.equal(doc.tracks[0].items[0].transform.x, 20);
  history[0]();
  assert.deepEqual(doc, before);
});

function aspectHarness() {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const methods = ['setEmptyFrameAspect', 'sendFrameAspectLive', 'ensureFrameSourceSize', 'readFrameSourceSize']
    .map(name => widgetClass.members.find(node => node.name?.getText(ast) === name).getText(ast)).join('\n');
  const code = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  return new Function('replaceStillInEdit', 'FrameAspectLive', 'frameSizeFromPng', 'frameSizeFromResolution', `${code}; return Harness;`)
    (replaceStillInEdit, FrameAspectLive, frameSizeFromPng, frameSizeFromResolution);
}

function stillPanelHarness(appendPanel) {
  const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
  const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
  const method = widgetClass.members.find(node => node.name?.getText(ast) === 'appendStillPanel').getText(ast);
  const code = ts.transpileModule(`class Panel extends Base { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  return new Function('Base', 'appendAiStillPanel', `${code}; return Panel;`)
    (aspectHarness(), appendPanel);
}

function aspectMaps(instance, size) {
  instance.frameAspectLive = new Map();
  instance.frameAspectWrites = new Map();
  instance.frameAspectTargets = new Map();
  if (size) {
    const live = new FrameAspectLive('old.png');
    live.resolveSource('old.png', size);
    instance.frameAspectLive.set('frame', live);
  }
  return instance;
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

test('undo source change discards card size and reads the restored source before live scaling', () => {
  const live = new FrameAspectLive('square.png');
  live.resolveSource('square.png', { width: 1080, height: 1080 });
  live.press('16:9', { width: 1920, height: 1080 }, { scale: 0.5 });
  live.expectSource('wide.png', { width: 1920, height: 1080 });
  live.observeSource('wide.png');
  assert.equal(live.observeSource('square.png'), true); // undo
  live.press('9:16', { width: 1920, height: 1080 }, { scale: 0.5 });
  assert.equal(live.live(), undefined);
  assert.equal(live.resolveSource('wide.png', { width: 1920, height: 1080 }), false);
  assert.equal(live.resolveSource('square.png', { width: 1080, height: 1080 }), true);
  const values = live.live();
  assert.ok(Math.abs(values.scaleX / values.scaleY - 9 / 16) < 0.002);
});

test('source dimensions use sidecar resolution, then PNG IHDR when resolution is absent', async () => {
  const Harness = aspectHarness();
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.set([73, 72, 68, 82], 12);
  new DataView(png.buffer).setUint32(16, 608);
  new DataView(png.buffer).setUint32(20, 1080);
  const root = { resolve: path => path };
  const instance = new Harness();
  instance.fileService = { async readFile(path) {
    return { value: path.endsWith('.meta.json')
      ? { toString: () => JSON.stringify({ output: { resolution: '1080x1080' } }) }
      : { buffer: png } };
  } };
  assert.deepEqual(await instance.readFrameSourceSize(root, 'card.png'), { width: 1080, height: 1080 });
  instance.fileService.readFile = async path => ({ value: path.endsWith('.meta.json')
    ? { toString: () => JSON.stringify({ output: {} }) } : { buffer: png } });
  assert.deepEqual(await instance.readFrameSourceSize(root, 'card.png'), { width: 608, height: 1080 });
  assert.equal(frameSizeFromResolution('bad'), undefined);
  assert.equal(frameSizeFromPng(new Uint8Array(24)), undefined);
});

test('missing card size starts a read and sends no guessed live transform', async () => {
  const Harness = aspectHarness();
  const sizeRead = deferred();
  const rpc = deferred();
  const calls = [];
  const root = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///fixture/edit.json' }) }) };
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: root }] },
    aiStillStates: new Map([['frame', { aspect: '9:16', canvas: { width: 1920, height: 1080 } }]]),
    generationTabMeta: new Map(),
    model: { snapshot: { kind: 'cut', itemId: 'frame', index: 0, transform: { scale: 0.5 } },
      requestLivePreview: request => calls.push(request) },
    readFrameSourceSize: () => { calls.push('read'); return sizeRead.promise; },
    layerAudioService: { setEmptyFrameAspect: () => { calls.push('rpc'); return rpc.promise; } },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root }, async commitEditMutation() {} }] },
    commandRegistry: { executeCommand: async () => '1.5' },
    generationStates: new Map(), loadGeneration() {}, render() {}
  }));
  const done = instance.setEmptyFrameAspect({ key: 'frame', itemId: 'frame', sourcePath: 'old.png' }, '9:16');
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['read', 'rpc']);
  sizeRead.resolve({ width: 1080, height: 1080 });
  await new Promise(setImmediate);
  assert.deepEqual(calls.slice(2).map(row => row.field), ['scaleX', 'scaleY']);
  rpc.resolve({ relativePath: 'new.png', width: 608, height: 1080, transform: { scale: 0.8885 } });
  await done;
});

test('rapid presses keep the latest ratio while old RPC results commit in press order', async () => {
  const Harness = aspectHarness();
  const root = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///fixture/edit.json' }) }) };
  const gates = [deferred(), deferred(), deferred()];
  const calls = [];
  const visible = [];
  const previewBasesDuringCommit = [];
  let path = 'portrait.png';
  let x;
  const snapshot = { kind: 'cut', itemId: 'frame', index: 0, transform: { scale: 0.8885 } };
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: root }] },
    aiStillStates: new Map([['frame', { aspect: '16:9', canvas: { width: 1920, height: 1080 } }]]),
    generationTabMeta: new Map(), generationStates: new Map(),
    model: { snapshot, requestLivePreview(request) {
      if (request.field === 'scaleX') x = request.value;
      else if (request.field === 'scaleY') {
        const base = instance.frameAspectLive.get('frame').previewSize;
        visible.push(base.width * x / (base.height * request.value));
      }
    } },
    layerAudioService: { setEmptyFrameAspect(request) {
      calls.push(`rpc:${request.aspect}`);
      return gates[calls.filter(row => row.startsWith('rpc:')).length - 1].promise;
    } },
    generationIdentity: () => ({ key: 'frame', sourcePath: path }),
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root },
      async commitEditMutation(_label, mutate) {
        const doc = { sources: [{ id: 'old', path }], tracks: [{ items: [{ id: 'frame', source: { kind: 'media', src: 'old' } }] }] };
        mutate(doc);
        path = doc.sources.at(-1).path;
        snapshot.transform = doc.tracks[0].items[0].transform;
        const live = instance.frameAspectLive.get('frame');
        const previousBase = live.previewSize;
        live.observeSource(path);
        previewBasesDuringCommit.push([previousBase.width, live.previewSize.width]);
        calls.push(`commit:${path}`);
      } }] },
    commandRegistry: { executeCommand: async () => '1.5' },
    loadGeneration() {}, render() {}
  }));
  const startingLive = new FrameAspectLive('portrait.png');
  startingLive.resolveSource('portrait.png', { width: 608, height: 1080 });
  instance.frameAspectLive.set('frame', startingLive);
  const identity = { key: 'frame', itemId: 'frame', sourcePath: 'portrait.png' };
  const first = instance.setEmptyFrameAspect(identity, '1:1');
  const second = instance.setEmptyFrameAspect(identity, '9:16');
  const third = instance.setEmptyFrameAspect(identity, '16:9');
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['rpc:1:1']);
  const finalRatio = 16 / 9;
  assert.ok(Math.abs(visible.at(-1) - finalRatio) < 0.002, JSON.stringify({ visible, live: instance.frameAspectLive.get('frame').live() }));
  const afterLastPress = visible.length - 1;
  const results = [
    { relativePath: 'square.png', width: 1080, height: 1080, transform: { scale: 0.6666 } },
    { relativePath: 'portrait-2.png', width: 608, height: 1080, transform: { scale: 0.8885 } },
    { relativePath: 'wide.png', width: 1920, height: 1080, transform: { scale: 0.5 } }
  ];
  for (let index = 0; index < gates.length; index++) {
    gates[index].resolve(results[index]);
    await new Promise(setImmediate);
  }
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, ['rpc:1:1', 'commit:square.png', 'rpc:9:16', 'commit:portrait-2.png',
    'rpc:16:9', 'commit:wide.png']);
  assert.equal(path, 'wide.png');
  assert.deepEqual(previewBasesDuringCommit, [[608, 608], [1080, 1080], [608, 608]]);
  assert.ok(visible.slice(afterLastPress).every(ratio => Math.abs(ratio - finalRatio) < 0.002));
});

test('aspect presses during planned meta reload still commit and preview the last press', async () => {
  let actions;
  const Panel = stillPanelHarness((_body, _state, next) => { actions = next; });
  const root = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///fixture/edit.json' }) }) };
  const results = [
    { relativePath: 'portrait.png', width: 608, height: 1080, transform: { scale: 0.8885 } },
    { relativePath: 'square.png', width: 1080, height: 1080, transform: { scale: 0.6667 } },
    { relativePath: 'wide-2.png', width: 1920, height: 1080, transform: { scale: 0.5 } }
  ];
  const gates = results.map(() => deferred());
  const calls = [];
  const visible = [];
  let sourcePath = 'wide.png';
  let scaleX;
  const snapshot = { kind: 'cut', itemId: 'frame', index: 0, transform: { scale: 0.5 } };
  const state = { aspect: '16:9', canvas: { width: 1920, height: 1080 } };
  const instance = aspectMaps(Object.assign(new Panel(), {
    body: {}, workspaceService: { tryGetRoots: () => [{ resource: root }] },
    aiStillStates: new Map([['frame', state]]),
    generationTabMeta: new Map([['frame', { status: 'planned' }]]),
    generationStates: new Map([['frame', 'planned']]),
    frameAspectPlanned: new Map(),
    model: { snapshot, requestLivePreview(request) {
      if (request.field === 'scaleX') scaleX = request.value;
      if (request.field === 'scaleY') {
        const base = instance.frameAspectLive.get('frame').previewSize;
        visible.push(base.width * scaleX / (base.height * request.value));
      }
    } },
    generationIdentity: () => ({ key: 'frame', itemId: 'frame', sourcePath, duration: 90 }),
    layerAudioService: { setEmptyFrameAspect(request) {
      calls.push(`rpc:${request.aspect}`);
      return gates[calls.filter(row => row.startsWith('rpc:')).length - 1].promise;
    } },
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root },
      async commitEditMutation(_label, mutate) {
        const doc = { sources: [{ id: 'old', path: sourcePath }], tracks: [{ items: [{ id: 'frame', source: { kind: 'media', src: 'old' } }] }] };
        mutate(doc);
        sourcePath = doc.sources.at(-1).path;
        snapshot.transform = doc.tracks[0].items[0].transform;
        instance.frameAspectLive.get('frame').observeSource(sourcePath);
        calls.push(`commit:${sourcePath}`);
        instance.render();
      } }] },
    commandRegistry: { executeCommand: async () => '1.5' },
    loadGeneration() {}, render() { this.appendStillPanel(this.generationIdentity()); }
  }));
  const live = new FrameAspectLive(sourcePath);
  live.resolveSource(sourcePath, { width: 1920, height: 1080 });
  instance.frameAspectLive.set('frame', live);
  instance.render();
  state.aspect = '9:16';
  actions.change('9:16');
  await new Promise(setImmediate);
  gates[0].resolve(results[0]);
  await new Promise(setImmediate);
  assert.equal(sourcePath, 'portrait.png');
  assert.equal(instance.generationStates.size, 0);
  assert.equal(instance.generationTabMeta.size, 0);
  state.aspect = '1:1';
  actions.change('1:1');
  state.aspect = '16:9';
  actions.change('16:9');
  await new Promise(setImmediate);
  assert.ok(Math.abs(visible.at(-1) - 16 / 9) < 0.002);
  gates[1].resolve(results[1]);
  await new Promise(setImmediate);
  gates[2].resolve(results[2]);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['rpc:9:16', 'commit:portrait.png', 'rpc:1:1', 'commit:square.png',
    'rpc:16:9', 'commit:wide-2.png']);
  assert.equal(sourcePath, 'wide-2.png');
  assert.ok(Math.abs(visible.at(-1) - 16 / 9) < 0.002);
});

test('completed still never calls planned frame aspect replacement', () => {
  let actions;
  const Panel = stillPanelHarness((_body, _state, next) => { actions = next; });
  let calls = 0;
  const instance = Object.assign(new Panel(), {
    body: {}, aiStillStates: new Map([['frame', { aspect: '16:9' }]]),
    generationStates: new Map([['frame', 'done']]),
    generationTabMeta: new Map([['frame', { status: 'done' }]]),
    frameAspectPlanned: new Map([['frame', new Set(['finished.png'])]]),
    model: { snapshot: {} },
    generationIdentity: () => ({ key: 'frame', itemId: 'frame', sourcePath: 'finished.png' }),
    setEmptyFrameAspect() { calls++; }, render() {}
  });
  instance.appendStillPanel({ key: 'frame', itemId: 'frame', sourcePath: 'finished.png', duration: 90 });
  actions.change('9:16');
  assert.equal(calls, 0);
});

test('an old failed RPC cannot clear a newer live aspect', async () => {
  const Harness = aspectHarness();
  const root = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///fixture/edit.json' }) }) };
  const firstRpc = deferred();
  const secondRpc = deferred();
  const liveRequests = [];
  let rpcCount = 0;
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: root }] },
    aiStillStates: new Map([['frame', { aspect: '16:9', canvas: { width: 1920, height: 1080 } }]]),
    generationTabMeta: new Map(), generationStates: new Map(),
    model: { snapshot: { kind: 'cut', itemId: 'frame', index: 0, transform: { scale: 0.5 } },
      requestLivePreview: request => liveRequests.push(request) },
    layerAudioService: { setEmptyFrameAspect: () => (++rpcCount === 1 ? firstRpc.promise : secondRpc.promise) },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root }, async commitEditMutation() {} }] },
    commandRegistry: { executeCommand: async () => '1.5' },
    loadGeneration() {}, render() {}
  }), { width: 1920, height: 1080 });
  const identity = { key: 'frame', itemId: 'frame', sourcePath: 'old.png' };
  const first = instance.setEmptyFrameAspect(identity, '1:1');
  const second = instance.setEmptyFrameAspect(identity, '16:9');
  await new Promise(setImmediate);
  firstRpc.reject(new Error('old failure'));
  await first;
  await new Promise(setImmediate);
  assert.equal(rpcCount, 2);
  assert.equal(liveRequests.some(request => request.clear), false);
  assert.equal(instance.aiStillStates.get('frame').error, undefined);
  secondRpc.resolve({ relativePath: 'new.png', width: 1920, height: 1080, transform: { scale: 0.5 } });
  await second;
});

for (const previewUpdatesPlayhead of [true, false]) test(
  `inspector aspect action seeks ready preview after one commit and restores playhead (${previewUpdatesPlayhead ? 'preview tick' : 'timeline fallback'})`, async () => {
  const Harness = aspectHarness();
  const editUri = 'file:///fixture/edit.json';
  const uri = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => editUri }) }) };
  const before = { sources: [{ id: 'old', path: 'old.png' }], tracks: [{ items: [
    { id: 'frame', source: { kind: 'media', src: 'old' }, transform: { x: 30, y: -10, scale: 0.5 } }
  ] }] };
  let doc = structuredClone(before);
  const history = [];
  const calls = [];
  let playhead = '1.25';
  const timeline = { isDisposed: false, location: { root: uri },
    async commitEditMutation(_label, mutate) {
      calls.push('commit');
      const previous = structuredClone(doc);
      doc = mutate(structuredClone(doc));
      playhead = '0';
      history.push(() => { doc = previous; });
    } };
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: uri }] },
    aiStillStates: new Map([['frame', { aspect: '9:16' }]]),
    layerAudioService: { setEmptyFrameAspect: async () => ({ relativePath: 'new.png', transform: { x: 30, y: -10, scale: 1.23 } }) },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'old.png' }),
    model: { snapshot: {} },
    stillWidgetManager: { getWidgets: () => [timeline] },
    commandRegistry: { async executeCommand(id, request) {
      if (id === 'akari.timeline.playhead') return playhead;
      calls.push({ id, request });
      if (id === 'akari.preview.seekOutput') {
        assert.equal(doc.tracks[0].items[0].source.src, 'still-src-1');
        if (previewUpdatesPlayhead) playhead = String(request.time);
        return 'seeked';
      }
      if (id === 'akari.timeline.seek') playhead = String(request.seconds);
    } },
    generationTabMeta: new Map(), generationStates: new Map(), loadGeneration() {}, render() {}
  }));
  await instance.setEmptyFrameAspect({ key: 'frame', itemId: 'frame', sourcePath: 'old.png' }, '9:16');
  assert.equal(instance.aiStillStates.get('frame').error, undefined);
  assert.equal(history.length, 1);
  assert.deepEqual(calls, ['commit', { id: 'akari.preview.seekOutput', request: {
    editUri, time: 1.25, waitForReady: true
  } }, ...(!previewUpdatesPlayhead ? [{ id: 'akari.timeline.seek', request: { seconds: 1.25 } }] : [])]);
  assert.equal(playhead, '1.25');
  assert.equal(doc.tracks[0].items[0].source.src, 'still-src-1');
  assert.deepEqual(doc.tracks[0].items[0].transform, { x: 30, y: -10, scale: 1.23 });
  history[0]();
  assert.deepEqual(doc, before);
});

test('planned cut sends live 9:16 scales before RPC without adding an edit mutation', async () => {
  const Harness = aspectHarness();
  const calls = [];
  const uri = { toString: () => 'file:///fixture', resolve: () => ({ normalizePath: () => ({ toString: () => 'file:///fixture/edit.json' }) }) };
  const doc = { sources: [{ id: 'old', path: 'old.png' }], tracks: [{ items: [
    { id: 'frame', source: { kind: 'media', src: 'old' }, transform: { x: 0, y: 0, scale: 0.5 } }
  ] }] };
  let mutations = 0;
  const timeline = { isDisposed: false, location: { root: uri }, async commitEditMutation(_label, mutate) {
    mutations++;
    mutate(doc);
  } };
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: uri }] },
    aiStillStates: new Map([['frame', { aspect: '9:16', canvas: { width: 1920, height: 1080 } }]]),
    generationTabMeta: new Map([['frame', { output: { resolution: '1920x1080' } }]]),
    generationStates: new Map(),
    model: { snapshot: { kind: 'cut', itemId: 'frame', index: 2, transform: { scale: 0.5 } },
      requestLivePreview: request => calls.push({ type: 'live', request }) },
    layerAudioService: { async setEmptyFrameAspect() {
      calls.push({ type: 'rpc' });
      return { relativePath: 'new.png', transform: { x: 0, y: 0, scale: 0.888523 } };
    } },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [timeline] },
    commandRegistry: { async executeCommand(id) { return id === 'akari.timeline.playhead' ? '1.5' : 'seeked'; } },
    loadGeneration() {}, render() {}
  }), { width: 1920, height: 1080 });
  await instance.setEmptyFrameAspect({ key: 'frame', itemId: 'frame', sourcePath: 'old.png' }, '9:16');
  assert.equal(instance.aiStillStates.get('frame').error, undefined);
  assert.deepEqual(calls.slice(0, 3).map(call => call.type), ['live', 'live', 'rpc']);
  assert.deepEqual(calls[0].request.target, { kind: 'cut', index: 2 });
  assert.deepEqual(calls[1].request.target, { kind: 'cut', index: 2 });
  assert.equal(calls[0].request.field, 'scaleX');
  assert.equal(calls[1].request.field, 'scaleY');
  assert.ok(Math.abs(calls[0].request.value - 0.2814) < 0.0001);
  assert.ok(Math.abs(calls[1].request.value - 0.8885) < 0.0001);
  assert.equal(mutations, 1);
});

for (const failure of ['RPC', 'commit']) test(`planned item clears both live axes when ${failure} fails`, async () => {
  const Harness = aspectHarness();
  const live = [];
  const uri = { toString: () => 'file:///fixture' };
  const instance = aspectMaps(Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: uri }] },
    aiStillStates: new Map([['frame', { aspect: '9:16', canvas: { width: 1920, height: 1080 } }]]),
    generationTabMeta: new Map([['frame', { output: { resolution: '1920x1080' } }]]),
    model: { snapshot: { kind: 'item', id: 'frame', transform: { scale: 0.5 } },
      requestLivePreview: request => live.push(request) },
    layerAudioService: { async setEmptyFrameAspect() {
      if (failure === 'RPC') throw new Error('RPC failed');
      return { relativePath: 'new.png', transform: { scale: 0.8885 } };
    } },
    commandRegistry: { async executeCommand() { return '1.5'; } },
    generationIdentity: () => ({ key: 'frame', sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root: uri },
      async commitEditMutation() { throw new Error('commit failed'); } }] },
    render() {}
  }), { width: 1920, height: 1080 });
  await instance.setEmptyFrameAspect({ key: 'frame', itemId: 'frame', sourcePath: 'old.png' }, '9:16');
  assert.equal(instance.aiStillStates.get('frame').error, `${failure} failed`);
  assert.deepEqual(live.map(request => [request.target, request.field, request.clear ?? false]), [
    [{ kind: 'item', id: 'frame' }, 'scaleX', false],
    [{ kind: 'item', id: 'frame' }, 'scaleY', false],
    [{ kind: 'item', id: 'frame' }, 'scaleX', true],
    [{ kind: 'item', id: 'frame' }, 'scaleY', true]
  ]);
  assert.deepEqual(live.slice(2).map(request => request.value), [0.5, 0.5]);
});

test('initialTabFor: planned wins over saved video, ordinary photo retains it, explicit tab wins', () => {
  const tabs = tabsForKind('cut', { src: 'frame.png', generationAvailable: true });
  const options = { kind: 'cut', tabs, persisted: 'video', clipKey: 'new', previousClipKey: 'old' };
  assert.equal(initialTabFor({ ...options, generationTodo: true }), 'edit');
  assert.equal(initialTabFor({ ...options, generationTodo: false }), 'video');
  assert.equal(initialTabFor({ ...options, generationTodo: true, explicitTabId: 'video' }), 'video');
});

test('aspect buttons retain data and pressed state, show proportional figures and numbers', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(key, listener) { this.listeners.set(key, listener); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const parent = new Node('root');
    const state = { prompt: '', aspect: '9:16', probing: false, running: false };
    let selected;
    const changes = [];
    appendAiStillPanel(parent, state, { change: value => { selected = value; changes.push(value); }, probe() {}, generate() {}, cancel() {} });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const buttons = walk(parent).filter(node => node.attributes.get('data-akari-inspector-ai-aspect'));
    assert.deepEqual(buttons.map(node => node.attributes.get('data-akari-inspector-ai-aspect')), ['16:9', '9:16', '1:1']);
    assert.deepEqual(buttons.map(node => node.attributes.get('aria-pressed')), ['false', 'true', 'false']);
    for (const button of buttons) {
      const aspect = button.attributes.get('data-akari-inspector-ai-aspect');
      assert.equal(button.children[0].style.aspectRatio, aspect.replace(':', ' / '));
      assert.equal(button.children[1].textContent, aspect);
    }
    buttons[2].listeners.get('click')();
    assert.equal(selected, '1:1');
    buttons[1].listeners.get('pointerdown')({ button: 0 });
    assert.equal(selected, '9:16');
    buttons[1].listeners.get('click')({ detail: 1 });
    assert.deepEqual(changes, ['1:1', '9:16']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
  }
});

test('setEmptyFrameAspect RPC reads planned source and preserves quarter area without editing edit.json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-frame-aspect-'));
  try {
    await mkdir(join(root, 'assets/generated'), { recursive: true });
    const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 },
      sources: [{ id: 'old', path: 'assets/generated/old.png' }],
      tracks: [{ items: [{ id: 'frame', duration: 90, source: { kind: 'media', src: 'old' }, transform: { x: 15, y: -9, scale: 0.5 } }] }] };
    const original = JSON.stringify(edit);
    await writeFile(join(root, 'edit.json'), original);
    await writeFile(join(root, 'assets/generated/old.png.meta.json'), JSON.stringify({ status: 'planned',
      output: { resolution: '1920x1080' }, next: { kind: 'video', status: 'planned' } }));
    const service = new AkariAnnotationsServiceImpl();
    let received;
    service.createEmptyGenerationFrame = async request => {
      received = request;
      await writeFile(join(root, 'assets/generated/new.png.meta.json'), JSON.stringify({ status: 'planned', inputs: {}, output: { aspect: '9:16' } }));
      return { relativePath: 'assets/generated/new.png', width: 607, height: 1080 };
    };
    const result = await service.setEmptyFrameAspect({ projectRootUri: pathToFileURL(root).href, itemId: 'frame', aspect: '9:16' });
    assert.equal(received.durationSeconds, 3);
    assert.equal(received.aspect, '9:16');
    assert.equal(result.relativePath, 'assets/generated/new.png');
    assert.equal(result.transform.x, 15);
    assert.equal(result.transform.y, -9);
    assert.ok(Math.abs(607 * 1080 * result.transform.scale ** 2 - 1920 * 1080 / 4) < 0.001);
    assert.equal(JSON.parse(await readFile(join(root, 'assets/generated/new.png.meta.json'), 'utf8')).next.status, 'planned');
    assert.equal(await readFile(join(root, 'edit.json'), 'utf8'), original);
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.set([73, 72, 68, 82], 12);
    new DataView(png.buffer).setUint32(16, 1080);
    new DataView(png.buffer).setUint32(20, 1080);
    await writeFile(join(root, 'assets/generated/old.png'), png);
    await writeFile(join(root, 'assets/generated/old.png.meta.json'), JSON.stringify({ status: 'planned', output: {} }));
    const fallback = await service.setEmptyFrameAspect({ projectRootUri: pathToFileURL(root).href, itemId: 'frame', aspect: '9:16' });
    assert.ok(Math.abs(607 * 1080 * fallback.transform.scale ** 2 - 1080 * 1080 / 4) < 0.001);
  } finally { await rm(root, { recursive: true, force: true }); }
});
