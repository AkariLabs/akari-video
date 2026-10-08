import { readInspectorSource } from './helpers/inspector-source.mjs';
import './timeline-harness-dependencies.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appendAiStillPanel, firstSuccessfulStillCandidate, placeStillInEdit, savedStillInput, stillRouteAvailability, stillRouteLabel } from '../lib/browser/inspector/ai-still-panel.js';
import { appendAiStillResultPanel } from '../lib/browser/inspector/ai-still-result-panel.js';

const source = readInspectorSource();
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariInspectorWidget');
const methods = ['putStillCandidate'].map(name =>
  widget.members.find(row => row.name?.getText(ast) === name).getText(ast)).join('\n');
const code = ts.transpileModule(`class CandidateWidget { ${methods} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const CandidateWidget = new Function('placeStillInEdit', `${code}; return CandidateWidget;`)(placeStillInEdit);

test('見積もりの読込 Promise と値を共有し、新しい静止画状態では再読込・再描画しない', async () => {
  const ensure = widget.members.find(row => row.name?.getText(ast) === 'ensureStillFalEstimate').getText(ast);
  const script = ts.transpileModule(`class EstimateWidget { ${ensure} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const EstimateWidget = new Function(`${script}; return EstimateWidget;`)();
  const instance = new EstimateWidget();
  const first = { falEstimate: undefined };
  instance.aiStillStates = new Map([['first', first]]);
  instance.aiView = 'still';
  instance.model = { snapshot: {} };
  instance.generationIdentity = () => ({ key: 'first' });
  let reads = 0;
  let finish;
  instance.layerAudioService = { readGenerationCatalog: () => {
    reads++;
    return new Promise(resolve => { finish = resolve; });
  } };
  let renders = 0;
  instance.render = () => { renders++; };
  instance.ensureStillFalEstimate();
  const pending = instance.stillFalEstimateLoading;
  instance.ensureStillFalEstimate();
  assert.equal(reads, 1);
  assert.equal(instance.stillFalEstimateLoading, pending);
  const second = { falEstimate: instance.stillFalEstimate };
  instance.aiStillStates.set('second', second);
  instance.generationIdentity = () => ({ key: 'second' });
  const estimate = { prices: { low: 0.006, medium: 0.0133, high: 0.0528 }, asOf: '2026-09-26' };
  finish({ models: [], stillEstimate: estimate });
  await pending;
  assert.equal(renders, 1);
  assert.equal(first.falEstimate, estimate);
  assert.equal(second.falEstimate, estimate);
  const next = { falEstimate: instance.stillFalEstimate };
  assert.equal(next.falEstimate, estimate);
  instance.ensureStillFalEstimate();
  assert.equal(reads, 1);
  assert.equal(renders, 1);
  assert.match(source, /cropToAspect: saved\.cropToAspect \?\? savedStillCrop\(\)/u);
});

test('見積もり読込後の再描画は未設定の静止画パネルが表示中のときだけ', async () => {
  const ensure = widget.members.find(row => row.name?.getText(ast) === 'ensureStillFalEstimate').getText(ast);
  const script = ts.transpileModule(`class EstimateWidget { ${ensure} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const EstimateWidget = new Function(`${script}; return EstimateWidget;`)();
  for (const [view, alreadyPriced] of [['tiles', false], ['still', true]]) {
    const instance = new EstimateWidget();
    const estimate = { prices: { low: 1, medium: 2, high: 3 }, asOf: 'test' };
    instance.aiStillStates = new Map([['current', { falEstimate: alreadyPriced ? estimate : undefined }]]);
    instance.aiView = view;
    instance.model = { snapshot: {} };
    instance.generationIdentity = () => ({ key: 'current' });
    instance.layerAudioService = { readGenerationCatalog: async () => ({ models: [], stillEstimate: estimate }) };
    let renders = 0;
    instance.render = () => { renders++; };
    instance.ensureStillFalEstimate();
    await instance.stillFalEstimateLoading;
    assert.equal(renders, 0, `${view}/${alreadyPriced}`);
  }
});

test('有料を含む複数案は合計を一度だけ承認し、拒否では送信しない', async () => {
  const start = widget.members.find(row => row.name?.getText(ast) === 'startStillGeneration').getText(ast);
  const script = ts.transpileModule(`class StartWidget { ${start} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  let confirmations = 0;
  let message = '';
  const ConfirmDialog = class { constructor(options) { confirmations++; message = options.msg; } async open() { return false; } };
  const StartWidget = new Function('ConfirmDialog', 'stillRouteAvailability', 'firstSuccessfulStillCandidate', 'activeEditRequest',
    `${script}; return StartWidget;`)(ConfirmDialog, stillRouteAvailability, firstSuccessfulStillCandidate, () => ({}));
  const instance = new StartWidget();
  const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['codex', 'fal']),
    falEstimate: { prices: { low: 0.006, medium: 0.0133, high: 0.0528 }, asOf: '2026-09-26' },
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
  const StartWidget = new Function('stillRouteAvailability', 'firstSuccessfulStillCandidate', 'activeEditRequest',
    `${script}; return StartWidget;`)(stillRouteAvailability, firstSuccessfulStillCandidate, () => ({}));
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
    instance.layerAudioService = { startGenerateStillBatch: async request => { sent = request;
      return { routes: ['codex'], results: [], candidates: [], completed: 1, running: false }; },
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

test('指示には作ると結果を見るだけ、結果には入れた指示と二つの固定ボタンが出る', () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.style = {}; this.textContent = ''; this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    appendChild(node) { this.children.push(node); return node; }
    setAttribute(key, value) { this.attributes.set(key, value); }
    addEventListener(key, value) { this.listeners.set(key, value); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const parent = new Node('root');
    appendAiStillPanel(parent, { prompt: 'garden', aspect: '16:9', probing: false, running: false,
      selectedRoutes: new Set(['codex', 'antigravity', 'grok']),
      routes: ['codex', 'antigravity', 'grok', 'fal'].map(id => ({ id, state: 'ready', detail: '' })),
      batch: { routes: ['codex', 'antigravity', 'grok'], completed: 3, running: false,
        results: [{ ok: true, route: 'codex', relativePath: 'assets/generated/candidates/x/codex-1.png',
          thumbnail: 'data:image/png;base64,YQ==' }], candidates: [{ ok: true, route: 'codex',
          relativePath: 'assets/generated/candidates/x/codex-1.png', width: 705, height: 1254,
          croppedFrom: '1254x1254' }] }
    }, { change() {}, probe() {}, generate() {}, showResult() {} });
    const walk = node => [node, ...node.children.flatMap(walk)];
    const nodes = walk(parent);
    assert.ok(nodes.some(node => node.attributes.has('data-akari-inspector-ai-create')));
    assert.ok(nodes.some(node => node.attributes.has('data-akari-inspector-ai-show-result')));
    assert.equal(nodes.some(node => node.attributes.has('data-akari-inspector-ai-adopt')), false);
    const result = new Node('root');
    appendAiStillResultPanel(result, { prompt: 'garden', aspect: '16:9', running: false,
      batch: { routes: ['fal'], completed: 1, running: false, candidates: [{ route: 'fal', ok: true,
        relativePath: 'candidate.png', width: 705, height: 1254, croppedFrom: '1254x1254', costUsd: 0.053,
        thumbnail: 'data:image/png;base64,YQ==' }] },
      inFramePath: 'candidate.png', actions: { home() {}, redo() {}, toVideo() {}, cancel() {}, select() {} } });
    const rendered = walk(result);
    assert.equal(rendered.find(node => node.attributes.has('data-akari-inspector-ai-result-prompt'))
      .children[1].textContent, 'garden · 16:9');
    assert.ok(rendered.some(node => node.attributes.get('data-akari-inspector-ai-result-in-frame') === 'true'));
    assert.ok(rendered.some(node => /fal · GPT Image 2\.5 Flare · 0 秒 · 705×1254 · \$0\.053/u.test(node.textContent)));
    assert.ok(rendered.some(node => node.attributes.get('data-akari-inspector-ai-maker') === 'openai'));
    assert.ok(rendered.some(node => node.attributes.get('data-akari-inspector-ai-cropped') === 'true'
      && node.textContent === '9:16 を頼んで正方形 → 切りそろえました'));
    assert.equal(rendered.filter(node => node.attributes.has('data-akari-inspector-ai-result-redo')
      || node.attributes.has('data-akari-inspector-ai-result-to-video')).length, 2);
    assert.equal(rendered.some(node => node.textContent === 'この案を使う'), false);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});

test('作るとすぐ結果へ移り、全手段の完了後に最初の成功案を一度だけ入れる', async () => {
  const start = widget.members.find(row => row.name?.getText(ast) === 'startStillGeneration').getText(ast);
  const preserve = widget.members.find(row => row.name?.getText(ast) === 'renderStillProgress').getText(ast);
  const script = ts.transpileModule(`class StartWidget { ${start}\n${preserve} }`,
    { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const StartWidget = new Function('stillRouteAvailability', 'stillRouteLabel', 'firstSuccessfulStillCandidate', 'activeEditRequest',
    `${script}; return StartWidget;`)(stillRouteAvailability, stillRouteLabel, firstSuccessfulStillCandidate, () => ({}));
  const previousWindow = globalThis.window;
  let tick;
  globalThis.window = { setInterval: callback => { tick = callback; return 1; }, clearInterval: () => {} };
  try {
    const instance = new StartWidget();
    const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['codex', 'antigravity', 'grok']),
      routes: ['codex', 'antigravity', 'grok'].map(id => ({ id, state: 'ready' })), running: false };
    instance.aiStillStates = new Map([['clip-1', state]]);
    instance.workspaceService = { tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    instance.node = { scrollTop: 420, querySelectorAll: () => [] };
    instance.rememberedView = { scrollTop: 420 };
    instance.aiView = 'still';
    instance.generationIdentity = () => ({ key: 'clip-1', itemId: 'clip-1' });
    instance.model = { snapshot: {} };
    instance.generationTabMeta = new Map(); instance.generationStates = new Map();
    const rendered = [];
    instance.render = () => rendered.push({ view: instance.aiView, completed: state.batch?.completed });
    instance.showStillResult = () => { instance.aiView = 'still-result'; instance.rememberedView.scrollTop = 0;
      instance.node.scrollTop = 0; instance.render(); };
    instance.refreshStillTimelineProgress = () => {};
    const placed = [];
    instance.putStillCandidate = async (_identity, path) => { placed.push(path); };
    instance.loadGeneration = async () => {};
    let reads = 0, finishPoll;
    instance.layerAudioService = { startGenerateStillBatch: () => new Promise(resolve => { instance.release = resolve; }),
      readStillCandidates: () => ++reads === 1
        ? Promise.resolve({ routes: ['codex', 'antigravity', 'grok'], completed: 0, results: [], candidates: [], running: true })
        : reads === 4 ? new Promise(resolve => { finishPoll = resolve; }) : Promise.resolve({ routes: ['codex', 'antigravity', 'grok'], completed: 1,
          results: [{ route: 'antigravity', ok: true, relativePath: 'second.png' }],
          candidates: [{ route: 'antigravity', ok: true, relativePath: 'second.png' }], running: true }) };
    const pending = instance.startStillGeneration({ key: 'clip-1', itemId: 'clip-1', sourcePath: 'old.png' });
    assert.equal(typeof tick, 'function');
    assert.equal(instance.aiView, 'still-result');
    assert.equal(instance.rememberedView.scrollTop, 0);
    tick(); await new Promise(resolve => setImmediate(resolve));
    state.lastPolledAt -= 1000;
    tick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(state.batch.results[0].route, 'antigravity');
    assert.equal(state.batch.completed, 1);
    assert.ok(rendered.some(value => value.completed === 1 && value.view === 'still-result'));
    state.lastPolledAt -= 1000;
    tick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishPoll, 'function');
    instance.release({ routes: ['codex', 'antigravity', 'grok'], results: [
      { route: 'codex', ok: false }, { route: 'antigravity', ok: true, relativePath: 'second.png' },
      { route: 'grok', ok: true, relativePath: 'third.png' }
    ], candidates: [], completed: 3, running: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(placed, [], '進行中の読込が終わるまで edit に書かない');
    finishPoll({ routes: ['codex', 'antigravity', 'grok'], completed: 1,
      results: [{ route: 'antigravity', ok: true, relativePath: 'second.png' }],
      candidates: [{ route: 'antigravity', ok: true, relativePath: 'second.png' }], running: false });
    await pending;
    assert.deepEqual(placed, ['second.png']);
  } finally { globalThis.window = previousWindow; }
});

test('候補を押すたび一手で入れ替わり、source を再利用して空の枠の名を外す', async () => {
  const instance = new CandidateWidget();
  const root = { toString: () => 'file:///project' };
  const identity = { key: 'clip-1', itemId: 'clip-1' };
  instance.aiStillStates = new Map([['clip-1', {}]]);
  instance.workspaceService = { tryGetRoots: () => [{ resource: root }] };
  instance.render = () => {};
  instance.generationTabMeta = new Map(); instance.generationStates = new Map();
  instance.generationIdentity = () => undefined; instance.model = { snapshot: {} };
  let edit = { sources: [{ id: 'old', path: 'old.png' }], tracks: [{ items: [
    { id: 'clip-1', name: '空の枠', source: { kind: 'media', src: 'old' }, transform: { scale: 0.5, x: 25 } }
  ] }] };
  const original = structuredClone(edit), undo = [], labels = [];
  let transientFailures = 0;
  instance.stillWidgetManager = { getWidgets: () => [{ isDisposed: false, location: { root },
    commitEditMutation: async (label, mutation) => {
      if (transientFailures-- > 0) throw Object.assign(new Error('rename EPERM'), { code: 'EPERM' });
      const before = structuredClone(edit), after = mutation(structuredClone(edit));
      if (JSON.stringify(before) === JSON.stringify(after)) return { result: { committed: false } };
      labels.push(label); undo.push(before); edit = after;
      return { result: { committed: true } };
    } }] };
  await instance.putStillCandidate(identity, 'first.png');
  assert.equal(edit.sources.find(row => row.id === edit.tracks[0].items[0].source.src).path, 'first.png');
  assert.equal(edit.tracks[0].items[0].name, undefined);
  assert.deepEqual(edit.tracks[0].items[0].transform, original.tracks[0].items[0].transform);
  await instance.putStillCandidate(identity, 'second.png');
  assert.equal(edit.sources.find(row => row.id === edit.tracks[0].items[0].source.src).path, 'second.png');
  assert.equal(edit.sources.some(row => row.path === 'first.png'), false);
  await instance.putStillCandidate(identity, 'first.png');
  assert.equal(edit.sources.length, 2);
  assert.deepEqual(labels, ['静止画を入れる', '静止画を入れる', '静止画を入れる']);
  edit = undo.pop();
  assert.equal(edit.sources.find(row => row.id === edit.tracks[0].items[0].source.src).path, 'second.png');
  transientFailures = 2;
  await instance.putStillCandidate(identity, 'third.png');
  assert.equal(edit.sources.find(row => row.id === edit.tracks[0].items[0].source.src).path, 'third.png');
  assert.equal(labels.length, 4, 'rename が一時的に拒否されても履歴は一件だけ');
  edit.tracks[0].items = [];
  await instance.putStillCandidate(identity, 'fourth.png');
  assert.equal(edit.sources.some(row => row.path === 'fourth.png'), false);
  assert.equal(labels.length, 4);
});

test('1 案と 3 案は手段の並びで最初の成功を選び、全案失敗では何も選ばない', () => {
  const success = (route, path) => ({ route, ok: true, relativePath: path });
  const failed = route => ({ route, ok: false, reason: '失敗' });
  assert.equal(firstSuccessfulStillCandidate({ routes: ['codex'], results: [success('codex', 'one.png')],
    candidates: [], completed: 1, running: false }).relativePath, 'one.png');
  assert.equal(firstSuccessfulStillCandidate({ routes: ['codex', 'grok', 'fal'],
    results: [success('fal', 'third.png'), success('grok', 'second.png'), failed('codex')],
    candidates: [], completed: 3, running: false }).relativePath, 'second.png');
  assert.equal(firstSuccessfulStillCandidate({ routes: ['codex', 'grok'],
    results: [failed('codex'), failed('grok')], candidates: [], completed: 2, running: false }), undefined);
});

test('既存 source は再利用し、消えた枠では edit を変えない', () => {
  const doc = { sources: [{ id: 'old', path: 'old.png' }, { id: 'saved', path: 'candidate.png' }],
    tracks: [{ items: [{ id: 'clip', source: { kind: 'media', src: 'old' }, transform: { x: 7 } }] }] };
  placeStillInEdit(doc, 'clip', 'candidate.png');
  assert.equal(doc.tracks[0].items[0].source.src, 'saved');
  assert.equal(doc.sources.length, 2);
  assert.deepEqual(doc.tracks[0].items[0].transform, { x: 7 });
  const before = structuredClone(doc);
  placeStillInEdit(doc, 'gone', 'another.png');
  assert.deepEqual(doc, before);
});

test('静止画の差し替えで旧素材が組の基準なら残りを付け直す', () => {
  const doc = { sources: [
    { id: 'still-src-1', path: 'old.png' }, { id: 'mic', path: 'mic.wav' },
    { id: 'mic2', path: 'mic2.wav' }],
  sync_groups: [{ id: 'take', members: [
    { source: 'still-src-1', offset_sec: 0 }, { source: 'mic', offset_sec: 0.5 },
    { source: 'mic2', offset_sec: 0.2 } ] }],
  tracks: [{ items: [{ id: 'clip', source: { kind: 'media', src: 'still-src-1' } }] }] };
  placeStillInEdit(doc, 'clip', 'new.png');
  assert.deepEqual(doc.sync_groups[0].members,
    [{ source: 'mic', offset_sec: 0 }, { source: 'mic2', offset_sec: -0.3 }]);
  assert.equal(doc.sources.some(source => source.id === 'still-src-1'), false);
});

test('sidecar の元の入力をメモリなしで読み、結果の作成中と失敗を描く', () => {
  const meta = { inputs: { prompt: '画角を足す前', extra: { still_batch: { prompt: '画角を足す前',
    aspect: '9:16', routes: ['codex', 'grok'], references: ['ref.png'], cropToAspect: false } } },
    output: { aspect: '9:16' } };
  const saved = savedStillInput(meta);
  assert.deepEqual([saved.prompt, saved.aspect, saved.routes, saved.references, saved.cropToAspect],
    ['画角を足す前', '9:16', ['codex', 'grok'], ['ref.png'], false]);
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map();
      this.style = {}; this.classList = { add() {} }; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const actions = { home() {}, redo() {}, toVideo() {}, cancel() {}, select() {} };
    const walk = node => [node, ...node.children.flatMap(walk)];
    const pending = new Node('root');
    appendAiStillResultPanel(pending, { prompt: saved.prompt, aspect: saved.aspect, running: true,
      batch: { routes: ['codex', 'grok'], completed: 1, running: true, candidates: [],
        results: [{ route: 'codex', ok: true, relativePath: 'first.png' }] }, actions });
    const pendingNodes = walk(pending);
    assert.equal(pendingNodes.filter(node => node.attributes.has('data-akari-inspector-ai-result-pending')).length, 1);
    assert.ok(pendingNodes.some(node => node.attributes.has('data-akari-inspector-ai-cancel')));
    assert.equal(pendingNodes.find(node => node.attributes.has('data-akari-inspector-ai-result-to-video')).disabled, true);
    const complete = new Node('root');
    appendAiStillResultPanel(complete, { prompt: saved.prompt, aspect: saved.aspect, running: false,
      batch: { routes: ['codex', 'grok'], completed: 2, running: false, candidates: [],
        results: [{ route: 'codex', ok: false, reason: '使えません' },
          { route: 'grok', ok: true, relativePath: 'second.png' }] }, actions });
    const completeNodes = walk(complete);
    assert.equal(completeNodes.find(node => node.attributes.has('data-akari-inspector-ai-result-failed'))
      .attributes.get('data-akari-inspector-ai-result-failed'), 'codex');
    assert.equal(completeNodes.find(node => node.attributes.has('data-akari-inspector-ai-result-prompt'))
      .children[1].textContent, '画角を足す前 · 9:16');
    assert.equal(completeNodes.some(node => node.attributes.has('data-akari-inspector-ai-cancel')), false);
  } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
});
