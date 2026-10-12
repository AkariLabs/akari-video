import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(process.env.AKARI_ANNOTATIONS_SOURCE
  || new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');

function method(name, next, events) {
  const start = source.indexOf(`    ${name}(`);
  const end = source.indexOf(`    ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(`class Harness { ${source.slice(start, end)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function('window', 'CustomEvent', 'captionIdForTreeSelection',
    'TIMELINE_OVERLAY_SELECTED_EVENT', 'TIMELINE_LAYER_SELECTED_EVENT',
    `${compiled}; return new Harness();`)(
    { dispatchEvent: event => events.push(event) },
    class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    (item, declaredId) => item.itemKind === 'caption' ? declaredId ?? item.id.split('#').at(-1) : undefined,
    'akari.timeline.overlaySelected', 'akari.timeline.layerSelected'
  );
}

test('preview click on a selected member publishes all caption IDs with clicked primary', () => {
  const events = [];
  const widget = method('handleCaptionSelection', 'protected revealPreviewSelection', events);
  Object.assign(widget, {
    captions: ['a', 'b', 'c'].map(id => ({ id })),
    multiSelection: ['a', 'b', 'c'].map(id => ({ kind: 'caption', id })),
    selection: undefined, selectionModel: { selectedCaptionIds: ['a', 'b', 'c'] },
    canHandlePlaybackTick: () => true, selectionRenderKeys: () => [],
    applySelection() { throw new Error('caption group was replaced'); },
    revealPreviewSelection() {}, location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.handleCaptionSelection('/edit.json', 'b');
  assert.deepEqual(widget.multiSelection.map(item => item.id), ['a', 'b', 'c']);
  assert.deepEqual(events.at(-1).detail,
    { editUri: '/edit.json', captionIds: ['a', 'b', 'c'], primaryCaptionId: 'b' });
});

test('transcript group passes its anchor to the preview as primary', () => {
  const events = [];
  const widget = method('selectCaptions', 'protected previewSelectionAncestorIds', events);
  Object.assign(widget, {
    canHandlePlaybackTick: () => true, captions: ['a', 'b', 'c'].map(id => ({ id })),
    multiSelection: [], selectionModel: {}, selection: undefined,
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } },
    claimInspectorOwner() {}, pushSelectionSnapshot() {}, applySelectionClass() {}, applyCaptionStateClasses() {}
  });
  widget.selectCaptions('/edit.json', ['a', 'b', 'c'], 'b');
  assert.deepEqual(events.at(-1).detail,
    { editUri: '/edit.json', captionIds: ['a', 'b', 'c'], primaryCaptionId: 'b' });
});

test('transcript-origin selection retains its origin through the timeline notification', () => {
  const events = [];
  const widget = method('selectCaptions', 'protected previewSelectionAncestorIds', events);
  Object.assign(widget, {
    canHandlePlaybackTick: () => true, captions: [{ id: 'a' }, { id: 'b' }],
    multiSelection: [], selectionModel: {}, selection: undefined,
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } },
    claimInspectorOwner() {}, pushSelectionSnapshot() {}, applySelectionClass() {}, applyCaptionStateClasses() {}
  });
  widget.selectCaptions('/edit.json', ['a', 'b'], 'a', 'daihon');
  assert.deepEqual(events.at(-1).detail,
    { editUri: '/edit.json', captionIds: ['a', 'b'], primaryCaptionId: 'a', origin: 'daihon' });
});

test('the regular timeline path clears the transcript projection for a mixed group', () => {
  const events = [];
  const widget = method('protected publishPrimaryPreviewSelection', 'protected shouldToggleMultiSelection', events);
  Object.assign(widget, {
    multiSelection: [{ kind: 'caption', id: 'a' }, { kind: 'item', id: 'clip-1', itemKind: 'media' }],
    selectionModel: {}, layers: [], cutItemIds: [], rawKeyframeItem: () => undefined,
    applyCaptionStateClasses() {},
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.publishPrimaryPreviewSelection({ kind: 'caption', id: 'a' });
  assert.deepEqual(events.find(event => event.type === 'akari.timeline.captionSelectionChanged').detail,
    { editUri: '/edit.json', captionIds: [], primaryCaptionId: null });
});

test('preview click in a mixed clip and caption group sends no caption selection notification', () => {
  const events = [];
  const widget = method('handleCaptionSelection', 'protected revealPreviewSelection', events);
  Object.assign(widget, {
    captions: [{ id: 'a' }],
    multiSelection: [{ kind: 'caption', id: 'a' }, { kind: 'item', id: 'clip-1' }],
    selection: undefined, selectionModel: { selectedCaptionIds: ['a'] },
    canHandlePlaybackTick: () => true, selectionRenderKeys: () => [],
    rawKeyframeItem: () => undefined,
    applySelection() { throw new Error('mixed group was replaced'); },
    revealPreviewSelection() {},
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.handleCaptionSelection('/edit.json', 'a');
  assert.deepEqual(widget.multiSelection, [{ kind: 'caption', id: 'a' }, { kind: 'item', id: 'clip-1' }]);
  assert.deepEqual(events, []);
});

test('preview click recognizes a caption tree item in a mixed group without clearing selection', () => {
  const events = [];
  const widget = method('handleCaptionSelection', 'protected revealPreviewSelection', events);
  Object.assign(widget, {
    captions: [{ id: 'a' }],
    multiSelection: [{ kind: 'item', id: 'caption-item', itemKind: 'caption' },
      { kind: 'item', id: 'clip-1', itemKind: 'media' }],
    selection: undefined, selectionModel: { selectedCaptionIds: [] },
    canHandlePlaybackTick: () => true, selectionRenderKeys: () => [],
    rawKeyframeItem: id => id === 'caption-item' ? { source: { kind: 'caption', id: 'a' } } : undefined,
    applySelection() { throw new Error('mixed group was replaced'); },
    revealPreviewSelection() {},
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.handleCaptionSelection('/edit.json', 'a');
  assert.equal(widget.multiSelection.length, 2);
  assert.deepEqual(events, []);
});

test('フォーカス中の字幕 item はプレビューから同じ字幕が返っても選択を保つ', () => {
  const events = [];
  const widget = method('handleCaptionSelection', 'protected revealPreviewSelection', events);
  Object.assign(widget, {
    captions: [{ id: 'a' }], multiSelection: [],
    selection: { kind: 'item', id: 'caption-item', itemKind: 'caption' },
    selectionModel: { selectedCaptionIds: ['a'] },
    focusScope: { rootId: 'caption-item' },
    canHandlePlaybackTick: () => true,
    rawKeyframeItem: () => ({ source: { kind: 'caption', id: 'a' } }),
    applySelection() { throw new Error('字幕 item の選択が外れた'); },
    revealPreviewSelection() {},
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.handleCaptionSelection('/edit.json', 'a');
  assert.equal(widget.selection.id, 'caption-item');
});

test('キーフレームの画面の外では、同じ字幕の item 選択からプレビューの字幕選択へ切り替える（文字の帯を出す）', () => {
  const events = [];
  const widget = method('handleCaptionSelection', 'protected revealPreviewSelection', events);
  const applied = [];
  Object.assign(widget, {
    captions: [{ id: 'a' }], multiSelection: [],
    selection: { kind: 'item', id: 'caption-item', itemKind: 'caption' },
    selectionModel: { selectedCaptionIds: [] },
    focusScope: { rootId: null },
    canHandlePlaybackTick: () => true,
    rawKeyframeItem: () => ({ source: { kind: 'caption', id: 'a' } }),
    applySelection(selection) { applied.push(selection); this.selection = selection; },
    applyCaptionStateClasses() {},
    revealPreviewSelection() {},
    location: { editUri: { normalizePath() { return this; }, toString: () => '/edit.json' } }
  });
  widget.handleCaptionSelection('/edit.json', 'a');
  assert.deepEqual(applied, [{ kind: 'caption', id: 'a' }]);
  assert.deepEqual(widget.selectionModel.selectedCaptionIds, ['a']);
});
