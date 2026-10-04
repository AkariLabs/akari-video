import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import { isEditableEventTarget, isImeCompositionKeydown } from 'akari-preview/lib/common/review-tool-mode.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const keybindingsSource = readFileSync(process.env.AKARI_SHORTCUT_KEYBINDINGS_SOURCE
  || new URL('../src/browser/akari-shortcut-keybindings.ts', import.meta.url), 'utf8');
const shortcutsSource = readFileSync(new URL('../src/browser/akari-shortcuts.ts', import.meta.url), 'utf8');
const shortcutsModule = { exports: {} };
new Function('exports', ts.transpileModule(shortcutsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText)(shortcutsModule.exports);
const playback = shortcutsModule.exports.AKARI_SHORTCUTS.find(item => item.command.id === 'akari.timeline.togglePlayback');
assert.deepEqual(playback.keys, ['space']);

const file = ts.createSourceFile('keybindings.ts', keybindingsSource, ts.ScriptTarget.Latest, true);
const declaration = file.statements.find(node => ts.isClassDeclaration(node)
  && node.name?.text === 'AkariShortcutKeybindings');
const start = declaration?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'start');
assert.ok(start, 'shortcut context refresh method exists');
const harnessSource = ts.transpileModule(`class Harness { ${start.getText(file)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;

class Element {
  constructor(tagName, { classes = [], parent = null, tabIndex = false, contentEditable = false } = {}) {
    this.tagName = tagName;
    this.classes = new Set(classes);
    this.parent = parent;
    this.tabIndex = tabIndex;
    this.isContentEditable = contentEditable;
  }
  matches(selector) { return selector.startsWith('.') && this.classes.has(selector.slice(1)); }
  closest(selector) {
    for (let node = this; node; node = node.parent) {
      if (selector === 'button, [role="button"], [tabindex]') {
        if (node.tagName === 'BUTTON' || node.tabIndex) return node;
      } else if (node.matches(selector)) return node;
    }
    return null;
  }
}

function probe(focused, { composing = false, modal = false, captionEditing = false } = {}) {
  const contexts = {};
  const body = new Element('BODY');
  const document = {
    body, activeElement: focused,
    querySelectorAll(selector) {
      if (selector.includes('aria-modal') && modal) {
        return [{ getClientRects: () => [1] }];
      }
      return [];
    },
    querySelector: () => null
  };
  let keydown;
  const window = {
    addEventListener: (_, callback) => { keydown = callback; },
    removeEventListener() {}, getSelection: () => ({ toString: () => '' })
  };
  const Harness = new Function('window', 'document', 'HTMLElement', 'Disposable',
    'isEditableEventTarget', 'isImeCompositionKeydown', 'captionEditFocusWithinMarkedWidget',
    'getComputedStyle', `${harnessSource}; return Harness;`)(
    window, document, Element, { create: dispose => ({ dispose }) },
    isEditableEventTarget, isImeCompositionKeydown,
    element => captionEditing && element === focused, () => ({ visibility: 'visible' })
  );
  const owner = new Harness();
  const widget = { node: { contains: () => false }, canRunRegisteredShortcut: () => false };
  owner.shortcutTimelineWidget = () => widget;
  owner.deps = {
    contextKeys: { setContext: (name, value) => { contexts[name] = value; } },
    history: { handleKeydown() {} }
  };
  owner.start();
  keydown({ key: ' ', code: 'Space', keyCode: composing ? 229 : 32,
    isComposing: composing, target: focused });
  const names = Object.keys(contexts);
  const enabled = new Function(...names, `return Boolean(${playback.when});`)(...names.map(name => contexts[name]));
  return { enabled, contexts };
}

test('Space playback applies to the focused transcript rows, so Theia consumes the key', () => {
  const rows = new Element('DIV', { classes: ['akari-daihon-rows'], tabIndex: true });
  const { enabled, contexts } = probe(rows);
  assert.equal(contexts.akariDaihonRowsFocus, true);
  assert.equal(contexts.akariFocusOnControl, false);
  assert.equal(enabled, true);
});

test('Space playback stays disabled on buttons inside the rows and outside the transcript', () => {
  const rows = new Element('DIV', { classes: ['akari-daihon-rows'], tabIndex: true });
  for (const focused of [new Element('BUTTON', { parent: rows }), new Element('BUTTON')]) {
    const { enabled, contexts } = probe(focused);
    assert.equal(contexts.akariFocusOnControl, true);
    assert.equal(enabled, false);
  }
});

test('Space playback stays disabled while editing, composing, or showing a modal', () => {
  const rows = new Element('DIV', { classes: ['akari-daihon-rows'], tabIndex: true });
  const input = new Element('INPUT', { parent: rows });
  const editable = new Element('SPAN', { parent: rows, contentEditable: true });
  for (const focused of [input, editable]) {
    const { enabled, contexts } = probe(focused);
    assert.equal(contexts.akariEditableFocus, true);
    assert.equal(enabled, false);
  }
  assert.equal(probe(rows, { captionEditing: true }).enabled, false);
  assert.equal(probe(rows, { composing: true }).enabled, false);
  assert.equal(probe(rows, { modal: true }).enabled, false);
});

test('Theia consumes a matched playback key before Chromium can scroll the row list', async () => {
  const theia = readFileSync(require.resolve('@theia/core/lib/browser/keybinding'), 'utf8');
  const start = theia.indexOf('    executeKeyBinding(binding, event) {');
  const end = theia.indexOf('    /**', start + 1);
  assert.ok(start >= 0 && end > start);
  const Registry = new Function(`class Registry { ${theia.slice(start, end)} }; return Registry;`)();
  const registry = new Registry();
  registry.isPseudoCommand = () => false;
  const calls = [];
  registry.commandRegistry = {
    getCommand: id => ({ id }), isEnabled: () => true,
    executeCommand: id => { calls.push(id); return Promise.resolve(); }
  };
  registry.executeKeyBinding({ command: playback.command.id }, {
    preventDefault: () => calls.push('preventDefault'),
    stopPropagation: () => calls.push('stopPropagation')
  });
  await Promise.resolve();
  assert.deepEqual(calls, [playback.command.id, 'preventDefault', 'stopPropagation']);
});
