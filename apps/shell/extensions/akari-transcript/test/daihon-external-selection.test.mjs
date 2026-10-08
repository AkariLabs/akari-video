import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(process.env.AKARI_DAIHON_SOURCE
  || new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf('        const captionSelection = (event: Event): void => {');
const end = source.indexOf('        const attachmentSelection =', start);
assert.ok(start >= 0 && end > start);
const listener = source.slice(start, end);
const code = ts.transpileModule(`class Harness { receive(event) { ${listener} captionSelection(event); } }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const Harness = new Function('URI', 'clearSelection', 'PreferenceScope', 'DAIHON_HIDDEN_SOURCES_PREFERENCE', `${code}; return Harness;`)(
  class { constructor(value) { this.value = value; } normalizePath() { return this; }
    toString() { return this.value.replace('/./', '/'); } },
  () => ({ selected: [], anchorId: null }), { Workspace: 'workspace' }, 'hidden-sources'
);

function fixture({ visible = true, dock = undefined } = {}) {
  const calls = [];
  const widget = new Harness();
  const roots = new Map(['a', 'b', 'c'].map(id => [id, { root: {
    classList: { contains: () => false }
  } }]));
  Object.assign(widget, {
    editUri: { normalizePath: () => ({ toString: () => 'file:///p/edit.json' }) },
    elements: roots, selection: { selected: [], anchorId: null },
    isVisible: visible, dockKind: dock, qcFilter: false, speakerFilter: null,
    setSelection(next, sync) { calls.push(['selection', next, sync]); this.selection = next; },
    scheduleSelectionReveal(id) { if (this.isVisible) calls.push(['reveal', id]); },
    openRowDock() { calls.push(['openDock']); },
    applicationShell: { activateWidget() { calls.push(['activate']); return Promise.resolve(); } },
    rowsNode: { focus() { calls.push(['focus']); } },
    applyQcFilter() { calls.push(['filter', this.autoScrolling]); }
  });
  const send = (ids, primary = null, editUri = 'file:///p/./edit.json', origin = undefined) => widget.receive({
    detail: { editUri, captionIds: ids, primaryCaptionId: primary, origin }
  });
  return { widget, calls, roots, send };
}

test('external caption selection projects primary row without echo or keyboard focus', async () => {
  const { widget, calls, send } = fixture();
  send(['a', 'b', 'c'], 'b');
  await Promise.resolve();
  assert.deepEqual(widget.selection, { selected: ['a', 'b', 'c'], anchorId: 'b' });
  assert.deepEqual(calls, [['selection', { selected: ['a', 'b', 'c'], anchorId: 'b' }, false], ['reveal', 'b']]);
  send(['a', 'b', 'c'], 'b', 'file:///p/edit.json');
  assert.equal(calls.length, 2, 'identical round trip must not select again');
  assert.equal(calls.some(([name]) => name === 'activate' || name === 'focus'), false);
});

test('the transcript ignores its own timeline round trip', () => {
  const { widget, calls, send } = fixture();
  widget.selection = { selected: ['a', 'b', 'c'], anchorId: null };
  send(['a', 'b', 'c'], 'a', 'file:///p/edit.json', 'daihon');
  assert.equal(widget.selection.anchorId, null);
  assert.deepEqual(calls, []);
});

test('other or unknown captions clear the row selection without opening the dock', () => {
  const { widget, calls, send } = fixture({ dock: undefined });
  widget.selection = { selected: ['a'], anchorId: 'a' };
  send(['a', 'missing']);
  assert.deepEqual(widget.selection.selected, []);
  send([]);
  assert.equal(calls.some(([name]) => name === 'openDock'), false);
});

test('hidden transcript updates selection state without switching tabs or focusing', () => {
  const { widget, calls, send } = fixture({ visible: false });
  send(['c']);
  assert.deepEqual(widget.selection.selected, ['c']);
  assert.deepEqual(calls.map(([name]) => name), ['selection']);
});

test('external selection leaves a closed dock closed and preserves visible filters', () => {
  const { widget, calls, send } = fixture();
  widget.qcFilter = true;
  widget.speakerFilter = 'speaker';
  send(['a']);
  assert.equal(widget.qcFilter, true);
  assert.equal(widget.speakerFilter, 'speaker');
  assert.equal(calls.some(([name]) => name === 'filter' || name === 'openDock'), false);
});

test('external selection clears filters only when its row is hidden', () => {
  const { widget, calls, roots, send } = fixture();
  widget.qcFilter = true;
  widget.speakerFilter = 'other';
  widget.autoScrolling = true;
  roots.get('a').root.classList.contains = name => name === 'speaker-hidden';
  send(['a']);
  assert.equal(widget.qcFilter, false);
  assert.equal(widget.speakerFilter, null);
  assert.ok(calls.some(([name, guarded]) => name === 'filter' && guarded === true));
  assert.equal(widget.autoScrolling, false, 'filter adjustment must release a prior playback scroll guard');
});

test('timeline selection reveals a source-filtered row and clears saved hidden sources', () => {
  const { widget, roots, send } = fixture();
  const saved = [];
  widget.hiddenSourceIds = ['mic'];
  widget.preferences = { set: (...args) => { saved.push(args); return Promise.resolve(); } };
  roots.get('a').root.classList.contains = name => name === 'source-hidden';
  send(['a']);
  assert.deepEqual(widget.hiddenSourceIds, []);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0][1], []);
});

test('range selection order excludes rows hidden by source, QC, or speaker filters', () => {
  const start = source.indexOf('    protected rowOrder(): string[] {');
  const end = source.indexOf('    protected handleRowShortcut(', start);
  assert.ok(start >= 0 && end > start);
  const compiled = ts.transpileModule(`class OrderHarness { ${source.slice(start, end)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const OrderHarness = new Function(`${compiled}; return OrderHarness;`)();
  const widget = new OrderHarness();
  widget.rows = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  widget.elements = new Map(['a', 'b', 'c', 'd'].map(id => [id, { root: {
    classList: { contains: name => ({ b: 'source-hidden', c: 'qc-hidden', d: 'speaker-hidden' })[id] === name }
  } }]));
  assert.deepEqual(widget.rowOrder(), ['a']);
});

test('manual scroll suppresses later dock or resize reveal until the selection changes', () => {
  const methodStart = source.indexOf('    protected scheduleSelectionReveal(');
  const methodEnd = source.indexOf('    protected async seek(', methodStart);
  assert.ok(methodStart >= 0 && methodEnd > methodStart);
  const method = source.slice(methodStart, methodEnd);
  const compiled = ts.transpileModule(`class RevealHarness { ${method} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const frames = [];
  const RevealHarness = new Function('requestAnimationFrame', 'selectionScrollTop',
    `${compiled}; return RevealHarness;`)(callback => { frames.push(callback); return frames.length; }, () => 200);
  const widget = new RevealHarness();
  const rect = { top: 300, bottom: 330 };
  Object.assign(widget, {
    isVisible: true, selection: { selected: ['a'], anchorId: 'a' }, selectionRevealFrame: 0,
    selectionRevealInterrupted: true, selectionRevealTargetId: 'a',
    elements: new Map([['a', { root: { classList: { contains: () => false }, getBoundingClientRect: () => rect } }]]),
    rowsNode: { scrollTop: 100, getBoundingClientRect: () => ({ top: 0, bottom: 150 }) },
    dockKind: undefined
  });
  widget.scheduleSelectionReveal();
  for (const frame of frames) frame();
  assert.equal(widget.rowsNode.scrollTop, 100);
});

test('a hidden panel defers reveal and reveals the selected row when shown', () => {
  assert.match(source, /onAfterShow\([\s\S]*?this\.scheduleSelectionReveal\(\)/u);
  const methodStart = source.indexOf('    protected scheduleSelectionReveal(');
  const methodEnd = source.indexOf('    protected async seek(', methodStart);
  const compiled = ts.transpileModule(`class RevealHarness { ${source.slice(methodStart, methodEnd)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const frames = [];
  const RevealHarness = new Function('requestAnimationFrame', 'selectionScrollTop',
    `${compiled}; return RevealHarness;`)(callback => { frames.push(callback); return frames.length; }, () => 200);
  const widget = new RevealHarness();
  Object.assign(widget, {
    isVisible: false, selection: { selected: ['a'], anchorId: 'a' }, selectionRevealFrame: 0,
    selectionRevealInterrupted: false, selectionRevealTargetId: 'a',
    elements: new Map([['a', { root: { classList: { contains: () => false },
      getBoundingClientRect: () => ({ top: 300, bottom: 330 }) } }]]),
    rowsNode: { scrollTop: 100, style: { scrollBehavior: '' },
      getBoundingClientRect: () => ({ top: 0, bottom: 150 }) }, dockKind: undefined
  });
  widget.scheduleSelectionReveal();
  assert.equal(frames.length, 0);
  widget.isVisible = true;
  widget.scheduleSelectionReveal();
  assert.equal(frames.length, 1);
  frames[0]();
  assert.equal(widget.rowsNode.scrollTop, 200);
});

function selectionHarness() {
  const start = source.indexOf('    protected setSelection(');
  const end = source.indexOf('    protected updateQcSummary(', start);
  const revealStart = source.indexOf('    protected scheduleSelectionReveal(');
  const revealEnd = source.indexOf('    protected async seek(', revealStart);
  assert.ok(start >= 0 && end > start && revealStart >= 0 && revealEnd > revealStart);
  const compiled = ts.transpileModule(`class SelectionHarness {
    ${source.slice(start, end)} ${source.slice(revealStart, revealEnd)}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const frames = new Map();
  let nextFrame = 0;
  const SelectionHarness = new Function('planSelectionUpdate', 'cancelAnimationFrame',
    'requestAnimationFrame', 'selectionScrollTop', `${compiled}; return SelectionHarness;`)(
    (previous, next) => ({ add: next.selected.filter(id => !previous.selected.includes(id)),
      remove: previous.selected.filter(id => !next.selected.includes(id)) }),
    id => frames.delete(id), callback => { frames.set(++nextFrame, callback); return nextFrame; },
    (top, bottom, viewportTop, viewportBottom, current) =>
      top >= viewportTop && bottom <= viewportBottom ? null : 180
  );
  const widget = new SelectionHarness();
  const rowIds = Array.from({ length: 80 }, (_, i) => `r${i + 1}`);
  const roots = new Map(rowIds.map((id, index) => [id, { root: {
    classList: { add() {}, remove() {}, contains: () => false },
    getBoundingClientRect: () => ({ top: index === 9 ? -2800 : 80, bottom: index === 9 ? -2760 : 120 })
  } }]));
  const dockContent = [];
  Object.assign(widget, {
    isVisible: true, selection: { selected: ['r10'], anchorId: 'r10' },
    elements: roots, rowsNode: { scrollTop: 3000, style: { scrollBehavior: '' },
      getBoundingClientRect: () => ({ top: 0, bottom: 200 }) },
    selectionRevealFrame: 0, selectionRevealInterrupted: false,
    dockKind: undefined, altAll: false,
    placedEditor: { classList: { contains: () => true }, offsetHeight: 50 },
    rowsRegion: { getBoundingClientRect: () => ({ bottom: 200 }) },
    renderDock() { dockContent.push(this.selection.selected.join(',')); }, renderActionBar() {}, closeDock() {}
  });
  const flush = () => { while (frames.size) {
    const batch = [...frames.values()]; frames.clear(); for (const callback of batch) callback();
  } };
  return { widget, rowIds, flush, dockContent };
}

test('local Shift range and Ctrl+A preserve scrollTop 3000', () => {
  const { widget, rowIds, flush } = selectionHarness();
  widget.setSelection({ selected: rowIds.slice(9), anchorId: 'r10' }, false);
  flush();
  assert.equal(widget.rowsNode.scrollTop, 3000, 'Shift range must not reveal its anchor');
  widget.setSelection({ selected: rowIds, anchorId: null }, false);
  flush();
  assert.equal(widget.rowsNode.scrollTop, 3000, 'select all must not reveal the first row');
});

test('Ctrl toggle from two rows back to one does not reveal a distant survivor', () => {
  const { widget, flush } = selectionHarness();
  widget.setSelection({ selected: ['r10', 'r80'], anchorId: 'r80' }, false);
  flush();
  assert.equal(widget.rowsNode.scrollTop, 3000);
  widget.setSelection({ selected: ['r10'], anchorId: 'r80' }, false);
  flush();
  assert.deepEqual(widget.selection, { selected: ['r10'], anchorId: 'r80' });
  assert.equal(widget.rowsNode.scrollTop, 3000);
});

test('an open row dock renders a changed selection without forcing its anchor into view', () => {
  const { widget, rowIds, flush, dockContent } = selectionHarness();
  widget.dockKind = 'row';
  widget.setSelection({ selected: rowIds.slice(9, 12), anchorId: 'r10' }, false);
  flush();
  assert.deepEqual(dockContent, ['r10,r11,r12']);
  assert.equal(widget.rowsNode.scrollTop, 3000);
});

test('manual scroll interruption is reset by a changed selection', () => {
  const { widget, flush } = selectionHarness();
  const scrollStart = source.indexOf("        this.rowsNode.addEventListener('scroll', () => {");
  const scrollEnd = source.indexOf('        this.toDispose.push(', scrollStart);
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart);
  const compiled = ts.transpileModule(`class ScrollHarness { attach() {
    ${source.slice(scrollStart, scrollEnd)}
  } }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const ScrollHarness = new Function('Date', 'cancelAnimationFrame', `${compiled}; return ScrollHarness;`)(
    { now: () => 1234 }, () => undefined);
  const scroll = new ScrollHarness();
  Object.assign(scroll, { rowsNode: { addEventListener: (_, callback) => { scroll.fire = callback; } },
    autoScrolling: false, selectionRevealFrame: 0, selectionRevealInterrupted: false });
  scroll.attach(); scroll.fire();
  assert.equal(scroll.selectionRevealInterrupted, true);
  assert.equal(scroll.lastUserScrollAt, 1234);
  widget.selectionRevealInterrupted = scroll.selectionRevealInterrupted;
  widget.setSelection({ selected: ['r11'], anchorId: 'r11' }, false);
  flush();
  assert.equal(widget.selectionRevealInterrupted, false);
});
