import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { appendAiStillPanel, stillRouteAvailability } from '../lib/browser/inspector/ai-still-panel.js';
import { readInspectorSource } from './helpers/inspector-source.mjs';

const widgetSource = readInspectorSource();
const widgetAst = ts.createSourceFile('widget.ts', widgetSource, ts.ScriptTarget.Latest, true);
const widget = widgetAst.statements.find(row => ts.isClassDeclaration(row) && row.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(row => row.name?.getText(widgetAst) === name).getText(widgetAst);
const script = ts.transpileModule(`class EstimateWidget {
  ${method('ensureStillFalEstimate')}
  ${method('probeStillRoute')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const EstimateWidget = new Function('stillRouteIds', `${script}; return EstimateWidget;`)(['codex', 'fal', 'antigravity', 'grok']);
const startScript = ts.transpileModule(`class StartWidget { ${method('startStillGeneration')} }`,
  { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const StartWidget = new Function('stillRouteAvailability', `${startScript}; return StartWidget;`)(stillRouteAvailability);

test('料金表の欠落・壊れた JSON・価格の不正はモデルを保って理由を返す', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'still-estimate-'));
  const stillPath = join(dir, 'ai-models.json');
  const genPath = fileURLToPath(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url));
  try {
    for (const [value, reason] of [
      [null, /料金表がない/u],
      ['{broken', /料金表を読めない/u],
      [JSON.stringify({ models: [{ id: 'fal:gpt-image-2.5-flare', price: { unit: 'usd_per_image',
        as_of: '2026-01-01', by_quality_1024: { low: '0.01', medium: 0.02, high: 0.03 } } }] }), /料金の形式が不正/u],
    ]) {
      if (value !== null) await writeFile(stillPath, value);
      const service = new AkariAnnotationsServiceImpl();
      service.findGenerationAsset = async target => {
        if (target.endsWith('gen-models.json')) return genPath;
        if (value === null) throw new Error('missing price file');
        return stillPath;
      };
      const catalog = await service.readGenerationCatalog();
      assert.ok(catalog.models.some(row => row.kind === 'video'));
      assert.match(catalog.stillEstimateError, reason);
      assert.equal(catalog.stillEstimate, undefined);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('見積の失敗後は読み直せて、状態を確かめ直すと理由が消える', async () => {
  const instance = new EstimateWidget();
  const first = {};
  const second = {};
  instance.aiStillStates = new Map([['first', first], ['second', second]]);
  instance.aiView = 'still';
  instance.model = { snapshot: {} };
  instance.generationIdentity = () => ({ key: 'first' });
  let reads = 0;
  let release;
  instance.layerAudioService = {
    readGenerationCatalog: () => { reads++; return new Promise(resolve => { release = resolve; }); },
    probeImageRoutes: async ids => ids.map(id => ({ id, state: 'ready', detail: '' })),
  };
  let renders = 0;
  instance.render = () => { renders++; };
  instance.ensureStillFalEstimate();
  assert.ok(instance.stillFalEstimateLoading);
  assert.equal(first.falEstimateError, undefined);
  release({ models: [], stillEstimateError: '料金表を読めないため見積を出せません' });
  await instance.stillFalEstimateLoading;
  assert.equal(instance.stillFalEstimateLoading, undefined);
  for (const state of [first, second]) {
    assert.match(state.falEstimateError, /料金表を読めない/u);
  }
  assert.ok(renders > 0);
  const probe = instance.probeStillRoute('first');
  assert.equal(reads, 2);
  assert.ok(instance.stillFalEstimateLoading);
  assert.equal(first.falEstimateError, undefined);
  const estimate = { prices: { low: 0.01, medium: 0.02, high: 0.03 }, asOf: '2026-01-01' };
  release({ models: [], stillEstimate: estimate });
  await probe;
  await instance.stillFalEstimateLoading;
  assert.equal(instance.stillFalEstimateLoading, undefined);
  for (const state of [first, second]) {
    assert.equal(state.falEstimate, estimate);
    assert.equal(state.falEstimateError, undefined);
  }
});

test('料金表の読み出しが reject しても確認中を解除し理由を表示する', async () => {
  const instance = new EstimateWidget();
  const state = {};
  instance.aiStillStates = new Map([['first', state]]);
  instance.aiView = 'still';
  instance.render = () => {};
  instance.layerAudioService = { readGenerationCatalog: async () => { throw new Error('private path'); } };
  instance.ensureStillFalEstimate();
  assert.ok(instance.stillFalEstimateLoading);
  assert.equal(state.falEstimateError, undefined);
  await instance.stillFalEstimateLoading;
  assert.match(state.falEstimateError, /料金表を読めない/u);
  assert.equal(instance.stillFalEstimateLoading, undefined);
});

test('fal の見積が無い状態で生成関数に進んでも理由を表示して止まる', async () => {
  const instance = new StartWidget();
  const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['fal']), running: false,
    routes: [{ id: 'fal', state: 'ready', detail: '' }] };
  instance.aiStillStates = new Map([['photo-1', state]]);
  instance.workspaceService = { tryGetRoots: () => [{ resource: {} }] };
  let renders = 0;
  instance.render = () => { renders++; };
  await instance.startStillGeneration({ key: 'photo-1', itemId: 'photo-1', sourcePath: 'assets/photo.png' });
  assert.match(state.falEstimateError, /料金表を読めない/u);
  assert.equal(state.running, false);
  assert.equal(renders, 1);
});

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.style = {}; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  appendChild(node) { this.children.push(node); return node; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  addEventListener(key, callback) { this.listeners.set(key, callback); }
}
const all = node => [node, ...node.children.flatMap(all)];
function panel(state) {
  const root = new Node('root');
  appendAiStillPanel(root, state, { change() {}, probe() {}, generate() {}, cancel() {}, openConnections() {} });
  const nodes = all(root);
  return { nodes,
    prompt: nodes.find(node => node.attributes.has('data-akari-inspector-ai-prompt')),
    submit: nodes.find(node => node.attributes.has('data-akari-inspector-ai-create')) };
}

test('パネルは確認中・失敗・成功・無料を区別し、入力イベントでも失敗時に押せない', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const state = { prompt: '', aspect: '16:9', selectedRoutes: new Set(['fal']), probing: false, running: false,
      routes: [{ id: 'fal', state: 'ready', detail: '' }] };
    let view = panel(state);
    assert.match(view.submit.textContent, /見積確認中/u);
    assert.equal(view.submit.disabled, true);
    state.falEstimateError = '料金表を読めないため見積を出せません';
    view = panel(state);
    assert.match(view.submit.textContent, /見積不可/u);
    assert.ok(view.nodes.some(node => node.attributes.has('data-akari-inspector-ai-estimate-error')
      && node.textContent.includes('状態を確かめ直す')));
    view.prompt.value = 'garden'; view.prompt.listeners.get('input')();
    assert.equal(view.submit.disabled, true);
    state.falEstimateError = undefined;
    state.falEstimate = { prices: { low: 0.01, medium: 0.02, high: 0.03 }, asOf: '2026-01-01' };
    state.prompt = '';
    view = panel(state);
    assert.ok(view.nodes.some(node => node.textContent.includes('見積もり $0.030 / 枚')));
    assert.match(view.submit.textContent, /見積 \$0\.030/u);
    assert.equal(view.submit.disabled, true);
    view.prompt.value = 'garden'; view.prompt.listeners.get('input')();
    assert.equal(view.submit.disabled, false);
    state.selectedRoutes = new Set(['codex']); state.routes = [{ id: 'codex', state: 'ready', detail: '' }];
    state.falEstimate = undefined;
    view = panel(state);
    assert.match(view.submit.textContent, /追加料金なし/u);
    assert.equal(view.submit.disabled, false);
    state.selectedRoutes = new Set(['codex', 'fal']);
    state.routes = [{ id: 'codex', state: 'ready', detail: '' }, { id: 'fal', state: 'missing', detail: '' }];
    view = panel(state);
    assert.equal(view.submit.disabled, true, '選択済みの手段が unavailable なら前段 return と合わせる');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});

test('見積の確認中は指示文を入力しても作成を押せない', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const state = { prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['fal']), running: false,
      routes: [{ id: 'fal', state: 'ready', detail: '' }] };
    const view = panel(state);
    assert.match(view.submit.textContent, /見積確認中/u);
    assert.equal(view.submit.disabled, true);
    view.prompt.value = 'flower garden';
    view.prompt.listeners.get('input')();
    assert.equal(view.submit.disabled, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});

test('見積失敗の理由は手段の行とボタン近くに出て確認中が残らない', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const reason = '料金表がないため見積を出せません';
    const view = panel({ prompt: 'garden', aspect: '16:9', selectedRoutes: new Set(['fal']), running: false,
      routes: [{ id: 'fal', state: 'ready', detail: '' }], falEstimateError: reason });
    const price = view.nodes.find(node => node.className === 'akari-inspector-ai-still-route-price');
    const notice = view.nodes.find(node => node.attributes.has('data-akari-inspector-ai-estimate-error'));
    assert.equal(price.textContent, reason);
    assert.equal(notice.textContent, `${reason}。「状態を確かめ直す」で読み直せます`);
    assert.equal(view.nodes.some(node => node.textContent.includes('確認中')), false);
    assert.equal(view.submit.disabled, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});

test('失敗行の再試行は保存した入力と手段ごとの確認状態で判定する', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try {
    const state = { prompt: '', aspect: '16:9', selectedRoutes: new Set(['codex', 'fal']), running: false,
      probingRoutes: new Set(['codex']), routes: [{ id: 'codex', state: 'ready', detail: '' },
        { id: 'fal', state: 'ready', detail: '' }],
      batchInput: { prompt: 'saved prompt', aspect: '16:9', references: [], cropToAspect: true },
      batch: { routes: ['fal'], completed: 1, results: [], candidates: [
        { route: 'fal', ok: false, reason: 'failed' } ] } };
    const retry = () => panel(state).nodes.find(node => node.attributes.get('data-akari-inspector-ai-retry-route') === 'fal');
    assert.equal(retry().disabled, true, 'fal has no estimate');
    state.falEstimate = { prices: { low: 0.01, medium: 0.02, high: 0.03 }, asOf: '2026-01-01' };
    assert.equal(retry().disabled, false, 'saved prompt and fal readiness permit retry despite empty form and another probe');
    state.probingRoutes = new Set(['fal']);
    assert.equal(retry().disabled, true, 'only this route being checked blocks retry');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
});
