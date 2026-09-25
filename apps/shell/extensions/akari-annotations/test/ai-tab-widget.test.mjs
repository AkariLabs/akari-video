import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { cutSnapshot } from './helpers/perspective-transition-fixture.mjs';
import { InspectorTabState, assignSectionToTab, initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles } from '../lib/browser/inspector/ai-tiles.js';
import { appendAiStillNotice, stillMismatchNotice } from '../lib/browser/inspector/ai-still-panel.js';
import { appendImageAiPanel } from '../lib/browser/inspector/image-ai-panel.js';
import { isInspectorStillImage } from '../lib/browser/inspector/edit-target.js';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(node => node.name?.getText(ast) === name).getText(ast);
const dependencies = {
  CAPTION_ZONE_HOVER_EVENT: '', createSelectionHeader: () => new FakeNode('header'),
  CUT_SECTIONS: (_snapshot, _write, fields) => fields ? [{ id: 'generation', label: '生成', fields }] : [],
  LAYER_SECTIONS: () => [],
  TREE_ITEM_SECTIONS: () => [],
  layerAudioControls: new WeakMap(),
  tabsForKind, initialTabFor, assignSectionToTab,
  aiActionCatalog, describeAiTiles,
  aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles,
  appendImageAiPanel,
  appendAiStillNotice, stillMismatchNotice, isInspectorStillImage,
  ADJUST_SECTIONS: () => [{ id: 'adjust:basic', label: '基本補正', fields: [] }]
};
const code = ts.transpileModule(`class Harness {
${['render', 'tabSourceHint', 'generationIdentity', 'appendTabStrip', 'loadAiCatalog'].map(method).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));

class FakeNode {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.className = ''; this.textContent = ''; this.style = {}; this.isConnected = true; }
  classList = { add: name => { this.className += ` ${name}`; } };
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  click() { this.listeners.get('click')?.(); }
}
function withDom(callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new FakeNode(tag) } });
  const restore = () => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document;
  try {
    const result = callback();
    if (result instanceof Promise) return result.finally(restore);
    restore(); return result;
  } catch (error) { restore(); throw error; }
}
function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return undefined;
}
const byClass = name => node => node.className.split(' ').includes(name);
const byData = (name, value) => node => node.attributes?.get(name) === value;
const route = { id: 'fal:h3-i2v', kind: 'video', family: 'MiniMax H3', price: { by_resolution: { '768P': 0.1 } } };
function fixture(options = {}) {
  const instance = new Harness();
  const clip = cutSnapshot({ itemId: options.id ?? 'cut-1', sourcePath: options.sourcePath ?? 'still.png', src: options.sourcePath ?? 'still.png' });
  const values = new Map();
  instance.tabState = new InspectorTabState({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  instance.model = { snapshot: clip };
  instance.body = new FakeNode();
  instance.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: { toString: () => 'file:///fixture' } }] };
  instance.layerAudioService = { readGenerationCatalog: async () => ({ models: [route] }) };
  instance.generationCatalog = options.routes === false ? [] : [route];
  instance.aiStillStates = new Map();
  instance.aiCatalogLoaded = true;
  instance.aiCatalogFailed = false;
  instance.generationStates = new Map([[clip.itemId, options.state ?? 'none']]);
  instance.generationDone = new Map(options.done ? [[clip.itemId, { sourcePath: clip.sourcePath, meta: {} }]] : []);
  instance.generationLoads = new Set([clip.itemId]);
  instance.generationTabMeta = new Map(options.nextPlanned ? [[clip.itemId, { next: { status: 'planned' } }]] : []);
  instance.generationTabLoads = new Set();
  instance.generationTabDrafts = new Map();
  instance.generationDrafts = new Map();
  instance.generationThumbnail = async () => undefined;
  for (const name of ['dispatchCaptionZoneEvent', 'hideFieldNotice', 'syncAdjustCompare', 'appendSoloBanner', 'refreshAdjustLuts']) instance[name] = () => {};
  instance.generationSectionFields = snapshot => instance.generationIdentity(snapshot) ? [{ name: 'model', label: 'モデル' }] : undefined;
  instance.sections = [];
  instance.appendSection = (section, _snapshot, _kind, parent = instance.body) => {
    instance.sections.push(section);
    const node = new FakeNode('section');
    node.setAttribute('data-akari-ui', `section:inspector-${section.id}`);
    const sectionBody = new FakeNode('div');
    node.appendChild(sectionBody);
    parent.appendChild(node);
    return sectionBody;
  };
  instance.explicitTabId = 'edit';
  return instance;
}
const aiTab = root => find(root, byData('data-akari-ui', 'tab:inspector-edit'));
const aiTile = root => find(root, byData('data-akari-inspector-ai-tile', 'video'));
const panel = root => find(root, byData('data-akari-ui', 'section:inspector-generation'));

test('widget: ふつうの動画 cut は編集が押せ、動画タイルは理由付き disabled でクリックしても戻らない', () => withDom(() => {
  const instance = fixture({ sourcePath: 'ordinary.mp4' });
  instance.render();
  assert.equal(aiTab(instance.body).textContent, '編集');
  assert.equal(aiTab(instance.body).disabled, false);
  const tile = aiTile(instance.body);
  assert.match(tile.className, /akari-inspector-ai-disabled/u);
  assert.equal(tile.attributes.get('aria-disabled'), 'true');
  assert.equal(find(tile, byClass('akari-inspector-ai-reason')).textContent, '静止画か空の枠で使えます');
  tile.click();
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
}));

test('widget: 静止画の別案一覧から動画タイル → 専用パネル → ← 編集', () => withDom(() => {
  const instance = fixture();
  instance.render();
  assert.deepEqual(instance.body.children.flatMap(node => node.className === 'akari-inspector-ai-list'
    ? node.children.map(group => group.children[0].textContent) : []), ['別案を生成']);
  assert.equal(find(instance.body, byData('data-akari-inspector-ai-tile', 'transcribe')).attributes.get('aria-disabled'), 'true');
  assert.equal(find(instance.body, byClass('akari-inspector-ai-reason')).textContent, '声の入った音声か動画で使えます');
  aiTile(instance.body).click();
  assert.equal(find(instance.body, byClass('akari-inspector-ai-back')).textContent, '← 編集');
  assert.ok(panel(instance.body));
  find(instance.body, byClass('akari-inspector-ai-back')).click();
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
}));

test('widget: planned の空の枠は一覧で開く', () => withDom(() => {
  const instance = fixture({ state: 'planned' });
  instance.render();
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
}));

test('widget: status done の静止画は一覧で開く', () => withDom(() => {
  const instance = fixture({ state: 'done' });
  instance.render();
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
  assert.equal(find(instance.body, byClass('akari-inspector-ai-back')), undefined);
}));

test('widget: status done の静止画 + next planned は一覧で開く', () => withDom(() => {
  const instance = fixture({ state: 'done', nextPlanned: true });
  instance.render();
  assert.deepEqual(instance.generationTabMeta.get('cut-1'), { next: { status: 'planned' } });
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
  assert.equal(find(instance.body, byClass('akari-inspector-ai-back')), undefined);
}));

for (const [name, options] of [
  ['generating', { state: 'generating' }], ['failed', { state: 'failed' }],
  ['generated video', { state: 'done', done: true, sourcePath: 'generated.mp4' }]
]) {
  test(`widget: ${name} は直接専用パネル`, () => withDom(() => {
    const instance = fixture(options);
    instance.render();
    assert.ok(panel(instance.body));
    assert.equal(aiTile(instance.body), undefined);
  }));
}

test('widget: 同じクリップの再選択はパネルを保ち、別クリップは一覧に戻す', () => withDom(() => {
  const instance = fixture();
  instance.render();
  aiTile(instance.body).click();
  instance.model.snapshot = { ...instance.model.snapshot, outputStart: 1 };
  instance.render();
  assert.ok(panel(instance.body));
  instance.model.snapshot = cutSnapshot({ itemId: 'cut-2', sourcePath: 'other.png', src: 'other.png' });
  instance.generationLoads.add('cut-2');
  instance.generationStates.set('cut-2', 'planned');
  instance.explicitTabId = 'edit';
  instance.render();
  assert.ok(aiTile(instance.body));
  assert.equal(panel(instance.body), undefined);
}));

test('widget: 動画モデル 0 本のふつうの動画は動画タイルなし・文字起こしで編集が押せる', () => withDom(() => {
  const instance = fixture({ sourcePath: 'ordinary.mp4', routes: false });
  instance.render();
  assert.equal(aiTab(instance.body).disabled, false);
  assert.equal(aiTile(instance.body), undefined);
  assert.equal(find(instance.body, byData('data-akari-inspector-ai-tile', 'transcribe')).attributes.get('aria-disabled'), 'false');
}));

test('widget: 動画モデル 0 本の identity は一覧を出し、文字起こしはグレー', () => withDom(() => {
  const instance = fixture({ routes: false });
  instance.render();
  assert.equal(aiTab(instance.body).disabled, false);
  assert.equal(panel(instance.body), undefined);
  assert.equal(aiTile(instance.body), undefined);
  assert.equal(find(instance.body, byData('data-akari-inspector-ai-tile', 'transcribe')).attributes.get('aria-disabled'), 'true');
}));

test('widget: catalog 読込失敗は同じ workspace で 1 回だけ通知する', () => withDom(async () => {
  const instance = fixture({ sourcePath: 'ordinary.mp4', routes: false });
  instance.aiCatalogLoaded = false;
  let reads = 0, notices = 0;
  instance.layerAudioService.readGenerationCatalog = async () => { reads++; throw new Error('catalog unavailable'); };
  instance.showFieldNotice = () => { notices++; };
  instance.render();
  await new Promise(resolve => setImmediate(resolve));
  instance.render();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  assert.equal(notices, 1);
  assert.equal(instance.aiCatalogFailed, true);
}));

test('編集タブは読込中も補正 → 別案 → 素材の選択の順で出る', () => withDom(() => {
  const instance = fixture();
  instance.aiCatalogLoaded = false;
  instance.render();
  assert.deepEqual(instance.body.children.filter(node => node.tag === 'section' || node.className === 'akari-inspector-ai-list')
    .map(node => node.attributes.get('data-akari-ui') ?? node.children[0].attributes.get('data-akari-ui')),
  ['section:inspector-edit-correction', 'section:inspector-edit-alternatives', 'section:inspector-edit-material-choice']);
  assert.ok(find(instance.body, node => node.textContent === '別案を読み込んでいます…'));
}));

test('図形の編集タブも空にならず、別案なしと素材の選択を示す', () => withDom(() => {
  const instance = fixture();
  instance.model.snapshot = { kind: 'item', id: 'shape-1', itemKind: 'item', sourceKind: 'shape',
    outputStart: 0, duration: 5, durationFrames: 150, trackName: '図形', clipName: '四角' };
  instance.loadAiCatalog = async () => {};
  instance.explicitTabId = 'edit';
  instance.render();
  assert.ok(find(instance.body, byData('data-akari-ui', 'section:inspector-edit-material-choice')));
  assert.ok(find(instance.body, node => node.textContent === 'この要素で使える別案はまだありません'));
}));

test('sources の id を持つ写真 item / layer と cut は編集の補正・同じ adjust 節を出す', () => withDom(() => {
  for (const snapshot of [
    cutSnapshot({ itemId: 'cut-1', sourcePath: 'assets/photo.png', src: 's2' }),
    { kind: 'layer', id: 'layer-1', layerKind: 'baked', sourceKind: 'media', src: 's2',
      sourcePath: 'assets/photo.png', outputStart: 0, duration: 5, durationFrames: 150 },
    { kind: 'item', id: 'item-1', itemKind: 'media', sourceKind: 'media', src: 's2',
      sourcePath: 'assets/photo.png', outputStart: 0, duration: 5, durationFrames: 150 }
  ]) {
    const instance = fixture();
    instance.model.snapshot = snapshot;
    instance.generationIdentity = () => undefined;
    instance.loadAiCatalog = async () => {};
    instance.explicitTabId = 'edit';
    instance.render();
    assert.ok(find(instance.body, byData('data-akari-ui', 'section:inspector-edit-correction')), snapshot.kind);
    assert.ok(find(instance.body, byData('data-akari-ui', 'section:inspector-adjust:basic')), snapshot.kind);
    const scope = instance.sections.find(section => section.id === 'edit-correction').fields
      .find(field => field.name === 'edit-adjust-scope');
    assert.deepEqual(scope.options, ['画像全体', '選択エリア']);
  }
}));

test('高画質化と背景生成は別案を生成の中に入り、別の見出しを作らない', () => withDom(() => {
  const instance = fixture();
  instance.model.snapshot = { kind: 'item', id: 'photo-1', itemKind: 'media', sourceKind: 'media',
    src: 's2', sourcePath: 'assets/photo.png', outputStart: 0, duration: 5, durationFrames: 150 };
  instance.generationIdentity = () => undefined;
  instance.loadAiCatalog = async () => {};
  instance.imageAiPanels = new Map();
  instance.explicitTabId = 'edit';
  instance.render();
  const alternatives = find(instance.body, byData('data-akari-ui', 'section:inspector-edit-alternatives'));
  assert.ok(alternatives);
  assert.ok(find(alternatives, byData('data-akari-image-ai-panel', 'photo-1')));
  assert.equal(find(instance.body, node => node.textContent === '写真を直す'), undefined);
  assert.ok(find(alternatives, node => node.textContent === '高画質化'));
  assert.ok(find(alternatives, node => node.textContent === '背景生成（近日）'));
}));
