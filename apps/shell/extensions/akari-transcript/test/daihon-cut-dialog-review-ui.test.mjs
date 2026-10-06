import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { initialDaihonCutReview, reviewCandidates, chosenCandidates, setCutDecision,
  setKindDecision, willCut, confirmDaihonCutReview } = require('../lib/common/daihon-cut-review.js');
const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-cut-dialog.ts', import.meta.url), 'utf8');
const method = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const methods = method('    protected render(): void', '    protected renderSearch(): void')
  + method('    protected renderReview(): void', '    protected async confirm(): Promise<void>')
  + method('    protected async confirm(): Promise<void>', '    protected renderDone(): void')
  + source.slice(source.indexOf('    protected onReviewKey('), source.lastIndexOf('\n}'));
const compiled = ts.transpileModule(`class ReviewHarness { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

const document = { activeElement: null, body: null };
class FakeNode {
  constructor(tag, text = '') { this.tagName = tag.toUpperCase(); this.textContent = text; this.children = []; this.style = {}; }
  append(...children) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  replaceChildren(...children) {
    if (this.contains(document.activeElement)) document.activeElement = document.body;
    this.children = [];
    this.append(...children);
  }
  contains(node) { return !!node && (node === this || this.children.some(child => child.contains(node))); }
  focus() { document.activeElement = this; }
  setAttribute() {}
}
class FakeInput extends FakeNode { constructor() { super('input'); } }
document.body = new FakeNode('body');
const element = (tag, text) => new FakeNode(tag, text);
const button = (label, action) => { const node = element('button', label); node.onclick = action; return node; };
const ReviewHarness = new Function('element', 'button', 'document', 'HTMLInputElement',
  'reviewCandidates', 'chosenCandidates', 'setCutDecision', 'setKindDecision', 'willCut',
  'confirmDaihonCutReview', 'DAIHON_CUT_KINDS', 'COLORS', 'LABELS', 'formatTime', `${compiled}; return ReviewHarness;`)(
    element, button, document, FakeInput, reviewCandidates, chosenCandidates, setCutDecision,
    setKindDecision, willCut, confirmDaihonCutReview, ['silence', 'filler', 'redo', 'unrecognized'],
    { filler: 'orange', redo: 'purple' }, { filler: 'フィラー', redo: '言い直し' }, value => String(value));

const candidates = [
  { id: 'f', kind: 'filler', start: 0, end: .2, text: 'えー' },
  { id: 'r', kind: 'redo', start: 1, end: 1.3, text: 'まず音を' }
];
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function setup() {
  const dialog = new ReviewHarness();
  dialog.node = new FakeNode('div'); dialog.node.isConnected = true;
  dialog.steps = new FakeNode('nav'); dialog.body = new FakeNode('div'); dialog.foot = new FakeNode('div');
  dialog.notice = new FakeNode('p');
  dialog.node.append(dialog.steps, dialog.body, dialog.foot);
  dialog.state = initialDaihonCutReview(); dialog.state.step = 1; dialog.state.kinds.redo = true;
  dialog.state.currentId = 'f'; dialog.candidates = candidates;
  dialog.context = candidate => ['', candidate.text, 'の続き'];
  dialog.preview = (...args) => dialog.previewCalls.push(args);
  dialog.previewCalls = []; dialog.busy = false; dialog.renderDone = () => {};
  return dialog;
}

test('review redraw restores dialog focus and J/K/X/Space work after a button disappears', () => {
  assert.match(source, /this\.node\.tabIndex = -1/);
  const dialog = setup();
  const oldButton = button('見直す', () => {}); dialog.foot.append(oldButton);
  document.activeElement = oldButton;
  dialog.render();
  assert.equal(document.activeElement, dialog.node);
  const key = (key, code = '') => {
    let prevented = false;
    dialog.onReviewKey({ target: document.activeElement, key, code, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  key('j'); assert.equal(dialog.state.currentId, 'r');
  key('x'); assert.equal(willCut(dialog.state, candidates[1]), true);
  key(' ', 'Space'); assert.deepEqual(dialog.previewCalls, [[candidates[1], true]]);
  key('k'); assert.equal(dialog.state.currentId, 'f');
  dialog.onReviewKey({ target: new FakeInput(), key: 'x', code: 'KeyX', preventDefault() { throw Error('input consumed'); } });
  assert.equal(willCut(dialog.state, candidates[0]), true);
});

test('kept candidate text has no strike and is dim; cutting restores its strike', () => {
  const dialog = setup(); dialog.render();
  const marked = text => descendants(dialog.body).find(node => node.textContent === text && ['S', 'SPAN'].includes(node.tagName));
  assert.equal(marked('えー').tagName, 'S');
  assert.equal(marked('まず音を').tagName, 'SPAN');
  assert.equal(marked('まず音を').parent.parent.style.opacity, '.55');
  dialog.state = setCutDecision(dialog.state, 'r', true); dialog.render();
  assert.equal(marked('まず音を').tagName, 'S');
  assert.equal(marked('まず音を').parent.parent.style.opacity, '1');
});

test('confirmed step disables every step heading and cannot go back through its callback', () => {
  const dialog = setup(); dialog.state.step = 2; dialog.render();
  assert.deepEqual(dialog.steps.children.map(step => step.disabled), [true, true, true]);
  dialog.steps.children[0].onclick();
  assert.equal(dialog.state.step, 2);
});

test('apply=false explains that nothing changed; errors show only their message', async () => {
  const dialog = setup();
  dialog.apply = async () => false;
  await dialog.confirm();
  assert.equal(dialog.state.step, 1);
  assert.equal(dialog.notice.textContent, '変更はありませんでした。');
  dialog.apply = async () => { throw Error('範囲が見つかりません'); };
  await dialog.confirm();
  assert.equal(dialog.notice.textContent, '範囲が見つかりません');
  dialog.apply = async () => { throw '文字列の失敗'; };
  await dialog.confirm();
  assert.equal(dialog.notice.textContent, '文字列の失敗');
});
