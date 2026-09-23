import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { AKARI_MATERIAL_SELECTED_EVENT, materialSelectionFromDetail } from '../lib/common/material-selected-event.js';
import { appendAiMaterialView } from '../lib/browser/inspector/ai-material-view.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.className = ''; this.textContent = ''; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  click() { this.listeners.get('click')?.(); }
}
const find = (node, match) => match(node) ? node : node.children.map(child => find(child, match)).find(Boolean);
const all = (node, match) => [...(match(node) ? [node] : []), ...node.children.flatMap(child => all(child, match))];
const byText = text => node => node.textContent === text;
const byData = (name, value) => node => node.attributes.get(name) === value;
async function withDom(run) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Node(tag) } });
  try { await run(); } finally { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; }
}
const detail = (kind, path) => ({ projectRoot: 'file:///fixture', relativePath: path, kind, name: path.split('/').pop() });
const summary = { state: 'done', segments: [{ start: 0, end: 1, text: '冒頭の発話' }], total: 1 };

test('イベント detail を素材の対象に変換する', () => {
  assert.equal(AKARI_MATERIAL_SELECTED_EVENT, 'akari.material.selected');
  assert.deepEqual(materialSelectionFromDetail(detail('audio', 'assets/interview.wav')), {
    kind: 'material', projectRoot: 'file:///fixture', relativePath: 'assets/interview.wav',
    mediaKind: 'audio', name: 'interview.wav'
  });
  assert.equal(materialSelectionFromDetail({ ...detail('audio', 'x'), kind: 'invalid' }), undefined);
});

for (const kind of ['audio', 'video']) {
  test(`${kind} 素材に押せる文字起こしが出る`, () => withDom(() => {
    const groups = describeAiTiles(aiActionCatalog([]), `material-${kind}`);
    assert.deepEqual(groups.flatMap(group => group.tiles.map(tile => [tile.label, tile.enabled])), [['文字起こし', true]]);
    const root = new Node('div');
    let view;
    const selection = materialSelectionFromDetail(detail(kind, kind === 'audio' ? 'assets/interview.wav' : 'assets/ordinary.mp4'));
    appendAiMaterialView(root, { selection, tab: 'generation', view: 'tiles', summary, running: false,
      commands: { executeCommand: async () => 'opened' }, onTab: () => {}, onView: value => { view = value; }, onDialogResult: () => {} });
    assert.equal(find(root, byData('data-akari-inspector-ai-tab', 'generation')).attributes.get('aria-selected'), 'true');
    assert.ok(find(root, byData('data-akari-inspector-ai-tab', 'info')));
    const tile = find(root, byData('data-akari-inspector-ai-tile', 'transcribe'));
    assert.equal(tile.attributes.get('aria-disabled'), 'false');
    assert.ok(find(tile, byText('済み')));
    tile.click();
    assert.equal(view, 'transcribe');
    const panel = new Node('div');
    appendAiMaterialView(panel, { selection, tab: 'generation', view, summary, running: false,
      commands: { executeCommand: async () => 'opened' }, onTab: () => {}, onView: () => {}, onDialogResult: () => {} });
    assert.ok(find(panel, byText('冒頭の発話')));
    assert.ok(find(panel, byText('台本で開く')));
  }));
}

test('画像素材はタイル 0 枚で案内 1 行、情報タブにパスと種類', () => withDom(() => {
  const selection = materialSelectionFromDetail(detail('image', 'assets/still.png'));
  assert.deepEqual(describeAiTiles(aiActionCatalog([]), 'material-image'), []);
  const root = new Node('div');
  let selectedTab;
  const options = { selection, tab: 'generation', view: 'tiles', summary: { state: 'none', segments: [], total: 0 },
    running: false, commands: { executeCommand: async () => 'opened' }, onTab: value => { selectedTab = value; },
    onView: () => {}, onDialogResult: () => {} };
  appendAiMaterialView(root, options);
  assert.equal(all(root, byData('data-akari-inspector-ai-tile', 'transcribe')).length, 0);
  assert.equal(all(root, byText('この素材で使える AI はまだありません')).length, 1);
  find(root, byData('data-akari-inspector-ai-tab', 'info')).click();
  assert.equal(selectedTab, 'info');
  const info = new Node('div');
  appendAiMaterialView(info, { ...options, tab: 'info' });
  assert.ok(find(info, byText('パス: assets/still.png')));
  assert.ok(find(info, byText('種類: 画像の素材')));
}));

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(node => node.name?.getText(ast) === name).getText(ast);

test('widget: 素材を選ぶと AI を表示し、タイムライン選択変更で元の表示へ戻る', () => withDom(async () => {
  const init = widget.members.find(node => node.name?.getText(ast) === 'init');
  let onChanged;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'this.model.onChanged') {
      onChanged = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(init);
  assert.ok(onChanged, 'init の TimelineSelectionModel.onChanged を抽出できる');
  // ai-tab-widget.test.mjs と同じく、production の widget メソッドをそのままコンパイルして動かす。
  // init 全体は Theia の BaseWidget/DOM と CSS 登録を含むため、登録する callback の本体だけ抽出する。
  const code = ts.transpileModule(`class Harness {
    ${method('selectMaterial')}
    ${method('render')}
    wireSelection() { this.model.onChanged(${onChanged}); }
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
  const Harness = new Function('CAPTION_ZONE_HOVER_EVENT', 'appendAiMaterialView', 'createSelectionHeader',
    `${code}; return Harness;`)('', appendAiMaterialView, () => new Node('header'));
  const instance = new Harness();
  let changed;
  instance.model = { snapshot: undefined, onChanged: callback => { changed = callback; return { dispose() {} }; } };
  instance.body = new Node('div');
  instance.commandRegistry = { executeCommand: async () => 'opened' };
  instance.layerAudioService = { readTranscriptSummary: async () => summary };
  instance.dispatchCaptionZoneEvent = () => {};
  instance.hideFieldNotice = () => {};
  instance.syncAdjustCompare = () => {};
  instance.clearSoloForSelectionChange = () => {};
  instance.renderGapSelection = () => { const line = new Node('p'); line.textContent = 'タイムラインのすき間'; instance.body.appendChild(line); };
  instance.wireSelection();
  const selection = materialSelectionFromDetail(detail('audio', 'assets/interview.wav'));
  instance.selectMaterial(selection);
  assert.ok(find(instance.body, byText('interview.wav')));
  assert.ok(find(instance.body, byText('音声の素材')));
  const tabs = all(instance.body, node => node.attributes.get('role') === 'tab');
  assert.deepEqual(tabs.map(node => node.textContent), ['AI', '情報']);
  assert.equal(tabs[0].attributes.get('aria-selected'), 'true');
  const tile = find(instance.body, byData('data-akari-inspector-ai-tile', 'transcribe'));
  assert.equal(tile.attributes.get('aria-disabled'), 'false');
  tile.click();
  assert.ok(find(instance.body, node => node.className === 'akari-inspector-ai-transcribe-panel'));
  await new Promise(resolve => setImmediate(resolve));
  instance.model.snapshot = { kind: 'gap' };
  changed();
  assert.equal(instance.materialSelection, undefined);
  assert.equal(find(instance.body, byText('interview.wav')), undefined);
  assert.ok(find(instance.body, byText('タイムラインのすき間')));
}));

test('インスペクターは素材イベントで開き、タイムライン選択で対象を消す', () => {
  assert.match(source, /window\.addEventListener\(AKARI_MATERIAL_SELECTED_EVENT/u);
  assert.match(source, /'akari\.inspector\.open', \{ tabId: 'generation' \}/u);
  assert.match(source, /if \(!widget\) \{[\s\S]*getOrCreateWidget/u);
  assert.match(method('init'), /this\.model\.onChanged\(\(\) => \{\s*this\.clearSoloForSelectionChange\(\);\s*if \(this\.materialSelection\) \{\s*this\.materialSelection = undefined;/u);
  assert.match(method('render'), /if \(this\.materialSelection\) \{[\s\S]*appendAiMaterialView/u);
});

test('タイムラインが無いときも素材イベントからインスペクターを表示する', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const listeners = new Map(), calls = [];
  class CommandRegistry {}
  class WidgetManager {}
  class ApplicationShell {}
  class AkariInspectorWidget { static FACTORY_ID = 'inspector'; }
  const widgetInstance = { id: 'inspector', isAttached: false, selectMaterial: value => calls.push(['select', value]) };
  const services = new Map([
    [CommandRegistry, { executeCommand: async () => undefined }],
    [WidgetManager, { getOrCreateWidget: async id => { calls.push(['create', id]); return widgetInstance; } }],
    [ApplicationShell, { addWidget: (widget, options) => { calls.push(['add', options.area]); widget.isAttached = true; },
      revealWidget: async id => { calls.push(['reveal', id]); } }]
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (name, handler) => listeners.set(name, handler),
    theia: { container: { get: token => services.get(token) } }
  } });
  try {
    const listenerSource = source.slice(source.indexOf('// The inspector command normally attaches a timeline first.'));
    const code = ts.transpileModule(listenerSource, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    new Function('AKARI_MATERIAL_SELECTED_EVENT', 'materialSelectionFromDetail', 'CommandRegistry',
      'WidgetManager', 'ApplicationShell', 'AkariInspectorWidget', code)(
      AKARI_MATERIAL_SELECTED_EVENT, materialSelectionFromDetail, CommandRegistry,
      WidgetManager, ApplicationShell, AkariInspectorWidget
    );
    listeners.get(AKARI_MATERIAL_SELECTED_EVENT)({ detail: detail('image', 'assets/still.png') });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.map(row => row[0]), ['create', 'add', 'reveal', 'select']);
    assert.equal(calls[1][1], 'right');
    assert.equal(calls[3][1].mediaKind, 'image');
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
  }
});
