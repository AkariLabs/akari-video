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
const Harness = new Function('URI', 'clearSelection', `${code}; return Harness;`)(
  class { constructor(value) { this.value = value; } normalizePath() { return this; }
    toString() { return this.value.replace('/./', '/'); } },
  () => ({ selected: [], anchorId: null })
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
    openRowDock() { calls.push(['openDock']); },
    applicationShell: { activateWidget() { calls.push(['activate']); } },
    rowsNode: { focus() { calls.push(['focus']); } },
    applyQcFilter() { calls.push(['filter']); }
  });
  const send = (ids, primary = null, editUri = 'file:///p/./edit.json') => widget.receive({
    detail: { editUri, captionIds: ids, primaryCaptionId: primary }
  });
  return { widget, calls, roots, send };
}

test('external caption selection projects primary row without echo or keyboard focus', () => {
  const { widget, calls, send } = fixture();
  send(['a', 'b', 'c'], 'b');
  assert.deepEqual(widget.selection, { selected: ['a', 'b', 'c'], anchorId: 'b' });
  assert.deepEqual(calls, [['selection', { selected: ['a', 'b', 'c'], anchorId: 'b' }, false]]);
  send(['a', 'b', 'c'], 'b');
  assert.equal(calls.length, 1, 'identical round trip must not select again');
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
  roots.get('a').root.classList.contains = name => name === 'speaker-hidden';
  send(['a']);
  assert.equal(widget.qcFilter, false);
  assert.equal(widget.speakerFilter, null);
  assert.ok(calls.some(([name]) => name === 'filter'));
});

test('manual scroll suppresses later dock or resize reveal until the selection changes', () => {
  const methodStart = source.indexOf('    protected scheduleSelectionReveal(): void {');
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
    selectionRevealInterrupted: true,
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
  const methodStart = source.indexOf('    protected scheduleSelectionReveal(): void {');
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
    selectionRevealInterrupted: false,
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
