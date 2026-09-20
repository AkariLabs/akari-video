import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = await readFile(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const contribution = await readFile(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('    async focusTarget('), source.indexOf('    showError('));
const calls = ['scrollIntoView', 'setSelection', 'openWordBar', 'openGearPop',
  'openCutRangeEditorForSelection', 'openTplPicker', 'openWordPresetPicker', 'openDisplayPop',
  'openHistoryPop', 'openSilenceBatch', 'applyQcFilter', 'triggerFocusPulse'];

test('external focus uses existing selection and panel actions', () => {
  for (const name of calls) assert.match(method, new RegExp(`\\b${name}\\(`));
  assert.match(source, /installStyle\(\);\s*installDaihonFocusPulseStyle\(\)/u);
});

test('commands forward optional requests after activating their widgets', () => {
  assert.match(contribution, /execute: \(target\?: DaihonOpenTarget\) => this\.open\(target\)/u);
  assert.match(contribution, /execute: \(request\?: \{ candidateId\?: string \}\) => this\.openCuts\(request\)/u);
  assert.match(contribution, /async open\(target\?: DaihonOpenTarget\): Promise<boolean>[\s\S]*?activateWidget\(widget.id\);\s*return target \? widget.focusTarget\(target\) : true/u);
  assert.match(contribution, /async openCuts\(request\?: \{ candidateId\?: string \}\): Promise<boolean>[\s\S]*?activateWidget\(widget.id\);\s*return request\?\.candidateId \? widget.focusCandidate\(request.candidateId\) : true/u);
});

test('cut range opening is guarded by a valid range and otherwise explains the prerequisite', () => {
  const branch = method.slice(method.indexOf("case 'cutRange':"), method.indexOf('if (target.speaker'));
  assert.match(branch, /if \(validWordRange\) this.openCutRangeEditorForSelection\(\);\s*else \{\s*this.notify\(/u);
  assert.match(branch, /success = false/u);
  assert.equal([...branch.matchAll(/this\.openCutRangeEditor\w*\(/gu)].length, 1);
});

// Exercise the actual method without constructing the shell or loading its services.
const compiled = ts.transpileModule(`class FocusHarness { ${method} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const helpers = require('../lib/common/daihon-focus-target.js');
const { resolveCurrent } = require('../lib/common/daihon-time-map.js');
const FocusHarness = new Function('resolveDaihonFocusRowId', 'isValidDaihonWordRange', 'resolveCurrent', 'triggerFocusPulse',
  `${compiled}; return FocusHarness;`)(helpers.resolveDaihonFocusRowId, helpers.isValidDaihonWordRange,
  resolveCurrent, root => { root.pulsed = true; });

function fixture() {
  const widget = new FocusHarness();
  const events = [];
  const root = { hidden: false, scrollIntoView() { assert.equal(this.hidden, false); events.push('scroll'); },
    querySelector: () => ({}) };
  Object.assign(widget, {
    configured: true, reloadTail: Promise.resolve(),
    rows: [{ id: 'a', speaker: 'A', outStart: 0, outEnd: 2, words: [{}, {}] }],
    elements: new Map([['a', { root, words: [{}, {}] }]]),
    speakerFilter: null, qcFilter: false, wordRanges: [],
    notify(message) { events.push(message); },
    applyQcFilter() { root.hidden = this.qcFilter || (this.speakerFilter !== null && this.speakerFilter !== 'A'); },
    setSelection(next) { this.selection = next; events.push('selection'); },
    renderWordSelection() { events.push('renderWordSelection'); },
    async configure() { events.push('configure'); this.configured = true; }
  });
  for (const name of calls.filter(name => name.startsWith('open'))) widget[name] = () => events.push(name);
  return { widget, root, events };
}

test('conflicting speaker does not filter a resolved row and the row remains visible', async () => {
  for (const target of [{ captionId: 'a' }, { atSeconds: 0 }]) {
    const { widget, root } = fixture();
    widget.speakerFilter = 'B';
    widget.qcFilter = true;
    widget.applyQcFilter();
    assert.equal(root.hidden, true);
    assert.equal(await widget.focusTarget({ ...target, speaker: 'B', pulse: true }), true);
    assert.equal(widget.speakerFilter, null);
    assert.equal(root.hidden, false);
    assert.equal(root.pulsed, true);
    assert.deepEqual(widget.selection, { selected: ['a'], anchorId: 'a' });
  }
});

test('speaker-only requests filter, while empty requests do nothing', async () => {
  const { widget, root, events } = fixture();
  assert.equal(await widget.focusTarget(), true);
  assert.equal(await widget.focusTarget({}), true);
  assert.deepEqual(events, []);
  assert.equal(await widget.focusTarget({ speaker: 'B' }), true);
  assert.equal(widget.speakerFilter, 'B');
  assert.equal(root.hidden, true);
});

test('row and word templates choose the appropriate picker after selecting', async () => {
  for (const wordRange of [undefined, { from: 0, to: 1 }]) {
    const { widget, events } = fixture();
    assert.equal(await widget.focusTarget({ captionId: 'a', wordRange, open: 'template' }), true);
    const picker = wordRange ? 'openWordPresetPicker' : 'openTplPicker';
    assert.ok(events.indexOf(picker) > events.indexOf('selection'));
    assert.equal(events.includes('openWordBar'), !!wordRange);
  }
});

test('cut range requires the current request to supply valid words, ignoring stale selections', async () => {
  for (const wordRange of [undefined, { from: 1, to: 0 }, { from: 0, to: 1 }]) {
    const { widget, events } = fixture();
    const previousRanges = [{ row: 'a', a: 0, b: 1 }];
    widget.wordRanges = previousRanges;
    const valid = wordRange?.to === 1;
    assert.equal(await widget.focusTarget({ captionId: 'a', wordRange, open: 'cutRange' }), valid);
    assert.equal(events.includes('openCutRangeEditorForSelection'), valid);
    assert.equal(events.includes('renderWordSelection'), valid);
    if (!valid) assert.equal(widget.wordRanges, previousRanges);
  }
});

test('missing rows return false but independent panels still open', async () => {
  for (const [open, action] of [['display', 'openDisplayPop'], ['history', 'openHistoryPop'], ['silenceBatch', 'openSilenceBatch']]) {
    const { widget, events } = fixture();
    assert.equal(await widget.focusTarget({ captionId: 'missing', open }), false);
    assert.ok(events.includes(action));
    assert.equal(widget.selection, undefined);
  }
  const { widget } = fixture();
  assert.equal(await widget.focusTarget({ atSeconds: 9 }), false);
  assert.equal(await widget.focusTarget({ open: 'gear' }), false);
  assert.equal(await widget.focusTarget({ open: 'unknown' }), true);
  assert.equal(await widget.focusTarget({ open: 'qc' }), true);
  assert.equal(widget.qcFilter, true);
});

test('focus waits for configuration or queued reloads before resolving rows', async () => {
  const { widget, events } = fixture();
  widget.configured = false;
  assert.equal(await widget.focusTarget({ captionId: 'a' }), true);
  assert.equal(events[0], 'configure');
  widget.rows = [];
  widget.reloadTail = Promise.resolve().then(() => { widget.rows = [{ id: 'b' }]; });
  assert.equal(await widget.focusTarget({ captionId: 'b' }), true);
  assert.equal(widget.selection.anchorId, 'b');
});
