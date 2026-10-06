import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { initialDaihonCutReview, reviewCandidates, setCutDecision, setKindDecision, willCut,
  confirmDaihonCutReview } = require('../lib/common/daihon-cut-review.js');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const contributionSource = readFileSync(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'utf8');
const openStart = source.indexOf('    async openCutDialog(');
const historyStart = source.indexOf('    protected async withHistory(');
assert.ok(openStart >= 0 && historyStart >= 0);
const openMethod = source.slice(openStart, source.indexOf('    protected openTplPicker(', openStart));
const historyMethod = source.slice(historyStart, source.indexOf('    protected async applyWordPreset(', historyStart));
const compiled = ts.transpileModule(`class CutHarness { ${openMethod} ${historyMethod} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const contributionMethod = contributionSource.slice(contributionSource.indexOf('    async openCuts('),
  contributionSource.indexOf('    async open(target?', contributionSource.indexOf('    async openCuts(')));
const compiledContribution = ts.transpileModule(`class ContributionHarness { ${contributionMethod} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

const candidates = [
  { id: 'filler:a:0', kind: 'filler', start: .2, end: .4, text: 'あの', rowId: 'a', sourceId: 'source-1' },
  { id: 'filler:a:1', kind: 'filler', start: .5, end: .6, text: 'えー', rowId: 'a', sourceId: 'source-1' },
  { id: 'silence:a:b', kind: 'silence', start: 1, end: 1.8, text: '無音', rowId: 'a', sourceId: 'source-1' },
  { id: 'redo:b:0', kind: 'redo', start: 2, end: 2.2, text: '言い直し', rowId: 'b', sourceId: 'source-1' },
  { id: 'unrecognized:b:0', kind: 'unrecognized', start: 2.3, end: 2.5, text: '??', rowId: 'b', sourceId: 'source-1' }
];

function harness(neverClose = false) {
  let dialog, writes = 0, reloads = 0, edit = 'before';
  const history = [];
  class Dialog {
    constructor(items, _context, _preview, apply, _undo, updateSilence) {
      dialog = this;
      this.candidates = items;
      this.apply = apply;
      this.updateSilence = updateSilence;
      this.state = initialDaihonCutReview();
    }
    async open() { if (neverClose) return new Promise(() => {}); }
    close() { this.closed = true; }
    setKind(kind, enabled) { this.state.kinds[kind] = enabled; }
    toggle(candidate, cut) { this.state = setCutDecision(this.state, candidate.id, cut); }
    allCut(kind) { this.state = setKindDecision(this.state, this.candidates, kind, true); }
    allKeep() { this.state = setKindDecision(this.state, this.candidates, 'all', false); }
    async confirm() { this.state = await confirmDaihonCutReview(this.state, this.candidates, this.apply); }
  }
  const CutHarness = new Function('AkariDaihonCutDialog', 'normalizeCutRanges', 'daihonHistoryService',
    'DAIHON_SILENCE_MIN_PREFERENCE', 'DAIHON_SILENCE_KEEP_PREFERENCE', 'PreferenceScope',
    `${compiled}; return CutHarness;`)(Dialog, ranges => ranges, () => ({ push: entry => history.push(entry) }),
      'silence.min', 'silence.keep', { Workspace: 'workspace' });
  const widget = new CutHarness();
  Object.assign(widget, {
    configured: true, reloadTail: Promise.resolve(), rows: [{ id: 'a', text: 'あの話' }, { id: 'b', text: '次の話' }],
    collectCutCandidates: () => candidates, rootUri: { toString: () => 'root' },
    editUri: { toString: () => 'edit' }, captionsUri: { toString: () => 'captions' },
    silenceMin: .45, silenceKeep: .15,
    readText: async uri => uri.toString() === 'edit' ? edit : 'captions-before',
    preferences: { async set() {} }, updateCutsButton() {}, refreshRowGapChips() {},
    annotationsService: { async applyCutRanges(request) {
      writes++;
      assert.ok(request.ranges.length > 0);
      assert.ok(request.ranges.every(range => range.captionId === 'source-1'));
      edit = 'after';
      return { beforeSource: 'before' };
    } },
    rememberCut() {}, async reload() { reloads++; }
  });
  return { widget, get dialog() { return dialog; }, history, get writes() { return writes; }, get reloads() { return reloads; } };
}

test('openCutDialog and openCuts resolve while dialog.open remains unresolved', async () => {
  const run = harness(true);
  const contribution = new Function(`${compiledContribution}; return ContributionHarness;`)();
  const command = new contribution();
  command.ensureWidget = async () => ({ id: 'daihon', openCutDialog: request => run.widget.openCutDialog(request) });
  command.shell = { async activateWidget() {} };
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error('dialog close was awaited')), 1000); });
  try {
    assert.equal(await Promise.race([run.widget.openCutDialog({ candidateId: 'filler:a:0' }), deadline]), true);
    assert.equal(await Promise.race([command.openCuts({ candidateId: 'filler:a:0' }), deadline]), true);
    assert.equal(await Promise.race([command.openCuts({ candidateId: 'missing' }), deadline]), false);
  } finally { clearTimeout(timer); }
});

test('opening, reviewing, changing silence threshold, and closing without confirmation writes nothing', async () => {
  const run = harness();
  assert.equal(await run.widget.openCutDialog(), true);
  const dialog = run.dialog;
  dialog.setKind('redo', true);
  dialog.setKind('silence', false);
  dialog.toggle(candidates[0], false);
  dialog.allCut('filler');
  assert.ok(candidates.filter(candidate => candidate.kind === 'filler').every(candidate => willCut(dialog.state, candidate)));
  dialog.allKeep();
  assert.ok(reviewCandidates(dialog.state, candidates).every(candidate => !willCut(dialog.state, candidate)));
  dialog.allCut('filler');
  await dialog.updateSilence(1, .2);
  assert.equal(run.widget.silenceMin, 1);
  assert.equal(run.widget.silenceKeep, .2);
  dialog.close();
  assert.equal(dialog.closed, true);
  assert.equal(run.writes, 0);
  assert.equal(run.history.length, 0);
});

test('confirmation calls applyCutRanges once and the widget withHistory pushes one entry', async () => {
  const run = harness();
  assert.equal(await run.widget.openCutDialog(), true);
  await run.dialog.confirm();
  assert.equal(run.dialog.state.step, 2);
  assert.equal(run.writes, 1);
  assert.equal(run.history.length, 1);
  assert.equal(run.reloads, 1);
});
