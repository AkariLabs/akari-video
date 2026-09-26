import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appendAiStillPanel, replaceStillInEdit, stillRouteAvailability, stillRouteLabel, stillFalPrices, stillFalPriceAsOf } from '../lib/browser/inspector/ai-still-panel.js';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariInspectorWidget');
const methods = ['selectStillCandidate', 'adoptStillCandidate'].map(name =>
  widget.members.find(row => row.name?.getText(ast) === name).getText(ast)).join('\n');
const code = ts.transpileModule(`class CandidateWidget { ${methods} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const CandidateWidget = new Function('replaceStillInEdit', `${code}; return CandidateWidget;`)(replaceStillInEdit);

test('有料を含む複数案は合計を一度だけ承認し、拒否では送信しない', async () => {
  const start = widget.members.find(row => row.name?.getText(ast) === 'startStillGeneration').getText(ast);
  const script = ts.transpileModule(`class StartWidget { ${start} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  let confirmations = 0;
  let message = '';
  const ConfirmDialog = class { constructor(options) { confirmations++; message = options.msg; } async open() { return false; } };
  const StartWidget = new Function('ConfirmDialog', 'stillRouteAvailability', 'stillFalPrices', 'stillFalPriceAsOf',
    `${script}; return StartWidget;`)(ConfirmDialog, stillRouteAvailability, stillFalPrices, stillFalPriceAsOf);
  const instance = new StartWidget();
  const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['codex', 'fal']),
    routes: [{ id: 'codex', state: 'ready' }, { id: 'fal', state: 'ready' }], running: false };
  instance.aiStillStates = new Map([['clip-1', state]]);
  instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
  instance.layerAudioService = { startGenerateStillBatch: () => { throw new Error('送信してはいけません'); } };
  await instance.startStillGeneration({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'old.png' });
  assert.equal(confirmations, 1);
  assert.match(message, /2 案/u);
  assert.match(message, /合計見積もり \$0\.053/u);
  assert.equal(state.running, false);
});

test('失敗行の再試行はフォームを変更しても最初の入力を送る', async () => {
  const start = widget.members.find(row => row.name?.getText(ast) === 'startStillGeneration').getText(ast);
  const script = ts.transpileModule(`class StartWidget { ${start} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const StartWidget = new Function('stillRouteAvailability', 'stillFalPrices', 'stillFalPriceAsOf',
    `${script}; return StartWidget;`)(stillRouteAvailability, stillFalPrices, stillFalPriceAsOf);
  const previousWindow = globalThis.window;
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  try {
    const instance = new StartWidget();
    const snapshot = { prompt: 'original', aspect: '1:1', references: ['assets/reference.png'], cropToAspect: false,
      quality: 'high' };
    const state = { prompt: 'changed', aspect: '16:9', references: [], cropToAspect: true,
      routes: [{ id: 'codex', state: 'ready' }], running: false };
    instance.aiStillStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    let sent;
    instance.layerAudioService = { startGenerateStillBatch: async request => { sent = request; return {}; },
      readStillCandidates: async () => ({ routes: ['codex'], completed: 1, candidates: [], running: false }) };
    instance.generationTabMeta = new Map(); instance.generationStates = new Map();
    instance.generationIdentity = () => undefined;
    instance.model = { snapshot: {} };
    instance.render = () => {};
    instance.renderStillProgress = () => {};
    await instance.startStillGeneration({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'old.png' }, ['codex'], snapshot);
    assert.equal(sent.prompt, 'original');
    assert.equal(sent.aspect, '1:1');
    assert.deepEqual(sent.references, ['assets/reference.png']);
    assert.equal(sent.cropToAspect, false);
  } finally { globalThis.window = previousWindow; }
});

test('実行中のチェックは選択を示したまま無効になり、完成行にサムネイルが付く', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(key, value) { this.listeners.set(key, value); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const parent = new Node('root');
    appendAiStillPanel(parent, { prompt: 'garden', aspect: '16:9', probing: false, running: true,
      selectedRoutes: new Set(['codex', 'antigravity', 'grok']),
      routes: ['codex', 'antigravity', 'grok', 'fal'].map(id => ({ id, state: 'ready', detail: '' })),
      batch: { routes: ['codex', 'antigravity', 'grok'], completed: 1, running: true,
        results: [{ ok: true, route: 'codex', relativePath: 'assets/generated/candidates/x/codex-1.png',
          thumbnail: 'data:image/png;base64,YQ==' }], candidates: [] }
    }, { change() {}, probe() {}, generate() {}, cancel() {} });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(parent);
    const checks = nodes.filter(node => node.attributes.has('data-akari-inspector-ai-route-checkbox'));
    assert.deepEqual(checks.map(node => [node.value, node.checked, node.disabled]), [
      ['codex', true, true], ['antigravity', true, true], ['grok', true, true], ['fal', false, true]
    ]);
    assert.deepEqual(nodes.filter(node => node.attributes.has('data-akari-inspector-ai-progress-state'))
      .map(node => node.attributes.get('data-akari-inspector-ai-progress-state')), ['done', 'running', 'running']);
    assert.equal(nodes.find(node => node.attributes.has('data-akari-inspector-ai-progress-running'))
      ?.attributes.get('data-akari-inspector-ai-progress-running'), 'true');
    assert.equal(nodes.filter(node => node.attributes.has('data-akari-inspector-ai-progress-thumbnail')).length, 1);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});

test('毎秒の読込で途中結果を描き、経過秒とスクロール位置を保持する', async () => {
  const start = widget.members.find(row => row.name?.getText(ast) === 'startStillGeneration').getText(ast);
  const preserve = widget.members.find(row => row.name?.getText(ast) === 'renderStillProgress').getText(ast);
  const script = ts.transpileModule(`class StartWidget { ${start}\n${preserve} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const StartWidget = new Function('stillRouteAvailability', 'stillRouteLabel', 'stillFalPrices', 'stillFalPriceAsOf',
    `${script}; return StartWidget;`)(stillRouteAvailability, stillRouteLabel, stillFalPrices, stillFalPriceAsOf);
  const previousWindow = globalThis.window;
  let tick;
  globalThis.window = { setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {} };
  try {
    const instance = new StartWidget();
    const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['codex', 'antigravity', 'grok']),
      routes: ['codex', 'antigravity', 'grok'].map(id => ({ id, state: 'ready' })), running: false };
    instance.aiStillStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    const row = { attributes: new Map([['data-akari-inspector-ai-progress-route', 'grok']]),
      getAttribute(key) { return this.attributes.get(key); }, setAttribute(key, value) { this.attributes.set(key, value); }, textContent: '' };
    instance.node = { scrollTop: 420, querySelectorAll: () => [row] };
    instance.rememberedView = { scrollTop: 0 };
    instance.aiView = 'still';
    const rendered = [];
    instance.render = () => rendered.push({ scroll: instance.rememberedView.scrollTop, completed: state.batch?.completed });
    instance.refreshStillTimelineProgress = () => {};
    let reads = 0;
    instance.layerAudioService = { startGenerateStillBatch: () => new Promise(resolve => { instance.release = resolve; }),
      readStillCandidates: async () => ++reads === 1
        ? { routes: ['codex', 'antigravity', 'grok'], completed: 0, results: [], candidates: [], running: true }
        : { routes: ['codex', 'antigravity', 'grok'], completed: 1,
          results: [{ route: 'codex', ok: true, relativePath: 'candidate.png' }],
          candidates: [{ route: 'codex', ok: true, relativePath: 'candidate.png' }], running: true } };
    const pending = instance.startStillGeneration({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'old.png' });
    assert.equal(typeof tick, 'function');
    state.startedAt -= 2_000;
    tick(); await new Promise(resolve => setImmediate(resolve));
    const elapsed1 = Number(row.attributes.get('data-akari-inspector-ai-progress-elapsed'));
    state.startedAt -= 2_000;
    tick(); await new Promise(resolve => setImmediate(resolve));
    assert.ok(Number(row.attributes.get('data-akari-inspector-ai-progress-elapsed')) > elapsed1);
    assert.equal(state.batch.results[0].route, 'codex');
    assert.equal(state.batch.completed, 1);
    assert.ok(rendered.some(value => value.completed === 1 && value.scroll === 420));
    instance.release({}); await pending;
  } finally { globalThis.window = previousWindow; }
});

test('候補の仮表示はプレビューの source だけを上書きし、採用は一手の undo で戻る', async () => {
  const oldEvent = globalThis.CustomEvent;
  const oldWindow = globalThis.window;
  const events = [];
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  globalThis.window = { dispatchEvent: event => events.push(event) };
  try {
    const instance = new CandidateWidget();
    const root = { toString: () => 'file:///project', resolve: name => ({ toString: () => `file:///project/${name}` }) };
    const identity = { key: 'clip-1', itemId: 'clip-1' };
    const first = { ok: true, route: 'codex', relativePath: 'assets/generated/candidates/clip-1/codex-1.png',
      thumbnail: 'data:image/png;base64,YQ==' };
    const second = { ok: true, route: 'grok', relativePath: 'assets/generated/candidates/clip-1/grok-2.png',
      thumbnail: 'data:image/png;base64,Yg==' };
    const state = { running: false, batch: { candidates: [first, second] } };
    instance.aiStillStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
    instance.fileService = { readFile: async () => ({ value: { toString: () => JSON.stringify({
      tracks: [{ items: [{ id: 'clip-1', source: { src: 'old' } }] }]
    }) } }) };
    instance.render = () => {};
    instance.generationTabMeta = new Map();
    instance.generationStates = new Map();
    instance.generationIdentity = () => undefined;
    instance.model = { snapshot: {} };
    let edit = { sources: [{ id: 'old', path: 'old.png' }], tracks: [{ items: [
      { id: 'clip-1', source: { kind: 'media', src: 'old' }, transform: { scale: 0.5, x: 25 } }
    ] }] };
    const original = structuredClone(edit);
    const undo = [];
    instance.stillWidgetManager = { getWidgets: () => [{ isDisposed: false, location: { root },
      commitEditMutation: async (_label, mutation) => {
        undo.push(structuredClone(edit)); edit = mutation(structuredClone(edit));
      } }] };
    await instance.selectStillCandidate(identity, first);
    assert.equal(state.pickedCandidate, first.relativePath);
    assert.equal(events.at(-1).detail.sourceId, 'old');
    assert.equal(events.at(-1).detail.itemId, 'clip-1');
    assert.equal(events.at(-1).detail.imageUrl, first.thumbnail);
    assert.deepEqual(edit, original);
    await instance.selectStillCandidate(identity, second);
    assert.equal(events.at(-1).detail.imageUrl, second.thumbnail);
    await instance.selectStillCandidate(identity, second);
    assert.equal(events.at(-1).detail.imageUrl, null);
    await instance.selectStillCandidate(identity, first);
    await instance.adoptStillCandidate(identity);
    assert.equal(undo.length, 1);
    assert.equal(edit.sources.find(row => row.id === edit.tracks[0].items[0].source.src).path, first.relativePath);
    assert.deepEqual(edit.tracks[0].items[0].transform, original.tracks[0].items[0].transform);
    edit = undo.pop();
    assert.deepEqual(edit, original);
    assert.deepEqual(state.batch.candidates, [first, second]);
  } finally {
    globalThis.CustomEvent = oldEvent;
    globalThis.window = oldWindow;
  }
});
