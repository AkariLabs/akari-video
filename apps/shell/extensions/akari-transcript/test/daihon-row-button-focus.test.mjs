import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(process.env.AKARI_TEST_DAIHON_SOURCE
  ?? new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const selector = source.match(/const ROW_BUTTON_FOCUS_SELECTOR = '([^']+)';/)?.[1];
const ast = ts.createSourceFile('akari-daihon-widget.ts', source, ts.ScriptTarget.Latest, true);
const widget = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariDaihonWidget');
const handler = widget?.members.find(node => node.name?.getText(ast) === 'handleRowButtonMouseDown');

class FakeElement {
  constructor(tag, className, parent = null) {
    this.tag = tag;
    this.className = className;
    this.parent = parent;
  }
  closest(query) {
    for (let node = this; node; node = node.parent) {
      for (const part of query.split(', ')) {
        const match = /^\.akari-daihon-row-head > button\.([\w-]+)$/.exec(part);
        if (match && node.tag === 'button' && node.className === match[1]
          && node.parent?.className === 'akari-daihon-row-head') return node;
      }
    }
    return null;
  }
}

function run(target, button = 0) {
  assert.ok(selector, 'row button selector exists');
  assert.ok(handler, 'row button mouse handler exists');
  const js = ts.transpileModule(`class Harness { ${handler.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const Harness = new Function('Element', 'ROW_BUTTON_FOCUS_SELECTOR',
    `${js}\nreturn Harness;`)(FakeElement, selector);
  const calls = [];
  const instance = new Harness();
  instance.rowsNode = { focus: options => calls.push(['focus', options]) };
  instance.handleRowButtonMouseDown({
    button, target, preventDefault: () => calls.push(['preventDefault'])
  });
  return calls;
}

test('capture listener preserves the row list focus for primary mouse clicks on five row head buttons', () => {
  assert.ok(/this\.rowsNode\.addEventListener\('mousedown', event => this\.handleRowButtonMouseDown\(event\), \{ capture: true \}\)/.test(source),
    'the capture listener is wired to the extracted handler');
  const head = new FakeElement('div', 'akari-daihon-row-head');
  for (const name of ['speaker', 'tc', 'cut', 'split', 'gear']) {
    const target = new FakeElement('button', `akari-daihon-${name}`, head);
    assert.deepEqual(run(target), [['preventDefault'], ['focus', { preventScroll: true }]], name);
    assert.deepEqual(run(target, 2), [], `${name}: secondary mouse button`);
  }
});

test('word, input, popup control, other row button and non-element targets are untouched', () => {
  const head = new FakeElement('div', 'akari-daihon-row-head');
  const popup = new FakeElement('div', 'akari-daihon-pop');
  for (const target of [
    new FakeElement('span', 'akari-daihon-word', head),
    new FakeElement('input', '', head),
    new FakeElement('button', 'akari-daihon-gear', popup),
    new FakeElement('button', 'akari-daihon-silence', head),
    new FakeElement('button', 'akari-daihon-tc'),
    null
  ]) assert.deepEqual(run(target), []);
});
