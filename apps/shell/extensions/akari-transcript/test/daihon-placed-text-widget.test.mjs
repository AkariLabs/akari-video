import assert from 'node:assert/strict';
import test from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const editMutations = require('akari-annotations/lib/common/edit-v2-mutations');
const decorator = () => () => {};
class BaseWidget {}
class DisposableCollection { push() {} dispose() {} }
const stubs = {
  '@theia/core/lib/browser': { BaseWidget, codicon: () => '', open: (opener, uri, options) => opener.open(uri, options) },
  '@theia/core/lib/browser/dialogs': { AbstractDialog: class {}, ConfirmDialog: class {}, Dialog: {} },
  '@theia/core/lib/common': {
    DisposableCollection, CommandService: Symbol('CommandService'),
    nls: { localize: (_key, value) => value }
  },
  '@theia/core/lib/common/preferences': { PreferenceScope: { User: 0 } }, '@theia/core/lib/common/quick-pick-service': {},
  '@theia/core/lib/common/uri': { default: class URI {} },
  '@theia/core/shared/inversify': { inject: decorator, injectable: decorator, postConstruct: decorator },
  '@theia/filesystem/lib/browser/file-service': {}, '@theia/workspace/lib/browser/workspace-service': {},
  'akari-annotations/lib/browser/akari-edit-history-service': {},
  'akari-annotations/lib/common/akari-annotations-protocol': {},
  'akari-annotations/lib/common/edit-v2-mutations': editMutations,
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

test('範囲カードは行リストの後ろ・footer の前に置き、下から表示する', () => {
  const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  assert.match(source, /this\.node\.append\(header, this\.rowsNode, this\.selectionBar, this\.placedEditor, this\.footer\)/);
  assert.match(source, /\.akari-daihon-placed-editor \{[^}]*animation:akari-daihon-placed-enter 180ms/);
  assert.match(source, /@keyframes akari-daihon-placed-enter \{ from \{ transform:translateY\(100%\)/);
  assert.match(source, /prefers-reduced-motion: reduce[^\n]*\.akari-daihon-placed-editor \{ animation:none/);
});

test('札の右クリックメニューは数字の操作を持たず、カードと同じ語を使う', () => {
  const oldDocument = globalThis.document, oldCss = globalThis.CSS;
  globalThis.CSS = { escape: value => value };
  globalThis.document = { createElement: () => ({ dataset: {}, classList: { add() {} },
    addEventListener(type, listener) { this[`on${type}`] = listener; } }) };
  const pop = { children: [], classList: { add() {} }, appendChild(node) { this.children.push(node); } };
  const actions = [];
  const instance = widget({ placedSelection: 'p2', rowsNode: { querySelector: () => ({}) },
    openPop: () => pop, closePop() {}, startPlacedEdit(id) { actions.push(['text', id]); },
    editPlacedText(id, action) { actions.push([action, id]); }
  });
  try {
    instance.openPlacedMenu('p2');
    assert.deepEqual(pop.children.map(button => button.textContent), ['全部の行に', '文字を編集', '削除']);
    pop.children[0].onclick({ stopPropagation() {} });
    pop.children[1].onclick({ stopPropagation() {} });
    assert.deepEqual(actions, [['all', 'p2'], ['text', 'p2']]);
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldCss === undefined) delete globalThis.CSS; else globalThis.CSS = oldCss;
  }
});

test('札のインライン編集は Enter で確定、Esc で取消し、空文字は保存しない', async () => {
  const oldDocument = globalThis.document, oldCss = globalThis.CSS;
  globalThis.CSS = { escape: value => value };
  const created = [];
  globalThis.document = { createElement: tag => {
    const node = { tag, listeners: {}, setAttribute() {}, appendChild(child) { this.child = child; },
      addEventListener(type, listener) { this.listeners[type] = listener; }, focus() {}, select() {},
      blur() { this.listeners.blur?.(); }, replaceWith(next) { this.replacement = next; } };
    created.push(node);
    return node;
  } };
  const tag = { replaceWith(next) { this.replacement = next; } };
  const calls = [], histories = [], notices = [];
  const instance = widget({ placedSelection: 'p2', rowsNode: { querySelector: () => tag },
    closePop() {}, renderPlacedText() {}, notify: message => notices.push(message),
    async withHistory(label, operation) { histories.push(label); await operation(); },
    annotationsService: { async setCaptionFields(request) { calls.push(request); } }
  });
  try {
    instance.startPlacedEdit('p2');
    const input = instance.placedEditing.input;
    assert.equal(tag.replacement.className, 'akari-daihon-row-edit akari-daihon-placed-inline-edit');
    assert.equal(input.value, '3行');
    input.value = '直した文字';
    input.listeners.keydown({ key: 'Enter', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls[0].text, '直した文字');
    assert.equal(calls[0].captionId, 'p2');
    assert.deepEqual(histories, ['置いた文字: 文字を編集']);

    instance.startPlacedEdit('p2');
    const cancel = instance.placedEditing.input;
    cancel.value = '取消す文字';
    cancel.listeners.keydown({ key: 'Escape', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);

    instance.startPlacedEdit('p2');
    const empty = instance.placedEditing.input;
    empty.value = '   ';
    empty.listeners.keydown({ key: 'Enter', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(histories.length, 1);
    assert.ok(notices.some(message => message.includes('空にできません')));
  } finally {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldCss === undefined) delete globalThis.CSS; else globalThis.CSS = oldCss;
  }
});

test('札の行移動は setCaptionTiming を 1 履歴で呼び timeDomain を書かない', async () => {
  const calls = [], histories = [];
  const instance = widget({ async withHistory(label, operation) { histories.push(label); await operation(); },
    annotationsService: { async setCaptionTiming(request) { calls.push(request); } }
  });
  await instance.movePlacedText('p2', { start: 16, end: 27 });
  assert.deepEqual(histories, ['置いた文字: 行を移動']);
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].start, calls[0].end], [16, 27]);
  assert.equal(Object.hasOwn(calls[0], 'timeDomain'), false);
});

function fakeNode(tag = 'div') {
  const node = { tag, dataset: {}, children: [], listeners: {}, style: { setProperty() {} },
    classList: { toggle() {}, add() {} }, hidden: false,
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
    appendChild(child) { child.parent = this; this.children.push(child); },
    prepend(child) { child.parent = this; this.children.unshift(child); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll() { return []; }, remove() {}, setAttribute() {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    get childElementCount() { return this.children.length; }
  };
  return node;
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

test('カードは 4 操作と説明だけを表示し、閉じるで既存の経路を呼ぶ', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  let closed = 0;
  const editor = fakeNode();
  const instance = widget({ placedEditor: editor, closePlacedEditor() { closed++; },
    renderPlacedEditor: AkariDaihonWidget.prototype.renderPlacedEditor });
  try {
    instance.renderPlacedEditor(instance.placedRanges().find(range => range.captionId === 'p2'));
    const actions = editor.children.find(node => node.className === 'akari-daihon-placed-actions');
    assert.deepEqual(actions.children.map(button => button.textContent), ['全部の行に', '文字を編集', '削除', '閉じる']);
    assert.equal(editor.children.at(-1).textContent, '範囲は左の棒の両端を引いて変えます');
    actions.children.at(-1).listeners.click();
    assert.equal(closed, 1);
    instance.renderPlacedEditor(undefined);
    assert.equal(editor.hidden, true);
    assert.equal(editor.children.length, 0, '置いた文字がなければ説明も出ない');
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('棒の当たりは左右 5px 広く、選択時だけ先頭と末尾につまみを出す', () => {
  const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
  assert.match(source, /\.akari-daihon-widget \.akari-daihon-placed-bar::before \{ content:""; position:absolute; inset:0 -5px; \}/);
  assert.match(source, /\.akari-daihon-widget \.akari-daihon-placed-bar \{[^}]*width:4px/);
  assert.match(source, /\.akari-daihon-row\.has-placed-handle \{ z-index:2; \}/);
  assert.match(source, /\.akari-daihon-placed-handle \{[^}]*z-index:3/);
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  const roots = new Map(spoken.map(row => [row.id, { root: fakeNode() }]));
  const rowsNode = fakeNode();
  const instance = widget({ elements: roots, rowsNode,
    renderPlacedText: AkariDaihonWidget.prototype.renderPlacedText,
    renderPlacedEditor() {} });
  try {
    instance.renderPlacedText();
    assert.equal([...roots.values()].flatMap(({ root }) => descendants(root)).filter(node => node.dataset.edge).length, 0);
    for (const { root } of roots.values()) root.children = [];
    instance.placedSelection = 'p2';
    instance.renderPlacedText();
    const handles = [...roots.entries()].flatMap(([id, { root }]) => descendants(root)
      .filter(node => node.dataset.edge).map(node => [id, node.dataset.edge]));
    assert.deepEqual(handles, [['r1', 'start'], ['r3', 'end']]);
    for (const id of ['r1', 'r3']) {
      const handle = descendants(roots.get(id).root).find(node => node.dataset.edge);
      assert.equal(handle.parent.className, 'akari-daihon-placed-columns', 'つまみは filter のある棒の外に置く');
      assert.equal(handle.parent.children.at(-1), handle, 'つまみは棒より後に重ねる');
    }
    for (const { root } of roots.values()) root.children = [];
    instance.placedSelection = 'p3';
    instance.renderPlacedText();
    const single = descendants(roots.get('r4').root).filter(node => node.dataset.edge);
    assert.deepEqual(single.map(node => node.dataset.edge), ['start', 'end']);
    assert.ok(descendants(roots.get('r4').root).some(node => node.className === 'akari-daihon-placed-single'));
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('隣の広い当たり領域より見えている棒の本体を優先し、半開の右端は隣へ渡す', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  const roots = new Map(spoken.map(row => [row.id, { root: fakeNode() }]));
  const selected = [];
  const instance = widget({ elements: roots, rowsNode: fakeNode(),
    renderPlacedText: AkariDaihonWidget.prototype.renderPlacedText, renderPlacedEditor() {},
    selectPlacedText(id) { selected.push(id); this.placedSelection = id; }
  });
  try {
    instance.renderPlacedText();
    const columns = roots.get('r2').root.children.find(node => node.className === 'akari-daihon-placed-columns');
    const bars = columns.children.filter(node => node.className === 'akari-daihon-placed-bar');
    assert.deepEqual(bars.map(node => node.dataset.captionId), ['p1', 'p2']);
    bars[0].getBoundingClientRect = () => ({ left: 0, right: 4 });
    bars[1].getBoundingClientRect = () => ({ left: 6, right: 10 });
    columns.querySelectorAll = () => bars;
    const click = x => bars[1].listeners.click({ clientX: x, detail: 1, stopPropagation() {} });
    click(2); // p2 の ::before が p1 の可視本体を覆っても p1 が選ばれる
    assert.deepEqual(selected, ['p1']);
    instance.lastPlacedClick = undefined;
    click(4); // p1 の右端は本体の外、p2 の中心から左へ 4px
    assert.deepEqual(selected, ['p1', 'p2']);
    assert.equal(instance.placedBarBodyCaption(columns, 10, 'p2'), 'p2');
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('つまみのドラッグ中は仮描画し、離したときだけ 1 回保存する', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  const calls = [], histories = [], previews = [];
  const roots = new Map(spoken.map((row, index) => [row.id,
    { root: { getBoundingClientRect: () => ({ bottom: (index + 1) * 40 }) } }]));
  const rowsNode = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const instance = widget({ placedSelection: 'p2', elements: roots, rowsNode,
    renderPlacedText() { previews.push(this.placedEdgeDrag?.timing ?? null); },
    async withHistory(label, operation) { histories.push(label); await operation(); },
    annotationsService: { async setCaptionTiming(request) { calls.push(request); } }
  });
  try {
    const handle = instance.createPlacedEdgeHandle(instance.placedRanges().find(range => range.captionId === 'p2'), 'end');
    handle.listeners.pointerdown({ button: 0, pointerId: 7, clientY: 130, preventDefault() {}, stopPropagation() {} });
    instance.handlePlacedEdgeMove({ pointerId: 7, clientY: 180 });
    assert.deepEqual(previews.at(-1), { start: 4, end: 19 });
    assert.equal(calls.length, 0);
    instance.handlePlacedEdgeUp({ pointerId: 7, type: 'pointerup' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(histories, ['置いた文字: 範囲を変更']);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].start, calls[0].end], [4, 19]);
    assert.equal(Object.hasOwn(calls[0], 'timeDomain'), false);
    handle.listeners.pointerdown({ button: 0, pointerId: 8, clientY: 130, preventDefault() {}, stopPropagation() {} });
    instance.handlePlacedEdgeMove({ pointerId: 8, clientY: 180 });
    instance.handlePlacedEdgeUp({ pointerId: 8, type: 'pointercancel' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('添付モードと 5 列以上の自動折り畳みを実際の札・棒 DOM に反映する', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  const roots = new Map(spoken.map(row => [row.id, { root: fakeNode() }]));
  const attachmentRanges = Array.from({ length: 5 }, (_, index) => ({
    id: `a${index}`, kind: index === 0 ? 'image' : 'html', name: `素材${index}`,
    path: index === 0 ? 'assets/photo.png' : 'assets/card.html', first: 0, last: 7,
    start: 0, end: 32, atFrames: 0, durationFrames: 960, colorIndex: 4 + index
  }));
  const instance = widget({ elements: roots, rowsNode: fakeNode(), attachments: attachmentRanges,
    attachmentMode: 'all', renderPlacedText: AkariDaihonWidget.prototype.renderPlacedText,
    renderPlacedEditor() {}, editUri: { parent: { resolve: path => ({ normalizePath() { return this; }, toString: () => `file:///project/${path}` }) } }
  });
  const rowNodes = () => descendants(roots.get('r0').root);
  const reset = () => { for (const { root } of roots.values()) root.children = []; };
  try {
    instance.renderPlacedText();
    assert.equal(rowNodes().filter(node => node.className === 'akari-daihon-placed-bar akari-daihon-attachment-bar').length, 3);
    assert.equal(rowNodes().filter(node => node.className === 'akari-daihon-placed-bar').length, 1);
    assert.deepEqual(rowNodes().filter(node => node.className === 'akari-daihon-attachment-folded')
      .map(node => node.textContent), ['▮5', '▮6']);
    assert.equal(rowNodes().find(node => node.className === 'akari-daihon-attachment-thumb').src,
      'file:///project/assets/photo.png');
    reset(); instance.attachmentMode = 'text'; instance.renderPlacedText();
    assert.equal(rowNodes().filter(node => node.dataset.attachmentId).length, 0);
    assert.ok(rowNodes().some(node => node.dataset.captionId === 'p1'));
    reset(); instance.attachmentMode = 'none'; instance.renderPlacedText();
    assert.equal(rowNodes().filter(node => node.dataset.attachmentId || node.dataset.captionId === 'p1').length, 0);
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('添付の札は全体・複数行・1 行の接尾辞を出し、同名 caption/item も別列に置く', () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => fakeNode(tag) };
  const roots = new Map(spoken.map(row => [row.id, { root: fakeNode() }]));
  const attachments = [
    { id: 'p1', kind: 'html', name: 'ロゴ', path: 'logo.html', first: 0, last: 7, colorIndex: 4 },
    { id: 'band', kind: 'html', name: '下帯', path: 'band.html', first: 1, last: 3, colorIndex: 5 },
    { id: 'image', kind: 'image', name: 'beans.png', path: 'beans.png', first: 2, last: 2, colorIndex: 6 }
  ].map(item => ({ ...item, start: item.first * 4, end: (item.last + 1) * 4,
    atFrames: item.first * 120, durationFrames: (item.last - item.first + 1) * 120 }));
  const instance = widget({ elements: roots, rowsNode: fakeNode(), attachments,
    attachmentMode: 'all', renderPlacedText: AkariDaihonWidget.prototype.renderPlacedText,
    renderPlacedEditor() {}, editUri: { parent: { resolve: path => ({ normalizePath() { return this; }, toString: () => `file:///project/${path}` }) } }
  });
  try {
    instance.renderPlacedText();
    const nodes = [...roots.values()].flatMap(({ root }) => descendants(root));
    const tagText = id => nodes.find(node => node.dataset.attachmentId === id && node.className?.includes('attachment-tag'))
      .children.find(node => node.tag === 'span' && node.className !== 'akari-daihon-attachment-icon').textContent;
    assert.equal(tagText('p1'), 'ロゴ · 全体');
    assert.equal(tagText('band'), '下帯 · 3 行');
    assert.equal(tagText('image'), 'beans.png');
    const row = descendants(roots.get('r2').root);
    const textBar = row.find(node => node.className === 'akari-daihon-placed-bar' && node.dataset.captionId === 'p1');
    const itemBar = row.find(node => node.className?.includes('attachment-bar') && node.dataset.attachmentId === 'p1');
    assert.notEqual(textBar.dataset.lane, itemBar.dataset.lane);
  } finally { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; }
});

test('画像を開く前に item 選択を待ち、画像 handler が返すタブを最後に前面化する', async () => {
  const events = [];
  let finishFocus;
  const focused = new Promise(resolve => { finishFocus = resolve; });
  const instance = widget({ closePop() {}, renderWordSelection() {}, setSelection() {},
    editUri: { parent: { resolve: path => ({ normalizePath() { return this; }, toString: () => `file:///project/${path}` }) } },
    commands: { async executeCommand(id, request) { events.push(['focus', id, request.itemId]); await focused; } },
    opener: { async open(uri) { events.push(['open', uri.toString()]); return { id: 'image-widget' }; } },
    applicationShell: { async activateWidget(id) { events.push(['activate', id]); } }
  });
  const pending = instance.openAttachment({ id: 'image', kind: 'image', name: 'beans.png', path: 'assets/beans.png' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [['focus', 'akari.timeline.focusItem', 'image']]);
  finishFocus();
  await pending;
  assert.deepEqual(events, [
    ['focus', 'akari.timeline.focusItem', 'image'],
    ['open', 'file:///project/assets/beans.png'],
    ['activate', 'image-widget']
  ]);
});

test('添付の移動は v2 snapshot API と 1 手の履歴を使う', async () => {
  const calls = [], histories = [];
  const edit = { version: 2, output: { fps: 30 }, tracks: [{ id: 'visual-1', lane: 'visual', items: [
    { id: 'band', at: 120, duration: 360, source: { kind: 'html', path: 'band.html' } }
  ] }] };
  const instance = widget({ async readText() { return JSON.stringify(edit); },
    async withHistory(label, operation) { histories.push(label); await operation(); },
    annotationsService: { async writeEditSnapshot(request) { calls.push(request); } }
  });
  await instance.writeAttachmentTiming('band', 240, 480, '範囲を変更');
  assert.deepEqual(histories, ['添付: 範囲を変更']);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].editSource).tracks[0].items[0],
    { id: 'band', at: 240, duration: 480, source: { kind: 'html', path: 'band.html' } });
});

test('添付表示モードはユーザー設定へ保存する', async () => {
  const saved = [];
  const button = { dataset: { attachmentMode: 'text' }, classList: { toggle(_name, active) { this.active = active; } },
    setAttribute(name, value) { this[name] = value; } };
  const instance = widget({ attachmentModeNode: { querySelectorAll: () => [button] },
    preferences: { async set(...args) { saved.push(args); } } });
  instance.setAttachmentMode('text');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.attachmentMode, 'text');
  assert.equal(button.classList.active, true);
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(saved[0][0], 'akari.daihon.attachmentMode');
  assert.equal(saved[0][1], 'text');
});

test('添付の範囲変更は Cmd+Z 相当の 1 手で edit.json 原文へ戻る', async () => {
  const entries = [];
  const original = '{\n  "version": 2,\n  "output": {"fps":30},\n  "sources": [],\n  "tracks": [{"id":"visual-1","lane":"visual","items":[{"id":"band","at":120,"duration":360,"source":{"kind":"html","path":"band.html"}}]}]\n}\n';
  let document = original;
  const instance = widget({
    async readText(target) { return target === this.editUri ? document : '[]'; },
    async reload() {},
    annotationsService: { async writeEditSnapshot(request) { document = request.editSource; } }
  });
  setDaihonHistoryService({ push: entry => entries.push(entry) });
  try {
    await instance.writeAttachmentTiming('band', 120, 480, '範囲を変更');
    assert.equal(entries.length, 1);
    assert.equal(JSON.parse(document).tracks[0].items[0].duration, 480);
    await entries[0].undo();
    assert.equal(document, original);
    await entries[0].redo();
    assert.equal(JSON.parse(document).tracks[0].items[0].duration, 480);
  } finally { setDaihonHistoryService(undefined); }
});
