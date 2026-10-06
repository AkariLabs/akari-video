import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { planDaihonUpdate } = require('../lib/common/daihon-reconcile.js');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf('    protected renderRows(next: DaihonRow[], refreshCutMarks = false): void {');
assert.ok(start >= 0);
const method = source.slice(start, source.indexOf('    protected placedRanges(', start));
const compiled = ts.transpileModule(`class RenderHarness { ${method} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const RenderHarness = new Function('planDaihonUpdate', 'speakerColorMap', 'normalizeWordRanges', 'pruneSelection',
  `${compiled}; return RenderHarness;`)(planDaihonUpdate, () => new Map(), ranges => ranges, selection => selection);

test('cut mark OFF/ON recreates unchanged row DOM and restores the existing cut cell', () => {
  assert.match(source, /this\.renderRows\(buildDaihonRows\(this\.daihonCaptionsForDisplay\(\), this\.segments\), true\)/);
  const row = { id: 'a', speaker: null, words: null, unrecognized: [] };
  const harness = new RenderHarness();
  const markNames = ['filler', 'redo', 'unrecognized', 'gap'];
  const makeRoot = visible => ({ marks: Object.fromEntries(markNames.map(name => [name, visible])),
    nextSibling: null, querySelector() { return null; }, replaceWith(next) { harness.rowsNode.current = next; } });
  let created = 0, cutCellVisible = true;
  harness.rowsNode = {
    current: makeRoot(true),
    querySelectorAll(selector) { return selector === '.akari-daihon-cutcell'
      ? [{ remove() { cutCellVisible = false; } }] : []; },
    querySelector() { return null; }, insertBefore(node) { this.current = node; }, appendChild(node) { this.current = node; }
  };
  harness.elements = new Map([['a', { root: harness.rowsNode.current }]]);
  Object.assign(harness, { rows: [row], showCutMarks: true, speakerFilter: null, wordRanges: [], selection: {},
    closeCutRangeEditor() {}, rowGapsForRows: () => [],
    createRow() { created++; return { root: makeRoot(this.showCutMarks), words: [] }; },
    renderWordSelection() {}, setSelection() {}, updateSourceBand() {}, updateQcSummary() {}, applyQcFilter() {},
    renderCutCells() { cutCellVisible = true; }, renderPlacedText() {}
  });
  harness.renderRows([row]);
  assert.equal(created, 0, 'unchanged data normally reuses its row');
  harness.showCutMarks = false;
  harness.renderRows([row], true);
  assert.equal(created, 1);
  assert.ok(Object.values(harness.elements.get('a').root.marks).every(value => value === false));
  assert.equal(cutCellVisible, true);
  harness.showCutMarks = true;
  harness.renderRows([row], true);
  assert.equal(created, 2);
  assert.ok(Object.values(harness.elements.get('a').root.marks).every(value => value === true));
  assert.equal(cutCellVisible, true);
});
