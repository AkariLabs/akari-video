import assert from 'node:assert/strict';
import test from 'node:test';
import { openPhotoEditPanel } from '../lib/browser/inspector/photo-edit-panel.js';

const reason = '背景透過は Mac でだけ使えます';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.style = {};
    this.textContent = '';
    this.disabled = false;
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  show() { this.open = true; }
  close() { this.open = false; this.onclose?.(); }
  remove() {}
  click() { if (!this.disabled) this.onclick?.(); }
}
class Dialog extends Element {}

function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children ?? []) {
    const found = find(child, predicate);
    if (found) return found;
  }
}

function withDom(run) {
  const names = ['document', 'window', 'HTMLDialogElement'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const body = new Element('body');
  const values = {
    document: {
      body, getElementById: () => null, querySelector: () => null,
      createElement: tag => tag === 'dialog' ? new Dialog(tag) : new Element(tag)
    },
    window: { innerWidth: 1200, innerHeight: 800, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} },
    HTMLDialogElement: Dialog
  };
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  try { return run(body); }
  finally {
    for (const name of names) {
      const original = originals.get(name);
      if (original) Object.defineProperty(globalThis, name, original);
      else delete globalThis[name];
    }
  }
}

function open(mode, available) {
  return withDom(body => {
    const writes = [];
    openPhotoEditPanel({ id: 'photo', mode, available,
      write: async request => { writes.push(request); return { ok: true }; } });
    return { dialog: body.children[0], writes };
  });
}

for (const [mode, names] of [
  ['cutout', ['自動', '人物だけ', '人物以外', '写っているものを押す', '選んだものを残す']],
  ['regions', ['自動', '人物だけ', '人物以外', '背景', '写っているものを押す', '選んだエリアを追加']]
]) {
  test(`${mode} panel disables helper actions with a visible reason`, () => {
    const { dialog, writes } = open(mode, false);
    assert.equal(find(dialog, node => node.tag === 'p' && node.textContent === reason)?.textContent, reason);
    for (const name of names) {
      const button = find(dialog, node => node.tag === 'button' && node.textContent === name);
      assert.ok(button, name);
      assert.equal(button.disabled, true, name);
      assert.equal(button.title, reason, name);
    }
    if (mode === 'cutout') assert.equal(find(dialog, node => node.textContent === '消しゴムで直す').disabled, false);
    assert.equal(find(dialog, node => node.textContent === '閉じる').disabled, false);
    find(dialog, node => node.tag === 'button' && node.textContent === '自動').click();
    assert.deepEqual(writes, []);
  });

  test(`${mode} panel keeps helper actions enabled when available`, () => {
    const { dialog, writes } = open(mode, true);
    for (const name of names) {
      const button = find(dialog, node => node.tag === 'button' && node.textContent === name);
      assert.ok(button, name);
      assert.equal(button.disabled, false, name);
    }
    find(dialog, node => node.tag === 'button' && node.textContent === '自動').click();
    assert.equal(writes[0]?.path, 'photo-query');
  });
}
