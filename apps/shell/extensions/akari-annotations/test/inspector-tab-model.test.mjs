import { createSelectionHeader } from '../lib/browser/inspector/selection-header.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_ADJUST_SECTIONS,
  assignSectionToTab,
  COMING_SOON_ADJUST_SECTIONS,
  InspectorTabState,
  tabsForKind
} from '../lib/browser/inspector/tab-model.js';

const tabShape = tabs => tabs.map(({ label, enabled }) => [label, enabled]);

test('選択 kind ごとに正しいタブ語彙と enabled 状態を返す', () => {
  assert.deepEqual(tabShape(tabsForKind('cut')), [
    ['映像', true], ['色', true], ['音声', true], ['編集', true], ['動き', true], ['情報', true]
  ]);
  for (const kind of ['layer', 'overlay', 'item']) {
    assert.deepEqual(tabShape(tabsForKind(kind, {})), [
      ['映像', true], ['色', false], ['音声', false], ['編集', true], ['動き', true], ['情報', true]
    ], `${kind}: src なし`);
    assert.deepEqual(tabShape(tabsForKind(kind, { src: 'assets/source.mp4' })), [
      ['映像', true], ['色', true], ['音声', true], ['編集', true], ['動き', true], ['情報', true]
    ], `${kind}: src あり`);
  }
  assert.deepEqual(tabShape(tabsForKind('caption')), [
    ['テキスト', true], ['動き', true], ['情報', true]
  ]);
  assert.deepEqual(tabShape(tabsForKind('audio')), [
    ['音声', true], ['編集', true], ['情報', true]
  ]);
  assert.deepEqual(tabShape(tabsForKind('world')), [['地図', true], ['情報', true]]);
});

test('既存セクションを kind に応じたタブへ振り分ける', () => {
  assert.equal(assignSectionToTab('cut', 'time'), 'video');
  assert.equal(assignSectionToTab('cut', 'transform'), 'video');
  assert.equal(assignSectionToTab('cut', 'info'), 'info');
  assert.equal(assignSectionToTab('caption', 'content'), 'text');
  assert.equal(assignSectionToTab('caption', 'style'), 'text');
  assert.equal(assignSectionToTab('caption', 'timing'), 'text');
  assert.equal(assignSectionToTab('audio', 'time'), 'audio');
  assert.equal(assignSectionToTab('audio', 'audio:fades'), 'audio');
  assert.equal(assignSectionToTab('world', 'location'), 'world');
  assert.equal(assignSectionToTab('cut', 'adjust:basic'), 'adjust');
  assert.equal(assignSectionToTab('item', 'adjust:lut'), 'adjust');
  assert.equal(assignSectionToTab('item', 'edit-photo'), 'edit');
  assert.equal(assignSectionToTab('caption', 'animator'), 'motion');
});

test('アクティブタブは kind ごとに永続し disabled 保存値をフォールバックする', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const state = new InspectorTabState(storage);
  const cutTabs = tabsForKind('cut');
  const layerTabs = tabsForKind('layer');

  assert.equal(state.activeTab('cut', cutTabs), 'video');
  state.setActiveTab('cut', 'adjust');
  state.setActiveTab('layer', 'info');
  assert.equal(values.get('akari.inspector.tab.v1:cut'), 'adjust');
  assert.equal(state.activeTab('cut', cutTabs), 'adjust');
  assert.equal(state.activeTab('layer', layerTabs), 'info');

  state.setActiveTab('layer', 'adjust');
  assert.equal(state.activeTab('layer', layerTabs), 'video');
  state.setActiveTab('item', 'generation');
  assert.equal(state.activeTab('item', tabsForKind('item')), 'edit');
  state.setActiveTab('caption', 'motion');
  assert.equal(state.activeTab('caption', tabsForKind('caption')), 'motion');
});

test('調整タブは実働 6 件と Coming soon 0 件を裁定どおり分ける', () => {
  assert.deepEqual([...ACTIVE_ADJUST_SECTIONS], ['基本補正', 'RGB カーブ', 'カラーホイール', 'Hue カーブ', 'LUT', 'エフェクト']);
  assert.deepEqual([...COMING_SOON_ADJUST_SECTIONS], []);
  assert.equal(assignSectionToTab('item', 'adjust:fx'), 'adjust');
});

// Execute the real render routing/factories with only DOM and service plumbing replaced.
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { selectGenerationSidecarForSource } from '@akari-video/edit-store';
import * as tabModel from '../lib/browser/inspector/tab-model.js';
import * as fx from '../lib/browser/inspector/adjust-fx-fields.js';
import * as adjust from '../lib/browser/inspector/adjust-fields.js';
import * as audioMaster from '../lib/browser/inspector/audio-master.js';
import { INSPECTOR_LOOK_PRESETS, matchLookPreset } from '../lib/browser/inspector/look-presets.js';
import { buildLutOptions } from '../lib/browser/inspector/lut-options.js';
import { AUDIO_PREVIEW_SECTIONS } from '../lib/browser/inspector/audio-preview.js';
import { ADJUST_PREVIEW_SECTIONS } from '../lib/browser/inspector/adjust-preview.js';
import { generationFields } from '../lib/browser/inspector/generation-fields.js';
import { aiActionCatalog, describeAiTiles } from '../lib/common/ai-action-catalog.js';
import { aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles } from '../lib/browser/inspector/ai-tiles.js';
import { isInspectorStillImage } from '../lib/browser/inspector/edit-target.js';
import { cutSections, layerSections, cutSnapshot, visualSnapshot } from './helpers/perspective-transition-fixture.mjs';
const widgetSource = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const widgetAst = ts.createSourceFile('inspector.ts', widgetSource, ts.ScriptTarget.Latest, true);
const widgetClass = widgetAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const method = name => widgetClass.members.find(node => node.name?.getText(widgetAst) === name).getText(widgetAst);
const factory = name => widgetAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(widgetAst);
const dependencies = { createSelectionHeader, selectGenerationSidecarForSource, ...tabModel, ...fx, ...adjust, ...audioMaster, INSPECTOR_LOOK_PRESETS, matchLookPreset, buildLutOptions,
  aiActionCatalog, describeAiTiles, aiTabAvailabilityFor, aiTabViewFor, aiTargetKindFor, appendAiBack, appendAiTiles,
  isInspectorStillImage,
  PHOTO_PANEL_FIELDS: () => [],
  AUDIO_PREVIEW_SECTIONS, ADJUST_PREVIEW_SECTIONS, generationFields,
  CUT_SECTIONS: cutSections, LAYER_SECTIONS: layerSections, layerAudioControls: new WeakMap(), CAPTION_ZONE_HOVER_EVENT: '' };
delete dependencies.default;
delete dependencies['module.exports'];
const renderCode = ts.transpileModule(`${factory('ADJUST_SECTIONS')}\n${factory('AUDIO_MASTER_SECTION')}\nclass RenderHarness {
${method('renderContent').replace('renderContent', 'render')}
${['tabSourceHint', 'generationIdentity', 'generationSectionFields', 'appendTabStrip'].map(method).join('\n')}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const RenderHarness = new Function(...Object.keys(dependencies), `${renderCode}; return RenderHarness;`)(...Object.values(dependencies));
class TabElement {
  children = []; attributes = new Map(); style = {}; listeners = new Map(); className = '';
  classList = { add: value => { this.className += ` ${value}`; } };
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren() { this.children = []; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
}
function withTabDom(callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousGenerationId = Object.getOwnPropertyDescriptor(globalThis, 'GENERATION_SECTION_ID');
  Object.defineProperty(globalThis, 'GENERATION_SECTION_ID', { configurable: true, value: widgetSource.match(/const GENERATION_SECTION_ID = '([^']+)'/u)[1] });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new TabElement() } });
  const restore = () => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
    if (previousGenerationId) Object.defineProperty(globalThis, 'GENERATION_SECTION_ID', previousGenerationId);
    else delete globalThis.GENERATION_SECTION_ID;
  };
  try {
    const result = callback();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) { restore(); throw error; }
}
function renderFixture(kind, Harness = RenderHarness, sourcePath = 'still.png') {
  const snapshot = kind === 'cut' ? cutSnapshot({ src: sourcePath, sourcePath })
    : visualSnapshot('layer', { src: sourcePath, sourcePath });
  const widget = new Harness();
  const values = new Map();
  widget.tabState = new InspectorTabState({ getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
  widget.model = { snapshot, audioMaster: { enabled: false, denoise: 'off' } };
  widget.body = new TabElement();
  widget.generationThumbnail = async () => undefined;
  widget.projectLutRefs = [];
  widget.workspaceService = { tryGetRoots: () => [] };
  widget.generationTabMeta = new Map();
  widget.generationTabLoads = new Set();
  const key = widget.generationIdentity(snapshot)?.key;
  widget.generationLoads = new Set(key ? [key] : []);
  widget.generationStates = new Map(key ? [[key, 'planned']] : []);
  const model = JSON.parse(readFileSync(new URL('../../../../../packages/schemas/gen-models.json', import.meta.url), 'utf8'))
    .models.find(row => row.id === 'fal:h3-i2v');
  widget.generationCatalog = [model];
  widget.aiCatalogLoaded = true;
  widget.generationDrafts = new Map(key ? [[key, { modelId: model.id, inputs: { prompt: '', first_frame: { path: sourcePath } },
    output: { duration_s: 5, resolution: '768P', audio_out: true } }]] : []);
  widget.generationTabDrafts = new Map(widget.generationDrafts);
  widget.generationValidations = new Map(key ? [[key, { ok: true, messages: [], cost: { estimate_usd: 0.3 } }]] : []);
  dependencies.layerAudioControls.set(snapshot, { audio: true, gain_db: 0 });
  for (const name of ['dispatchCaptionZoneEvent', 'hideFieldNotice', 'syncAdjustCompare', 'refreshAdjustLuts', 'appendSoloBanner']) widget[name] = () => {};
  widget.sections = [];
  widget.appendSection = section => widget.sections.push([section.id, section.fields.length]);
  widget.appendAdjustPreviewSection = (section, _kind, prefix = 'adjust') =>
    widget.sections.push([`${prefix}-${section.id}`, section.build().children.length]);
  return widget;
}
function measureAllTabs(kind) {
  return withTabDom(() => {
    const widget = renderFixture(kind);
    const measured = [];
    for (const tab of tabsForKind(kind, { src: 'still.png', generationAvailable: true })) {
      if (!tab.enabled) continue;
      widget.explicitTabId = tab.id;
      widget.tabState.setActiveTab(kind, tab.id);
      widget.sections = [];
      widget.render();
      measured.push(...widget.sections);
    }
    const baselineIds = new Set(BASELINE_SECTION_FIELDS[kind].map(([id]) => id));
    return [...new Map(measured.filter(([id]) => baselineIds.has(id)).map(entry => [entry[0], entry])).values()]
      .sort(([a], [b]) => a.localeCompare(b));
  });
}
// Fixed section expectations for the still-image fixture, including photo crop and frame.
const BASELINE_SECTION_FIELDS = {
  cut: [
    ['adjust:basic', 11], ['adjust:curves', 0], ['adjust:fx', 1], ['adjust:hue', 0],
    ['adjust:lut', 3], ['adjust:wheels', 0], ['appearance', 1], ['audio', 2],
    ['audio-av-link', 3], ['audio-ducking', 2], ['audio-enhancement', 2], ['audio-fades', 2],
    ['audio-pitch-time', 2], ['audio-volume', 2], ['audio:master', 4], ['framing', 5],
    ['freeze', 2], ['info', 3], ['time', 4], ['timing', 1], ['transform', 4]
  ],
  layer: [
    ['adjust:basic', 11], ['adjust:curves', 0], ['adjust:fx', 1], ['adjust:hue', 0],
    ['adjust:lut', 3], ['adjust:wheels', 0], ['appearance', 5], ['audio', 2],
    ['audio-av-link', 3], ['audio-ducking', 2], ['audio-enhancement', 2], ['audio-fades', 2],
    ['audio-pitch-time', 2], ['audio-volume', 2], ['audio:master', 4], ['crop', 4],
    ['info', 5], ['motion:draw', 1], ['motion:in', 4], ['motion:loop', 4],
    ['motion:out', 4], ['perspective', 9], ['time', 2], ['transform', 4]
  ]
};
for (const kind of ['cut', 'layer']) {
  test(`${kind}: 全タブの節 id 集合・各節の欄数は変更前 fixture と一致する`, () => {
    assert.deepEqual(measureAllTabs(kind), BASELINE_SECTION_FIELDS[kind]);
  });
}

const ADJUST_SECTION_IDS = ['adjust:basic', 'adjust:curves', 'adjust:wheels', 'adjust:hue', 'adjust:lut', 'adjust:fx'];
for (const [label, sourcePath, editAdjustIds] of [
  ['写真', 'still.png', ADJUST_SECTION_IDS],
  ['動画', 'clip.mp4', []]
]) {
  test(`${label}の layer: 編集の補正と色タブの adjust 節を対象どおりに出す`, () => withTabDom(() => {
    const widget = renderFixture('layer', RenderHarness, sourcePath);
    assert.equal(isInspectorStillImage(widget.model.snapshot.sourcePath), label === '写真');
    widget.explicitTabId = 'edit';
    widget.render();
    assert.ok(widget.sections.some(([id]) => id === 'edit-correction'));
    assert.deepEqual(widget.sections.filter(([id]) => id.startsWith('adjust:')).map(([id]) => id), editAdjustIds);
    widget.sections = [];
    widget.explicitTabId = 'adjust';
    widget.render();
    assert.deepEqual(widget.sections.filter(([id]) => id.startsWith('adjust:')).map(([id]) => id), ADJUST_SECTION_IDS);
  }));
}

const INITIAL_TAB_CASES = [
  ['空の枠', { generationTodo: true }, 'edit'],
  ['動画予定', { generationTodo: true }, 'edit'],
  ['生成中', { generationTodo: true }, 'edit'],
  ['応答なし', { generationTodo: true }, 'edit'],
  ['失敗', { generationTodo: true }, 'edit'],
  ['画像のまま', {}, 'video'],
  ['生成済み動画', { generationAvailable: false }, 'video'],
  ['保存 adjust + 画像のまま', { persisted: 'adjust' }, 'adjust'],
  ['旧保存値 generation', { persisted: 'generation' }, 'edit'],
  ['旧保存値 generation・生成なし', { persisted: 'generation', generationAvailable: false }, 'edit'],
  ['別クリップでも保存した色タブ', { persisted: 'adjust', previousClipKey: 'other', currentTab: 'generation' }, 'adjust'],
  ['別クリップで生成なし', { persisted: 'adjust', previousClipKey: 'other', currentTab: 'generation', generationAvailable: false }, 'adjust'],
  ['同じクリップ再描画', { generationTodo: true, previousClipKey: 'clip', currentTab: 'adjust' }, 'adjust'],
  ['同じクリップ完了後', { previousClipKey: 'clip', currentTab: 'generation' }, 'edit'],
  ['別クリップでも保存した色タブ', { generationTodo: true, persisted: 'adjust', previousClipKey: 'other', currentTab: 'info' }, 'adjust']
];
for (const kind of ['cut', 'layer']) {
  for (const [label, options, expected] of INITIAL_TAB_CASES) {
    test(`initialTabFor: ${kind} / ${label}`, () => {
      const tabs = tabsForKind(kind, { src: 'still.png', generationAvailable: options.generationAvailable !== false });
      const input = { kind, tabs, clipKey: 'clip', generationTodo: false, ...options };
      assert.equal(tabModel.initialTabFor(input), expected);
      // Every valid explicit command wins, including a saved/current generation tab without work.
      for (const tab of tabs.filter(tab => tab.enabled)) {
        assert.equal(tabModel.initialTabFor({ ...input, explicitTabId: tab.id }), tab.id, `explicit ${tab.id}`);
      }
    });
  }
}

test('caption / audio / world: id・ラベル・disabled title の語彙を固定する', () => withTabDom(() => {
  const vocabulary = {
    caption: [['text', 'テキスト', true, ''], ['motion', '動き', true, ''], ['info', '情報', true, '']],
    audio: [['audio', '音声', true, ''], ['edit', '編集', true, ''], ['info', '情報', true, '']],
    world: [['world', '地図', true, ''], ['info', '情報', true, '']]
  };
  for (const [kind, expected] of Object.entries(vocabulary)) {
    const widget = renderFixture('cut');
    const tabs = tabsForKind(kind, { generationAvailable: true });
    widget.appendTabStrip(kind, tabs, tabs[0].id, true);
    assert.deepEqual(widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.map(button => [
      button.attributes.get('data-akari-ui').replace('tab:inspector-', ''), button.textContent, !button.disabled, button.title ?? ''
    ]), expected);
    widget.body.replaceChildren();
    widget.appendTabStrip(kind, tabs.map(tab => ({ ...tab, enabled: false })), '');
    assert.deepEqual(widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.map(button => button.title),
      kind === 'audio' || kind === 'caption' ? ['近日', '近日', '近日'] : ['近日', '近日']);
  }
}));

test('generation: 節割付・enabled・disabled title・やること印の DOM 契約', () => withTabDom(() => {
  for (const kind of ['cut', 'layer']) {
    const widget = renderFixture(kind);
    const key = widget.generationIdentity(widget.model.snapshot).key;
    for (const state of ['planned', 'generating', 'stale', 'failed', 'none', 'done']) {
      widget.sections = [];
      widget.generationStates.set(key, state);
      widget.tabSelectionKey = undefined;
      widget.aiViewClipKey = undefined;
      widget.aiView = undefined;
      widget.render();
      const buttons = widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children;
      const generation = buttons.find(button => button.attributes.get('data-akari-ui') === 'tab:inspector-edit');
      const todo = ['planned', 'generating', 'stale', 'failed'].includes(state);
      assert.equal(generation.disabled, false);
      assert.equal(generation.attributes.get('aria-selected'), String(todo));
      assert.deepEqual(generation.children.map(child => child.attributes.get('data-akari-generation-todo')), todo ? ['true'] : []);
      const generatedPanel = ['generating', 'stale', 'failed'].includes(state);
      assert.equal(widget.sections.some(([id, count]) => id === 'generation' && count === 10), generatedPanel);
    }
    widget.generationTabMeta.set(key, { next: { status: 'planned' } });
    widget.tabSelectionKey = undefined;
    widget.render();
    assert.equal(widget.currentTab, 'edit', 'next planned overrides a done still');
    widget.generationTabMeta.clear();
    widget.explicitTabId = 'adjust';
    widget.render();
    widget.generationStates.set(key, 'failed');
    widget.model.snapshot = { ...widget.model.snapshot, outputStart: 10 };
    widget.render();
    assert.equal(widget.currentTab, 'adjust', 'same item after snapshot/time changes');
    if (kind === 'cut') widget.model.snapshot.sourcePath = 'done.mp4';
    else widget.model.snapshot.src = 'done.mp4';
    widget.render();
    assert.equal(widget.currentTab, 'adjust', 'same item after source replacement');
    const generation = widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.find(button => button.textContent === '編集');
    assert.equal(generation.disabled, false);
    assert.equal(generation.children.length, 0);
  }
  for (const kind of ['cut', 'layer', 'item', 'overlay']) {
    assert.equal(assignSectionToTab(kind, 'generation'), 'edit');
    assert.equal(assignSectionToTab(kind, 'audio'), 'video', 'embedded audio stays in video');
  }
}));

test('generation enabled は既存 generationIdentity の静止画 cut / media layer と一致する', () => withTabDom(() => {
  const widget = renderFixture('cut');
  for (const snapshot of [
    cutSnapshot({ itemId: undefined, sourcePath: 'still.png' }), cutSnapshot({ sourcePath: 'video.mp4' }),
    visualSnapshot('layer', { sourceKind: 'html', src: 'still.png' }),
    { kind: 'item', id: 'item', src: 'still.png' }, { kind: 'overlay', id: 'overlay', payload: { src: 'still.png' } }
  ]) {
    const available = !!widget.generationIdentity(snapshot);
    assert.equal(available, false);
    assert.equal(tabsForKind(snapshot.kind, { src: 'still.png', generationAvailable: available }).find(tab => tab.id === 'edit').enabled, true);
  }
}));

test('非同期 next 読込後に初期タブを確定し、手動選択・同一クリップ再描画を保持する', () => withTabDom(async () => {
  for (const explicit of [undefined, 'adjust']) {
    const widget = renderFixture('cut');
    const key = widget.generationIdentity(widget.model.snapshot).key;
    widget.generationStates.set(key, 'done');
    widget.generationTabDrafts.clear();
    widget.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
    let finish;
    widget.layerAudioService = { readGenerationSidecars: () => new Promise(resolve => { finish = resolve; }) };
    widget.showFieldNotice = message => assert.fail(message);
    widget.render();
    assert.equal(widget.tabSelectionKey, undefined, 'do not lock the default while metadata is pending');
    if (explicit) {
      const button = widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.find(button => button.attributes.get('data-akari-ui') === `tab:inspector-${explicit}`);
      button.listeners.get('click')();
    }
    await new Promise(resolve => setImmediate(resolve));
    finish({ entries: [{ sourcePath: 'still.png', meta: { version: 1, kind: 'still', status: 'done', next: { status: 'planned' } } }] });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.currentTab, explicit ?? 'edit');
    assert.equal(widget.generationTabLoads.size, 0);
    // A sidecar reload replaces the draft object. Refresh next, but do not move tabs.
    widget.generationDrafts.set(key, { ...widget.generationDrafts.get(key) });
    widget.layerAudioService.readGenerationSidecars = async () => ({ entries: [] });
    widget.render();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(widget.currentTab, explicit ?? 'edit');
    assert.deepEqual(widget.generationTabMeta.get(key), {});
    const generation = widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.find(button => button.textContent === '編集');
    assert.equal(generation.children.length, 0, 'removing next clears the dot');
  }
}));

test('world / 空選択を経た別クリップに前の explicit tab を持ち越さない', () => withTabDom(() => {
  for (const snapshot of [undefined, { kind: 'world', world: { id: 'world-1', label: '地図' } }, { kind: 'multi', count: 0, items: [] }]) {
    const widget = renderFixture('cut');
    const clip = widget.model.snapshot;
    widget.renderWorldSelection = () => {};
    widget.explicitTabId = 'info';
    widget.model.snapshot = snapshot;
    widget.render();
    assert.equal(widget.explicitTabId, undefined);
    assert.equal(widget.tabSelectionKey, undefined);
    widget.model.snapshot = clip;
    widget.render();
    assert.equal(widget.currentTab, 'edit');
  }
}));


for (const kind of ['cut', 'layer']) {
  for (const planned of [true, false]) {
    test(`${kind}: 選択器が still を返さなくても direct meta の next=${planned ? 'planned' : 'なし'} を読む`, () => withTabDom(async () => {
      // Model the deployed selector that only returns video sidecars. Reading the
      // still's own next must not depend on that selector's return value.
      const Harness = new Function(...Object.keys(dependencies), `${renderCode}; return RenderHarness;`)(
        ...Object.values({ ...dependencies, selectGenerationSidecarForSource: () => undefined })
      );
      const widget = renderFixture(kind, Harness);
      const identity = widget.generationIdentity(widget.model.snapshot);
      widget.generationStates.set(identity.key, 'none');
      widget.generationTabDrafts.clear();
      widget.workspaceService = { ready: Promise.resolve(), tryGetRoots: () => [{ resource: { toString: () => 'file:///project' } }] };
      const meta = { version: 1, kind: 'still', status: 'done',
        ...(planned ? { next: { kind: 'video', status: 'planned', inputs: { prompt: 'Slow camera move' } } } : {}) };
      widget.layerAudioService = { readGenerationSidecars: async () => ({ entries: [
        { sourcePath: 'unrelated.png', meta: { ...meta, next: { status: 'planned' } } },
        { sourcePath: identity.sourcePath, meta }
      ] }) };
      widget.showFieldNotice = message => assert.fail(message);
      widget.render();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(widget.currentTab, planned ? 'edit' : 'video');
      const tab = widget.body.children.find(child => child.className === 'akari-inspector-tab-strip').children.find(button => button.attributes.get('data-akari-ui') === 'tab:inspector-edit');
      assert.equal(tab.attributes.get('aria-selected'), String(planned));
      assert.equal(tab.children.some(child => child.attributes.get('data-akari-generation-todo') === 'true'), planned);
    }));
  }
}
