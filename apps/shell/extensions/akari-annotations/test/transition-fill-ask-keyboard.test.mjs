import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { transitionAskKey } from '../lib/common/transition-ask-key.js';

const source = fs.readFileSync(new URL('../src/browser/transition-fill-ask.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('transition-fill-ask.ts', source, ts.ScriptTarget.ES2021, true);
const declaration = ast.statements.find(statement => ts.isFunctionDeclaration(statement)
    && statement.name.text === 'createTransitionFillAsk');
assert.ok(declaration);
const compiled = ts.transpileModule(declaration.getText(ast).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

function setup() {
    const listeners = new Map();
    const document = { activeElement: null, createElement: tag => new Element(tag),
        querySelectorAll: () => [], addEventListener: on, removeEventListener: off };
    const window = { innerWidth: 800, innerHeight: 600,
        addEventListener: on, removeEventListener: off };
    function on(kind, callback) { listeners.set(kind, callback); }
    function off(kind, callback) { if (listeners.get(kind) === callback) listeners.delete(kind); }
    class Element {
        constructor(tag) {
            this.tag = tag; this.children = []; this.dataset = {}; this.style = {};
            this.listeners = new Map(); this.isConnected = true; this.offsetHeight = 80;
        }
        append(...children) { for (const child of children) {
            child.parentElement = this; this.children.push(child);
        } }
        setAttribute() {}
        addEventListener(kind, callback) { this.listeners.set(kind, callback); }
        remove() { this.isConnected = false; }
        contains(target) { return this === target || this.children.some(child => child.contains(target)); }
        focus() { document.activeElement = this; }
        click() { this.listeners.get('click')?.(); }
        getBoundingClientRect() { return { left: 20, right: 40, top: 20, bottom: 40 }; }
    }
    document.body = new Element('body');
    const anchor = new Element('button');
    const create = new Function('document', 'window', 't', 'transitionAskKey', 'anchorVisibleInClips',
        'transitionAskLayout', 'transitionPickerShieldRects', 'visibleFrameRect', 'getComputedStyle',
        'requestAnimationFrame', 'cancelAnimationFrame', `${compiled}\nreturn createTransitionFillAsk;`)(
        document, window, key => key, transitionAskKey, () => true,
        () => ({ left: 0, top: 0, width: 200, arrowLeft: 20 }), () => [], () => null,
        () => ({ overflowX: 'visible', overflowY: 'visible' }), () => 1, () => {}
    );
    const open = () => create({ anchor: () => anchor, body: 'body', action: 'attach', captionConflict: false });
    const key = (kind, value, repeat = false) => listeners.get(kind)?.({ key: value, repeat,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    const buttons = () => {
        const dialog = document.body.children[document.body.children.length - 1];
        return { body: dialog.children[1], cancel: dialog.children[2].children[0],
            confirm: dialog.children[2].children[1] };
    };
    return { document, open, key, buttons };
}

test('confirmation keys require a focused button and a nonrepeating press', async () => {
    const ui = setup();
    const first = ui.open();
    let settled = false;
    first.result.then(() => { settled = true; });
    const { body, cancel, confirm } = ui.buttons();
    // A key held down from the picker arrives as repeating presses and must not confirm.
    ui.key('keydown', 'Enter', true);
    await Promise.resolve();
    assert.equal(settled, false);
    body.parentElement.listeners.get('pointerdown')({ target: body });
    assert.equal(ui.document.activeElement, body.parentElement);
    ui.document.activeElement = body;
    ui.key('keydown', 'Enter');
    ui.key('keydown', ' ');
    ui.document.activeElement = ui.document.body;
    ui.key('keydown', 'Enter');
    ui.key('keydown', ' ');
    confirm.focus();
    ui.key('keydown', 'Enter', true);
    await Promise.resolve();
    assert.equal(settled, false);
    cancel.focus();
    ui.key('keydown', 'Enter');
    assert.equal(await first.result, false);
    const second = ui.open();
    ui.buttons().confirm.focus();
    ui.key('keydown', 'Enter');
    assert.equal(await second.result, true);
});
