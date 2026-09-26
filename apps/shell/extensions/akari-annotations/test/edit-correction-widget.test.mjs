import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { cutSnapshot } from './helpers/perspective-transition-fixture.mjs';
import { InspectorTabState, assignSectionToTab, initialTabFor, tabsForKind } from '../lib/browser/inspector/tab-model.js';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles } from '../lib/browser/inspector/ai-tiles.js';
import { editCorrectionVisible } from '../lib/browser/inspector/edit-correction-visibility.js';
import { appendAiStillNotice, stillMismatchNotice } from '../lib/browser/inspector/ai-still-panel.js';
import { isInspectorStillImage } from '../lib/browser/inspector/edit-target.js';

class FakeNode {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.className = ''; this.textContent = ''; this.style = {}; this.isConnected = true;
  }
  classList = { add: name => { this.className += ` ${name}`; } };
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = name => widget.members.find(node => node.name?.getText(ast) === name).getText(ast);
const factory = name => ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(ast);
const dependencies = {
  CAPTION_ZONE_HOVER_EVENT: '', createSelectionHeader: () => new FakeNode('header'),
  CUT_SECTIONS: () => [], LAYER_SECTIONS: () => [], TREE_ITEM_SECTIONS: () => [],
  layerAudioControls: new WeakMap(), tabsForKind, initialTabFor, assignSectionToTab,
  aiActionCatalog, describeAiTiles, aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor,
  appendAiBack, appendAiTiles, appendAiStillNotice, stillMismatchNotice,
  isInspectorStillImage, editCorrectionVisible,
  ADJUST_SECTIONS: () => [{ id: 'adjust:basic', label: '基本補正', fields: [] }]
};
const code = ts.transpileModule(`${factory('PHOTO_PANEL_FIELDS')}\nclass Harness {
${method('renderContent').replace('renderContent', 'render')}
${['tabSourceHint', 'generationIdentity', 'appendTabStrip', 'loadAiCatalog'].map(method).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function(...Object.keys(dependencies), `${code}; return Harness;`)(...Object.values(dependencies));

function fixture({ state = 'none', identity = true, catalogLoaded = true } = {}) {
  const instance = new Harness();
  const clip = cutSnapshot({ itemId: 'cut-1', sourcePath: 'photo.png', src: 'photo.png' });
  const values = new Map();
  instance.tabState = new InspectorTabState({ getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) });
  instance.model = { snapshot: clip };
  instance.body = new FakeNode();
  instance.workspaceService = { ready: Promise.resolve(),
    tryGetRoots: () => [{ resource: { toString: () => 'file:///fixture' } }] };
  instance.generationCatalog = [];
  instance.aiStillStates = new Map();
  instance.aiCatalogLoaded = catalogLoaded;
  instance.generationStates = new Map([[clip.itemId, state]]);
  instance.generationDone = new Map();
  instance.generationLoads = new Set([clip.itemId]);
  instance.generationTabMeta = new Map();
  instance.generationTabLoads = new Set();
  instance.generationTabDrafts = new Map();
  instance.generationDrafts = new Map();
  instance.generationThumbnail = async () => undefined;
  if (!identity) instance.generationIdentity = () => undefined;
  for (const name of ['dispatchCaptionZoneEvent', 'hideFieldNotice', 'syncAdjustCompare',
    'appendSoloBanner', 'refreshAdjustLuts', 'appendStillPanel']) instance[name] = () => {};
  instance.generationSectionFields = () => [];
  instance.sections = [];
  instance.appendSection = (section, _snapshot, _kind, parent = instance.body) => {
    instance.sections.push(section);
    const node = new FakeNode('section');
    node.setAttribute('data-akari-ui', `section:inspector-${section.id}`);
    const body = new FakeNode();
    node.appendChild(body); parent.appendChild(node);
    return body;
  };
  instance.explicitTabId = 'edit';
  return instance;
}

function withDom(callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { createElement: tag => new FakeNode(tag) } });
  try { callback(); } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}

for (const [name, options] of [
  ['空の枠', { state: 'planned' }],
  ['生成中', { state: 'generating' }],
  ['読み込み中の空の枠', { state: 'planned', catalogLoaded: false }],
  ['読み込み中の生成中', { state: 'generating', catalogLoaded: false }]
]) {
  test(`widget: ${name} では補正と素材の選択を描かない`, () => withDom(() => {
    const instance = fixture(options);
    instance.render();
    assert.equal(instance.sections.some(section => section.id === 'edit-correction'), false);
    assert.equal(instance.sections.some(section => section.id === 'edit-material-choice'), false);
  }));
}

test('widget: カタログ読み込み中は aiView と選択キーを更新しない', () => withDom(() => {
  const instance = fixture({ state: 'generating', catalogLoaded: false });
  instance.aiView = 'still';
  instance.aiViewClipKey = 'previous-clip';
  instance.narrationPlacementNotice = { clipKey: 'previous-clip', label: '保留' };
  instance.render();
  assert.equal(instance.aiView, 'still');
  assert.equal(instance.aiViewClipKey, 'previous-clip');
  assert.deepEqual(instance.narrationPlacementNotice, { clipKey: 'previous-clip', label: '保留' });
}));

test('widget: 写真のタイル一覧では補正が先に閉じて出て、専用パネルでは消える', () => withDom(() => {
  const instance = fixture({ identity: false });
  instance.render();
  const correction = instance.sections.find(section => section.id === 'edit-correction');
  assert.equal(correction.collapsedByDefault, true);
  assert.equal(instance.sections.some(section => section.id === 'edit-material-choice'), false);
  assert.equal(instance.body.children.findIndex(node => node.attributes.get('data-akari-ui') === 'section:inspector-edit-correction')
    < instance.body.children.findIndex(node => node.className === 'akari-inspector-ai-list'), true);
  instance.aiView = 'still';
  instance.sections = [];
  instance.render();
  assert.equal(instance.sections.some(section => section.id === 'edit-correction'), false);
  assert.equal(instance.sections.some(section => section.id === 'edit-material-choice'), false);
}));
