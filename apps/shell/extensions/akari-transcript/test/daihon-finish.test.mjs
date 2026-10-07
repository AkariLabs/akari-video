import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { getCaptionDisplayWordStyle, setCaptionDisplayRowStyle,
  updateCaptionFieldsInSourceWithReport } from '@akari-video/edit-store';
import { openWordContextMenu, wordContextMenuGroups } from '../lib/browser/daihon/daihon-word-context-menu.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');

function method(start, end, dependencies = {}) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  const compiled = ts.transpileModule(`class Harness { ${source.slice(from, to)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  return new Function(...Object.keys(dependencies), `${compiled}; return Harness;`)(...Object.values(dependencies));
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.className = '';
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.offsetWidth = 180;
    this.offsetHeight = 240;
    this.classList = {
      add: name => { this.className = `${this.className} ${name}`.trim(); },
      toggle: (name, enabled) => {
        const names = new Set(this.className.split(/\s+/u).filter(Boolean));
        if (enabled) names.add(name); else names.delete(name);
        this.className = [...names].join(' ');
      },
      contains: name => this.className.split(/\s+/u).includes(name)
    };
  }
  append(...children) {
    for (const child of children) {
      child.remove?.();
      child.parent = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  setAttribute() {}
  replaceChildren(...children) {
    for (const child of this.children) child.parent = undefined;
    this.children = [];
    this.append(...children);
  }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    return this.children.filter(child => {
      if (selector === '.akari-daihon-toast-stack') return child.className === 'akari-daihon-toast-stack';
      if (selector === '.akari-daihon-toast.error') return child.className === 'akari-daihon-toast error';
      if (selector === '.akari-daihon-toast:not(.error)') return child.className === 'akari-daihon-toast';
      return selector === 'button' && child.tag === 'button';
    });
  }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0]; }
}

test('同じエラーは 3 回でも 1 枚、異なるエラーも最大 3 枚', () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag),
    createTextNode: value => ({ value }) };
  try {
    const Harness = method('    protected showToast(', '    protected openCutRangeEditor(');
    const widget = new Harness();
    widget.node = new FakeElement();
    for (let i = 0; i < 3; i++) widget.showToast('同じエラー', true);
    let stack = widget.node.querySelector('.akari-daihon-toast-stack');
    assert.equal(stack.childElementCount, 1);
    for (const message of ['別のエラー', '三つ目', '四つ目']) widget.showToast(message, true);
    stack = widget.node.querySelector('.akari-daihon-toast-stack');
    assert.deepEqual(stack.children.map(child => child.dataset.message), ['別のエラー', '三つ目', '四つ目']);
  } finally { globalThis.document = previous; }
});

test('隙間の案内は通常通知になり、4.5 秒で消える', () => {
  assert.match(source, /zone\.addEventListener\('click',[\s\S]*?this\.notify\('ここには隙間がほぼ無い — 分割（⧉）でどうぞ'\)/u);
  const previousDocument = globalThis.document;
  const previousTimeout = globalThis.setTimeout;
  let callback;
  let delay;
  globalThis.document = { createElement: tag => new FakeElement(tag),
    createTextNode: value => ({ value }) };
  globalThis.setTimeout = (run, milliseconds) => { callback = run; delay = milliseconds; return 1; };
  try {
    const Harness = method('    protected showToast(', '    protected openCutRangeEditor(');
    const widget = new Harness();
    widget.node = new FakeElement();
    widget.showToast('ここには隙間がほぼ無い — 分割（⧉）でどうぞ');
    assert.equal(delay, 4500);
    assert.equal(widget.node.querySelector('.akari-daihon-toast-stack').childElementCount, 1);
    callback();
    assert.equal(widget.node.querySelector('.akari-daihon-toast-stack'), null);
  } finally { globalThis.document = previousDocument; globalThis.setTimeout = previousTimeout; }
});

test('カット済みの行を押すと復元ポップを開き、シークしない', () => {
  const Harness = method('    protected handleRowClick(', '    protected handleRowPointerDown(',
    { INTERACTIVE_SELECTOR: '.interactive' });
  const widget = new Harness();
  const row = { id: 'cut-row', outStart: null };
  const span = { rowId: row.id, kind: 'row' };
  const calls = [];
  widget.rows = [row];
  widget.cutSpanFor = () => span;
  widget.openCutSpanPop = (_anchor, actualRow, actualSpan) => calls.push([actualRow, actualSpan]);
  widget.seek = () => { throw new Error('カット済みの行をシークした'); };
  widget.handleRowClick({ target: { closest: () => null } }, row.id);
  assert.deepEqual(calls, [[row, span]]);
  assert.match(source, /tc\.addEventListener\('click',[\s\S]*?if \(row\.outStart === null\)[\s\S]*?this\.openCutSpanPop\(tc, row, cutSpan\)/u);
  assert.match(source, /if \(row\.outStart === null\) \{\s*const rowCutSpan = this\.cutSpanFor\(row\.id, 'row'\);\s*if \(rowCutSpan\) this\.openCutSpanPop\(span, row, rowCutSpan\)/u);
});

test('カット済みの行でも Shift と ⌘Ctrl は範囲・追加選択を優先する', () => {
  const { planRowClick, applySelectionClick } = require('../lib/common/daihon-selection.js');
  const Harness = method('    protected notifyUnrestorableRow(', '    protected handleRowPointerDown(',
    { INTERACTIVE_SELECTOR: '.interactive', planRowClick, applySelectionClick });
  const row = { id: 'cut-row', outStart: null };
  const span = { rowId: row.id, kind: 'row' };
  for (const modifiers of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }]) {
    const widget = new Harness();
    const calls = [];
    widget.rows = [{ id: 'first', outStart: 0 }, row];
    widget.selection = { selected: ['first'], anchorId: 'first' };
    widget.wordRanges = [];
    widget.cutSpanFor = () => span;
    widget.rowOrder = () => widget.rows.map(item => item.id);
    widget.setSelection = selection => { widget.selection = selection; calls.push('select'); };
    widget.renderActionBar = () => calls.push('bar');
    widget.openCutSpanPop = () => calls.push('pop');
    widget.seek = () => calls.push('seek');
    widget.handleRowClick({ target: { closest: () => null }, ...modifiers }, row.id);
    assert.deepEqual(calls, ['select', 'bar']);
    assert.ok(widget.selection.selected.includes(row.id));
  }

  const from = source.indexOf("        const root = document.createElement('div');", source.indexOf('    protected createRow('));
  const to = source.indexOf("        root.addEventListener('pointerdown'", from);
  assert.ok(from >= 0 && to > from);
  const compiled = ts.transpileModule(`function makeRoot(row) { ${source.slice(from, to)} return root; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const fakeDocument = { createElement: tag => new FakeElement(tag) };
  const makeRoot = new Function('document', 'INTERACTIVE_SELECTOR', `${compiled}; return makeRoot;`)
    (fakeDocument, '.interactive');
  const widget = { handEditedCaptionIds: new Set(), selection: { selected: [] }, qcFilter: false,
    cutSpanFor: () => span, openCutSpanPop: () => calls.push('pop'),
    handleRowClick: event => calls.push(event.shiftKey ? 'shift' : event.metaKey ? 'meta' : event.ctrlKey ? 'ctrl' : 'plain') };
  const root = makeRoot.call(widget, row);
  const calls = [];
  for (const modifiers of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }]) {
    root.listeners.get('click')({ target: { closest: () => null }, stopPropagation() {}, ...modifiers });
  }
  root.listeners.get('click')({ target: { closest: () => null }, stopPropagation() {} });
  widget.cutSpanFor = () => undefined;
  root.listeners.get('click')({ target: { closest: () => null }, stopPropagation() {} });
  assert.deepEqual(calls, ['shift', 'meta', 'ctrl', 'pop', 'plain']);
});

test('戻すカットが無い出力外の行は時刻と行クリックで通常の案内を出す', () => {
  const { planRowClick, applySelectionClick } = require('../lib/common/daihon-selection.js');
  const Harness = method('    protected notifyUnrestorableRow(', '    protected handleRowPointerDown(',
    { INTERACTIVE_SELECTOR: '.interactive', planRowClick, applySelectionClick });
  const row = { id: 'hidden-row', outStart: null };
  const widget = new Harness();
  const messages = [];
  widget.rows = [row];
  widget.cutSpanFor = () => undefined;
  widget.notify = message => messages.push(message);
  widget.openCutSpanPop = () => assert.fail('戻すポップは開けない');
  widget.seek = () => assert.fail('出力外の行へシークしない');
  widget.handleRowClick({ target: { closest: () => null } }, row.id);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /この行は出力に現れないため、ここからは戻せません/u);

  const from = source.indexOf("        const tc = document.createElement('button');", source.indexOf('    protected createRow('));
  const to = source.indexOf('        head.appendChild(tc);', from) + '        head.appendChild(tc);'.length;
  assert.ok(from >= 0 && to > from);
  const compiled = ts.transpileModule(`function makeTime(row, head) { ${source.slice(from, to)} return tc; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const makeTime = new Function('document', `${compiled}; return makeTime;`)
    ({ createElement: tag => new FakeElement(tag) });
  widget.formatTime = value => String(value);
  widget.notifyUnrestorableRow = () => messages.push('time');
  const tc = makeTime.call(widget, { ...row, start: 0, end: 1 }, new FakeElement());
  assert.equal(tc.title, 'この行は出力に現れません');
  let stopped = false;
  tc.listeners.get('click')({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(messages.at(-1), 'time');
});

test('行の表示は既定との差だけ保存し、同じ値に戻すと継承する', () => {
  const from = source.indexOf("        const style = document.createElement('select');", source.indexOf('    protected openGearPop('));
  const to = source.indexOf("        const timing = document.createElement('select');", from);
  assert.ok(from >= 0 && to > from);
  const snippet = ts.transpileModule(`function change(row) { ${source.slice(from, to)} return style; }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const previousDocument = globalThis.document;
  const previousOption = globalThis.Option;
  globalThis.document = { createElement: () => ({ options: [], add(option) { this.options.push(option); },
    addEventListener(_name, callback) { this.change = callback; } }) };
  globalThis.Option = class { constructor(label, value) { this.label = label; this.value = value; } };
  try {
    const change = new Function('getCaptionDisplayWordStyle', 'setCaptionDisplayRowStyle',
      `${snippet}; return change;`)(getCaptionDisplayWordStyle, setCaptionDisplayRowStyle);
    for (const [globalStyle, rowStyle, initial, chosen, expected] of [
      ['karaoke', null, 'karaoke', 'plain', 'plain'],
      ['karaoke', 'plain', 'plain', 'karaoke', null],
      ['none', null, 'plain', 'karaoke', 'karaoke'],
      ['none', 'karaoke', 'karaoke', 'plain', null]
    ]) {
      const root = { display_policy: { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
        unit_metric: 'ascii-half-other-one-v1', max_line_units: 18,
        minimum_fragment_duration_seconds: 0.72, locale: 'ja', word_style: globalStyle },
      captions: [{ id: 'row', start: 0, end: 1, text: '声', speaker: null,
        sourceRef: null, edited: false, ...(rowStyle ? { style: rowStyle } : {}) }] };
      let saved;
      let persisted;
      const style = change.call({ displayRootForWrite: () => root,
        saveCaptionFields: (id, fields) => {
          saved = fields;
          persisted = JSON.parse(updateCaptionFieldsInSourceWithReport(JSON.stringify(root), id, fields).source);
        } }, { id: 'row', style: rowStyle });
      assert.equal(style.value, initial);
      assert.equal(style.options.find(option => option.value === 'plain').disabled, undefined);
      style.value = chosen;
      style.change();
      assert.deepEqual(saved, { style: expected }, `${globalStyle}/${rowStyle} → ${chosen}`);
      assert.equal(persisted.captions[0].style, expected ?? undefined);
    }
  } finally { globalThis.document = previousDocument; globalThis.Option = previousOption; }
});

test('映像区間の無い声の素材だけを候補から外す', () => {
  const from = source.indexOf('    protected audioOnlyCutReason(');
  const to = source.indexOf('    /** 行ごとの無音。', from);
  const candidateFrom = source.indexOf('    protected cuttableCandidates(');
  const candidateTo = source.indexOf('    protected updateCutsButton(', candidateFrom);
  assert.ok(from >= 0 && to > from && candidateFrom >= 0 && candidateTo > candidateFrom);
  const compiled = ts.transpileModule(`class Harness { ${source.slice(from, to)} ${source.slice(candidateFrom, candidateTo)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const Harness = new Function(`${compiled}; return Harness;`)();
  const widget = new Harness();
  widget.segments = [
    { kind: 'src', src: 'voice-mp4', cutIndex: null },
    { kind: 'src', src: 'visual-wav', cutIndex: 0 },
    { kind: 'src', src: 'mixed', cutIndex: null },
    { kind: 'src', src: 'mixed', cutIndex: 1 }
  ];
  widget.rows = [{ id: 'voice', src: 'voice-mp4' }, { id: 'picture', src: 'visual-wav' },
    { id: 'mixed', src: 'mixed' }, { id: 'missing', src: 'missing' }];
  widget.sourceIdForRow = row => row.src;
  assert.match(widget.audioOnlyCutReason(widget.rows[0]), /音声だけの素材の行/u);
  assert.equal(widget.audioOnlyCutReason(widget.rows[1]), undefined);
  assert.equal(widget.audioOnlyCutReason(widget.rows[2]), undefined);
  assert.equal(widget.audioOnlyCutReason(widget.rows[3]), undefined);
  assert.deepEqual(widget.cuttableCandidates(widget.rows.map(row => ({ rowId: row.id }))),
    [{ rowId: 'picture' }, { rowId: 'mixed' }, { rowId: 'missing' }]);
});

test('声の素材の語メニューは映像ごとカットを理由付きで無効にする', () => {
  const reason = 'マイクなど音声だけの素材の行は、まだ台本からは切れません（タイムラインで切ってください）';
  const Harness = method('    protected openWordMenu(', '    protected async handleWordAction(', {
    wordRangeSummary: () => ({ rangeCount: 1, wordCount: 1, text: '声' }),
    canSplitRow: () => false, canMergeRows: () => ({ ok: false }),
    wordContextMenuGroups, openWordContextMenu
  });
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  const body = new FakeElement();
  globalThis.document = { createElement: tag => new FakeElement(tag), body };
  globalThis.window = { innerWidth: 800, innerHeight: 600 };
  try {
    const widget = new Harness();
    const voice = { id: 'voice', words: [{ text: '声' }] };
    const picture = { id: 'picture', words: [{ text: '絵' }] };
    const actions = [];
    widget.rows = [voice, picture];
    widget.wordRanges = [];
    widget.selectionRows = () => widget.rows;
    widget.renderWordSelection = () => {};
    widget.closePop = () => {};
    widget.wordInsertAvailable = () => false;
    widget.audioOnlyCutReason = row => row.id === 'voice' ? reason : undefined;
    widget.handleWordAction = action => actions.push(action.kind);
    const cutButton = () => body.children.at(-1).children.flatMap(child => child.children)
      .find(child => child.textContent === '✂ 映像ごとカット');

    widget.openWordMenu({ clientX: 30, clientY: 40 }, voice, 0);
    const disabled = cutButton();
    assert.equal(disabled.disabled, true);
    assert.equal(disabled.title, reason);
    disabled.listeners.get('click')({ stopPropagation() {} });
    assert.deepEqual(actions, []);

    widget.openWordMenu({ clientX: 30, clientY: 40 }, picture, 0);
    const enabled = cutButton();
    assert.equal(enabled.disabled, undefined);
    enabled.listeners.get('click')({ stopPropagation() {} });
    assert.deepEqual(actions, ['cut-video']);
  } finally { globalThis.document = oldDocument; globalThis.window = oldWindow; }
});

test('外部 cutRange は声の素材の行で失敗を返し、エディタ直前のガードも知らせる', async () => {
  const { resolveDaihonFocusRowId, isValidDaihonWordRange } = require('../lib/common/daihon-focus-target.js');
  const { resolveCurrent } = require('../lib/common/daihon-time-map.js');
  const FocusHarness = method('    async focusTarget(', '    showError(', {
    resolveDaihonFocusRowId, isValidDaihonWordRange, resolveCurrent,
    triggerFocusPulse: () => {}
  });
  const reason = 'マイクなど音声だけの素材の行は、まだ台本からは切れません（タイムラインで切ってください）';
  const row = { id: 'voice', speaker: null, words: [{ text: '声' }] };
  const widget = new FocusHarness();
  const notices = [];
  Object.assign(widget, { configured: true, reloadTail: Promise.resolve(), rows: [row],
    elements: new Map([[row.id, { root: { scrollIntoView() {} } }]]),
    speakerFilter: null, qcFilter: false, wordRanges: [],
    applyQcFilter() {}, setSelection() {}, renderWordSelection() {}, openWordBar() {},
    audioOnlyCutReason: () => reason, notify: message => notices.push(message),
    openCutRangeEditorForSelection: () => assert.fail('声の素材でエディタを開かない') });
  assert.equal(await widget.focusTarget({ captionId: row.id, wordRange: { from: 0, to: 0 }, open: 'cutRange' }), false);
  assert.deepEqual(notices, [reason]);

  const GuardHarness = method('    protected openCutRangeEditorForSelection(', '    protected textWithoutRanges(');
  const guarded = new GuardHarness();
  guarded.selectedRangeSpans = () => [{ row, t_start: 0, t_end: 1, word: '声' }];
  guarded.audioOnlyCutReason = () => reason;
  guarded.notify = message => notices.push(message);
  guarded.openCutRangeEditor = () => assert.fail('ガードを越えてエディタを開かない');
  guarded.openCutRangeEditorForSelection();
  assert.deepEqual(notices, [reason, reason]);
});

test('無効な行のカットボタンは薄く、ホバーしても色を変えない', () => {
  const disabled = source.match(/\.akari-daihon-cut:disabled\s*\{([^}]*)\}/u)?.[1];
  assert.ok(disabled);
  assert.match(disabled, /opacity:\s*\.[0-5][0-9]?/u);
  assert.match(disabled, /cursor:\s*default/u);
  const hoverRules = [...source.matchAll(/([^{}]+)\{[^{}]*\}/gu)]
    .map(match => match[1].trim()).filter(selector => selector.includes('.akari-daihon-cut:hover'));
  assert.ok(hoverRules.length > 0);
  assert.ok(hoverRules.every(selector => selector.split(',').filter(part => part.includes('.akari-daihon-cut:hover'))
    .every(part => part.includes(':hover:not(:disabled)'))));
});

test('Esc は登録順のまま置いた文字を優先し、通常のポップは従来どおり閉じる', () => {
  assert.ok(source.indexOf("document.addEventListener('keydown', dockEscape)")
    < source.indexOf("document.addEventListener('keydown', closePlacedOnEscape)"));
  const Harness = method('    protected handleDockEscape(', '    async focusTarget(',
    { shouldCloseDockOnEscape: () => false });
  const oldDocument = globalThis.document;
  const oldTimeout = globalThis.setTimeout;
  let popOpen = true;
  globalThis.document = { querySelector: () => popOpen ? {} : null, activeElement: null, body: {} };
  globalThis.setTimeout = () => 1;
  try {
    const widget = new Harness();
    const calls = { pop: 0, placed: 0, render: 0, release: [] };
    widget.node = { contains: () => false };
    widget.rowsNode = { hasPointerCapture: () => true,
      releasePointerCapture: id => calls.release.push(id) };
    widget.closePop = () => { calls.pop++; popOpen = false; };
    widget.closePlacedEditor = () => { calls.placed++; widget.placedSelection = undefined; };
    widget.renderPlacedText = () => { calls.render++; };
    const dispatch = () => {
      const event = { key: 'Escape', prevented: 0, stopped: 0,
        preventDefault() { this.prevented++; },
        stopImmediatePropagation() { this.stopped++; } };
      for (const listener of [widget.handleDockEscape, widget.handlePlacedEscape]) {
        listener.call(widget, event);
        if (event.stopped) break;
      }
      return event;
    };
    widget.placedEdgeDrag = { pointerId: 7 };
    const drag = dispatch();
    assert.equal(widget.placedEdgeDrag, undefined);
    assert.deepEqual(calls.release, [7]);
    assert.equal(calls.render, 1);
    assert.equal(calls.pop, 0);
    assert.equal(drag.stopped, 0);

    widget.placedSelection = { captionId: 'placed' };
    const selected = dispatch();
    assert.equal(calls.placed, 1);
    assert.equal(calls.pop, 0);
    assert.equal(selected.stopped, 0);

    const plain = dispatch();
    assert.equal(calls.pop, 1);
    assert.equal(plain.stopped, 1);
    assert.equal(plain.prevented, 1);
  } finally { globalThis.document = oldDocument; globalThis.setTimeout = oldTimeout; }
});

test('選択バーの実際の文言は 400px 幅で全状態 2 段以内に収まる', () => {
  const Harness = method('    protected renderActionBar(', '    protected updateToastPlacement(', {
    wordRangeSummary: () => ({ text: 'あいうえおかきくけこ' }),
    canMergeRows: () => ({ ok: true }), clearSelection: () => ({ selected: [] })
  });
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: tag => new FakeElement(tag) };
  try {
    const widget = new Harness();
    widget.actionBar = new FakeElement();
    widget.footer = { hidden: false };
    widget.updateToastPlacement = () => {};
    widget.rows = [{ id: 'a' }, { id: 'b' }];
    widget.selectionRows = () => widget.rows;
    widget.audioOnlyCutReason = () => undefined;
    const candidate = (title, labels, disabledCutReason) => ({ title, target: { id: title },
      actions: labels.map(label => ({ label, run() {},
        ...(disabledCutReason && label === '✂ 映像ごとカット' ? { disabledReason: disabledCutReason } : {}) })) });
    const voiceCutReason = 'マイクなど音声だけの素材の行は、まだ台本からは切れません（タイムラインで切ってください）';
    const cases = [
      { name: '1 行', selected: ['a'], words: [], candidate: undefined,
        labels: ['1 行を選択中', '🔊 読み上げ', '🎙 アフレコ', '🎨 見た目', 'T 文字を置く', '✂ カット', '結合', '⋯', '✕'] },
      { name: '複数行', selected: ['a', 'b'], words: [], candidate: undefined,
        labels: ['2 行を選択中', '🔊 読み上げ', '🎙 アフレコ', '🎨 見た目', 'T 文字を置く', '✂ カット', '結合', '⋯', '✕'] },
      { name: '語の範囲', selected: ['a'], words: [{ row: 'a', a: 0, b: 0 }], candidate: undefined,
        labels: ['「あいうえおかきくけこ」', '✎ 直す', '✦ 強調', '✂ 映像ごとカット',
          '字幕からだけ消す（音声はそのまま）', '⏸ 間を入れる', '✕'] },
      { name: '無音', selected: [], words: [],
        candidate: candidate('無音 1.00 秒', ['▶ 聞く', '✂ 範囲を決めてカット']),
        labels: ['無音 1.00 秒', '▶ 聞く', '✂ 範囲を決めてカット', '✕'] },
      { name: 'フィラー', selected: [], words: [],
        candidate: candidate('フィラー「えー」', ['▶ 聞く', '字幕からだけ消す（音声はそのまま）', '✂ 映像ごとカット']),
        labels: ['フィラー「えー」', '▶ 聞く', '字幕からだけ消す（音声はそのまま）', '✂ 映像ごとカット', '✕'] },
      { name: '声の素材のフィラー', selected: [], words: [],
        candidate: candidate('フィラー「えー」', ['▶ 聞く', '字幕からだけ消す（音声はそのまま）',
          '✂ 映像ごとカット'], voiceCutReason),
        disabledCutReason: voiceCutReason,
        labels: ['フィラー「えー」', '▶ 聞く', '字幕からだけ消す（音声はそのまま）', '✂ 映像ごとカット', '✕'] },
      { name: '言い直し', selected: [], words: [],
        candidate: candidate('言い直し 0:01.00–0:02.00', ['▶ 聞く', '✂ 映像ごとカット']),
        labels: ['言い直し 0:01.00–0:02.00', '▶ 聞く', '✂ 映像ごとカット', '✕'] },
      { name: '??', selected: [], words: [],
        candidate: candidate('?? 聞き取れなかった音', ['▶ 聞く', '✎ 直す', '✂ 映像ごとカット']),
        labels: ['?? 聞き取れなかった音', '▶ 聞く', '✎ 直す', '✂ 映像ごとカット', '✕'] }
    ];
    // 実機 400px で測った値（12px・アプリのフォント）。
    const textWidth = value => [...value].reduce((width, char) => {
      if (char === ' ') return width + 3.5;
      if (char === '🔊' || char === '🎨') return width + 16.5;
      if ('✂✎⏸▶⋯'.includes(char)) return width + 12;
      if (char === '✦' || char === '✕') return width + 10;
      if ('（）「」'.includes(char)) return width + 6.6;
      return width + (char.codePointAt(0) <= 0x7f ? 6.5 : 12);
    }, 0);
    const rowsNeeded = children => {
      let rows = 1, used = 0;
      for (const child of children) {
        const width = textWidth(child.textContent) + (child.tag === 'button' ? 16 : 0);
        if (used && used + 4 + width > 384) { rows++; used = width; }
        else used += (used ? 4 : 0) + width;
      }
      return rows;
    };
    for (const state of cases) {
      widget.selection = { selected: state.selected, anchorId: state.selected[0] };
      widget.wordRanges = state.words;
      widget.candidateBar = state.candidate;
      widget.renderActionBar();
      assert.deepEqual(widget.actionBar.children.map(child => child.textContent), state.labels, state.name);
      if (state.disabledCutReason) {
        const cut = widget.actionBar.children.find(child => child.textContent === '✂ 映像ごとカット');
        assert.equal(cut.disabled, true);
        assert.equal(cut.title, state.disabledCutReason);
      }
      const rows = rowsNeeded(widget.actionBar.children);
      assert.ok(rows <= 2, `${state.name}: ${rows} 段`);
    }
    const css = source.match(/\.akari-daihon-actionbar \{[^\n]+\}/u)?.[0];
    assert.match(css, /font-size:12px/u);
    assert.doesNotMatch(css, /max-height|overflow:hidden/u);
    assert.match(source, /\.akari-daihon-actionbar button \{[^\n]*font:inherit/u);
  } finally { globalThis.document = oldDocument; }
});

test('3 枚を超えて通常通知を追い出すとタイマーと取り消し監視を片付ける', () => {
  const Harness = method('    protected showCutToast(', '    protected openCutRangeEditor(');
  const oldDocument = globalThis.document;
  const oldTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  const cleared = [];
  let disposed = 0;
  globalThis.document = { createElement: tag => new FakeElement(tag),
    createTextNode: value => ({ value }) };
  globalThis.setTimeout = () => 42;
  globalThis.clearTimeout = id => cleared.push(id);
  try {
    const widget = new Harness();
    widget.node = new FakeElement();
    widget.historyService = { onDidChange: () => ({ dispose: () => { disposed++; } }) };
    widget.showCutToast('カットしました', () => {});
    const stack = widget.node.querySelector('.akari-daihon-toast-stack');
    const normal = stack.children[0];
    for (const message of ['エラー 1', 'エラー 2', 'エラー 3']) widget.showToast(message, true);
    assert.equal(normal.parent, undefined);
    assert.equal(stack.childElementCount, 3);
    assert.deepEqual(cleared, [42]);
    assert.equal(disposed, 1);
    assert.equal(widget.toastTimer, undefined);
    assert.equal(widget.cutToastCleanup, undefined);
  } finally {
    globalThis.document = oldDocument;
    globalThis.setTimeout = oldTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }
});
