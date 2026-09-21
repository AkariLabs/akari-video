import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decorator = () => () => {};
class BaseWidget {}
class DisposableCollection { push() {} dispose() {} }
const stubs = {
  '@theia/core/lib/browser': { BaseWidget, codicon: () => '' },
  '@theia/core/lib/browser/dialogs': { AbstractDialog: class {}, ConfirmDialog: class {}, Dialog: {} },
  '@theia/core/lib/common': {
    DisposableCollection, CommandService: Symbol('CommandService'),
    nls: { localize: (_key, value) => value }
  },
  '@theia/core/lib/common/preferences': {}, '@theia/core/lib/common/quick-pick-service': {},
  '@theia/core/lib/common/uri': { default: class URI {} },
  '@theia/core/shared/inversify': { inject: decorator, injectable: decorator, postConstruct: decorator },
  '@theia/filesystem/lib/browser/file-service': {}, '@theia/workspace/lib/browser/workspace-service': {},
  'akari-annotations/lib/browser/akari-edit-history-service': {},
  'akari-annotations/lib/common/akari-annotations-protocol': {},
  'akari-annotations/lib/common/edit-v2-mutations': {},
  'akari-project/lib/common/akari-project-protocol': {}
};
const original = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  if (request.startsWith('@theia/') || request.startsWith('akari-annotations/')
    || request.startsWith('akari-project/')) return {};
  return original.call(this, request, parent, isMain);
};
let AkariDaihonWidget;
try { ({ AkariDaihonWidget } = require('../lib/browser/daihon/akari-daihon-widget.js')); }
finally { Module._load = original; }

const { buildDaihonRows } = require('../lib/common/daihon-row-model.js');
const { setDaihonHistoryService } = require('../lib/common/captions-button.js');
const spoken = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, text: `発話${i}`, start: i * 4, end: i * 4 + 3, style: null }));
const placed = [
  { id: 'p1', text: '全体', start: 0, end: 31 },
  { id: 'p2', text: '3行', start: 4, end: 15 },
  { id: 'p3', text: '1行', start: 16, end: 19 },
  { id: 'p4', text: '2行', start: 20, end: 27 }
].map(caption => ({ ...caption, style: null, timeDomain: 'output', style_preset: 'KEEP' }));
const uri = name => ({ toString: () => `file:///project/${name}` });
function widget(overrides = {}) {
  return Object.assign(Object.create(AkariDaihonWidget.prototype), {
    rows: buildDaihonRows([...spoken, ...placed], null), sourceCaptions: structuredClone([...spoken, ...placed]),
    captionsUri: uri('captions.json'), rootUri: uri(''), editUri: uri('edit.json'),
    silencesBySourceId: new Map(), segments: [], editSources: [],
    notify() {}, renderPlacedText() {}, renderPlacedEditor() {},
    async reload() {}, ...overrides
  });
}

test('全行テンプレは 8 発話だけを書き換え、古い選択に混じる output id も拒否する', async () => {
  const documents = structuredClone([...spoken, ...placed]);
  const calls = [];
  const instance = widget({ annotationsService: { async setCaptionStylePreset(request) {
    calls.push(request);
    for (const caption of documents) if (request.captionIds.includes(caption.id)) caption.style_preset = request.presetId;
    return { changed: request.captionIds.length };
  } } });
  await instance.applyPreset(instance.rowOrder(), 'subtitle-news', 'ニュース', false);
  assert.deepEqual(calls[0].captionIds, spoken.map(item => item.id));
  assert.deepEqual(documents.filter(item => item.timeDomain === 'output'), placed);
  await instance.applyPreset(['r1', 'p1'], 'subtitle-standard', '標準', true);
  assert.deepEqual(calls[1].captionIds, ['r1']);
  await instance.applyPreset(['p2'], 'subtitle-news', 'ニュース', true);
  assert.equal(calls.length, 2);
});

test('無音提案と行結合の対象に output は入らない', async () => {
  const merged = [];
  const instance = widget({ selection: { selected: ['r1', 'r2'], anchorId: 'r1' },
    async withHistory(_label, operation) { await operation(); },
    annotationsService: { async mergeCaptions(request) { merged.push(request.captionIds); } }
  });
  const gaps = instance.rowGapsForRows(instance.rows);
  assert.equal(gaps.length, 7);
  assert.ok(gaps.every(gap => gap.prevId.startsWith('r') && gap.nextId.startsWith('r')));
  // Keep the test on the real merge planning and RPC path without DOM selection rendering.
  instance.setSelection = () => {};
  await instance.mergeSelectedRows();
  assert.deepEqual(merged, [['r1', 'r2']]);
});

test('表示処理も output の本文や語を読まず発話だけを整形する', () => {
  const read = [];
  const instance = widget({ captionsRoot: [], displayKnobs: { maxLineUnits: 18, lines: 1, wrap: 'multi' },
    captionOverflowUnitsById: new Map(), wordUnitsByRowId: new Map(), captionExtraById: new Map(),
    toDaihonCaption(caption) { read.push(caption.id); return caption; }
  });
  assert.equal(instance.daihonCaptionsForDisplay().length, 8);
  assert.deepEqual(read, spoken.map(item => item.id));
});

test('札の選択は既存の timeline / preview 経路へ同期し、行・語の選択を解く', () => {
  const events = [], commands = [];
  const oldWindow = globalThis.window, oldEvent = globalThis.CustomEvent;
  globalThis.window = { dispatchEvent: event => events.push(event) };
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init.detail; } };
  const editUri = { normalizePath() { return this; }, toString: () => 'file:///project/edit.json' };
  const instance = widget({ editUri, selection: { selected: ['r1'], anchorId: 'r1' },
    wordRanges: [{ row: 'r1', a: 0, b: 1 }], closePop() {}, renderWordSelection() {},
    setSelection(next, sync) { assert.equal(sync, false); this.selection = next; },
    commands: { async executeCommand(...args) { commands.push(args); } }
  });
  try {
    instance.selectPlacedText('p2');
    assert.equal(instance.placedSelection, 'p2');
    assert.deepEqual(instance.selection.selected, []);
    assert.deepEqual(instance.wordRanges, []);
    assert.deepEqual(commands, [['akari.timeline.selectCaptions', { editUri: editUri.toString(), captionIds: ['p2'] }]]);
    assert.deepEqual(events.map(event => [event.type, event.detail]), [
      ['akari.daihon.selectionChanged', { editUri: editUri.toString(), captionIds: ['p2'] }],
      ['akari.preview.captionSelected', { editUri: editUri.toString(), captionId: 'p2' }]
    ]);
    instance.receivePlacedSelection('file:///another/edit.json', 'p3');
    assert.equal(instance.placedSelection, 'p2');
    instance.receivePlacedSelection(editUri.toString(), 'p3');
    assert.equal(instance.placedSelection, 'p3');
    instance.receivePlacedSelection(editUri.toString(), 'r0');
    assert.equal(instance.placedSelection, undefined);
    assert.equal(commands.length, 1, '受信側は選択コマンドを再送しない');
  } finally {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = oldEvent;
  }
});

test('範囲変更/全体/削除は各 1 手で undo・redo。timeDomain を書かない', async () => {
  const entries = [], calls = [];
  let document = JSON.stringify([...spoken, ...placed]);
  const original = document;
  const instance = widget({
    async readText(target) { return target === this.editUri ? '{}' : document; },
    async reload() { this.sourceCaptions = JSON.parse(document); },
    annotationsService: {
      async setCaptionTiming(request) {
        calls.push(request);
        document = JSON.stringify(JSON.parse(document).map(caption => caption.id === request.captionId
          ? { ...caption, start: request.start, end: request.end, edited: request.edited } : caption));
      },
      async removeCaption(request) {
        document = JSON.stringify(JSON.parse(document).filter(caption => caption.id !== request.captionId));
      },
      async writeEditSnapshot(request) { document = request.captionsSource; }
    }
  });
  setDaihonHistoryService({ push: entry => entries.push(entry) });
  try {
    await instance.editPlacedText('p2', 'expand-end', '後ろへ 1 行広げる');
    assert.equal(entries.length, 1);
    assert.equal(calls[0].end, 19);
    assert.equal(Object.hasOwn(calls[0], 'timeDomain'), false);
    assert.equal(instance.placedRanges().find(item => item.captionId === 'p2').last, 4);
    assert.equal(instance.sourceCaptions.find(item => item.id === 'p2').timeDomain, 'output');
    await entries[0].undo();
    assert.equal(document, original);
    await entries[0].redo();
    assert.equal(instance.sourceCaptions.find(item => item.id === 'p2').end, 19);
    await instance.editPlacedText('p2', 'all', '全体');
    assert.equal(entries.length, 2);
    assert.deepEqual([calls[1].start, calls[1].end], [0, 31]);
    await instance.editPlacedText('p2', 'delete', '削除');
    assert.equal(entries.length, 3);
    assert.equal(instance.sourceCaptions.some(item => item.id === 'p2'), false);
    await entries[2].undo();
    assert.equal(instance.sourceCaptions.find(item => item.id === 'p2').end, 31);
    assert.deepEqual(instance.sourceCaptions.filter(item => !item.timeDomain), spoken);
  } finally { setDaihonHistoryService(undefined); }
});
