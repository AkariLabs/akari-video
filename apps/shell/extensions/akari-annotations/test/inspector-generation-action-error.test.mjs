import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const names = ['appendRow', 'generationIdentity'];
const bodies = widget.members.filter(node => names.includes(node.name?.getText(ast))).map(node => node.getText(ast));
assert.equal(bodies.length, names.length);
class Element {
  constructor() { this.children = []; this.listeners = new Map(); this.attributes = new Map(); this.isConnected = true; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  prepend(child) { child.parent = this; this.children.unshift(child); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  addEventListener(key, callback) { if (!this.listeners.has(key)) this.listeners.set(key, new Set()); this.listeners.get(key).add(callback); }
  removeEventListener(key, callback) { this.listeners.get(key)?.delete(callback); }
  dispatch(key) { for (const callback of [...this.listeners.get(key) ?? []]) callback(); }
  querySelectorAll(selector) { return this.children.flatMap(child => [child, ...child.all()]).filter(child => child.className?.split(' ').includes(selector.slice(1))); }
  all() { return this.children.flatMap(child => [child, ...child.all()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
}
const code = ts.transpileModule(`class Harness { ${bodies.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('document', `${code}; return Harness;`)({ createElement: () => new Element() });
const settle = () => new Promise(resolve => setImmediate(resolve));
const errorSelector = '.akari-inspector-generation-action-error';
function setup() {
  const w = new Harness();
  w.body = new Element();
  w.model = { snapshot: { kind: 'cut', itemId: 'a', sourcePath: 'still.png', outputStart: 0, outputEnd: 6 } };
  w.generationDrafts = new Map([['a', { inputs: { prompt: 'move' } }]]);
  w.notices = []; w.showFieldNotice = message => w.notices.push(message);
  let outcome = { ok: false, message: 'この素材には生成の記録がありません。' };
  const field = { name: 'generation-actions', actions: [{ name: 'generate', label: '動画にする', action: async () => outcome }] };
  w.render = () => { w.body.children = []; w.appendRow(w.body, field, w.model.snapshot, 'cut'); };
  w.render();
  return { w, setOutcome: value => { outcome = value; }, button: () => w.body.all().find(element => element.getAttribute('data-akari-generation-action') === 'generate') };
}

test('ok:false はボタン直上に赤文言を描画し、再描画しても残る（既存通知も維持）', async () => {
  const { w, button } = setup();
  button().dispatch('click'); await settle();
  const error = w.body.querySelector(errorSelector);
  assert.equal(error.textContent, w.notices[0]);
  assert.equal(error.getAttribute('role'), 'alert');
  assert.match(error.className, /akari-inspector-generation-error/);
  const footer = error.parent;
  assert.equal(footer.children[0], error);
  assert.ok(footer.children[1].all().includes(button()));
  w.render();
  assert.equal(w.body.querySelector(errorSelector).textContent, error.textContent);
  assert.match(source, /\.akari-inspector-generation-error\s*\{\s*color: var\(--theia-errorForeground\)/);
});
for (const event of ['click', 'input', 'change']) test(`次の ${event} で消え、再描画でも復活しない`, async () => {
  const { w, button } = setup();
  button().dispatch('click'); await settle();
  w.body.dispatch(event);
  assert.equal(w.generationActionError, undefined);
  assert.equal(w.body.querySelector(errorSelector), undefined);
  w.render(); assert.equal(w.body.querySelector(errorSelector), undefined);
  for (const listeners of w.body.listeners.values()) assert.equal(listeners.size, 0);
});
test('下書きの変更と別 item への切替でも消える', async () => {
  for (const change of [w => { w.generationDrafts.get('a').inputs.prompt = 'new'; }, w => { w.model.snapshot.itemId = 'b'; }]) {
    const { w, button } = setup();
    button().dispatch('click'); await settle();
    change(w); w.render();
    assert.equal(w.body.querySelector(errorSelector), undefined);
  }
});
test('成功した次の操作は古いエラーを残さない', async () => {
  const { w, button, setOutcome } = setup();
  button().dispatch('click'); await settle();
  setOutcome({ ok: true }); button().dispatch('click'); await settle();
  assert.equal(w.body.querySelector(errorSelector), undefined);
  assert.equal(w.notices.length, 1);
});
