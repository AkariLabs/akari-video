import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { emptyFrameTransform, frameAspectTransform, frameDimensions } from '../lib/browser/inspector/frame-geometry.js';
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
  const method = widgetClass.members.find(node => node.name?.getText(ast) === 'setEmptyFrameAspect').getText(ast);
  const code = ts.transpileModule(`class Harness { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  return new Function('replaceStillInEdit', 'frameDimensions', 'frameAspectTransform', `${code}; return Harness;`)
    (replaceStillInEdit, frameDimensions, frameAspectTransform);
}

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
  const instance = Object.assign(new Harness(), {
    workspaceService: { tryGetRoots: () => [{ resource: uri }] },
    aiStillStates: new Map([['frame', { aspect: '9:16' }]]),
    layerAudioService: { setEmptyFrameAspect: async () => ({ relativePath: 'new.png', transform: { x: 30, y: -10, scale: 1.23 } }) },
    generationIdentity: () => ({ sourcePath: 'old.png' }),
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
  });
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
  const instance = Object.assign(new Harness(), {
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
    generationIdentity: () => ({ sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [timeline] },
    commandRegistry: { async executeCommand(id) { return id === 'akari.timeline.playhead' ? '1.5' : 'seeked'; } },
    loadGeneration() {}, render() {}
  });
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
  const instance = Object.assign(new Harness(), {
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
    generationIdentity: () => ({ sourcePath: 'old.png' }),
    stillWidgetManager: { getWidgets: () => [{ isDisposed: false, location: { root: uri },
      async commitEditMutation() { throw new Error('commit failed'); } }] },
    render() {}
  });
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
    appendAiStillPanel(parent, state, { change: value => { selected = value; }, probe() {}, generate() {}, cancel() {} });
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
  } finally { await rm(root, { recursive: true, force: true }); }
});
