import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { captionEditFocusWithinMarkedWidget } from '../lib/common/caption-edit-focus.js';

const source = ts.createSourceFile('timeline.ts', readFileSync(
    new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
let handler;
function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'keydown'
        && ts.isArrowFunction(node.initializer) && node.getStart(source) > 0) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
        if (line > 2000 && line < 3000) handler = node.initializer;
    }
    ts.forEachChild(node, visit);
}
visit(source);
assert.ok(handler);
const js = ts.transpileModule(handler.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText.trim().replace(/;$/, '');

class Element {
    constructor(parent = null, kind = 'plain', tagName = 'DIV') {
        this.parent = parent; this.kind = kind; this.tagName = tagName;
    }
    closest() {
        if (arguments[0] === '.akari-inspector-widget') return null;
        for (let current = this; current; current = current.parent) {
            if (['button', 'role-button', 'tabindex'].includes(current.kind)) return current;
        }
        return null;
    }
    contains(other) {
        for (let current = other; current; current = current.parent) if (current === this) return true;
        return false;
    }
}

function dispatch(key, { focus = 'timeline', eventTarget = focus, modal = null, selectionText = '',
    isComposing = false, keyCode = 0, metaKey = false, code = '' } = {}) {
    const counts = { play: 0, delete: 0, copy: 0, cut: 0, paste: 0,
        clear: 0, text: 0, prevented: 0, stopped: 0, flushed: 0 };
    const timeline = new Element(null, 'tabindex');
    const body = new Element();
    const elements = {
        timeline, timelineChild: new Element(timeline), timelineButton: new Element(timeline, 'button'),
        timelineRoleButton: new Element(timeline, 'role-button'),
        timelineTabStop: new Element(timeline, 'tabindex'), timelineInput: new Element(timeline, 'input'),
        outside: new Element(), body, iframe: new Element(null, 'tabindex', 'IFRAME'),
        libraryCard: new Element(null, 'tabindex'), outsideRoleButton: new Element(null, 'role-button'),
        dialogButton: new Element(null, 'button')
    };
    const document = {
        body, activeElement: elements[focus],
        querySelectorAll: selector => {
            if (selector === '[data-akari-caption-editing-focus="true"]') return [];
            assert.equal(selector, '.dialogOverlay, [aria-modal="true"]');
            if (!modal || modal === 'roleOnly') return [];
            return [{ getClientRects: () => modal === 'displayNone' ? [] : [{}],
                visibility: modal === 'visibilityHidden' ? 'hidden' : 'visible' }];
        }
    };
    const window = { getSelection: () => ({ toString: () => selectionText }) };
    const widget = {
        node: timeline, isAttached: true, selection: { kind: 'cut', index: 0 }, multiSelection: [],
        selectionModel: {}, focusScope: { rootId: null }, dragState: null,
        flushStripRender: () => { counts.flushed++; }, isEditableTarget: target => target?.kind === 'input',
        togglePreviewPlayback: () => { counts.play++; }, performDeleteSelected: () => { counts.delete++; },
        copySelectedItem: () => { counts.copy++; }, applySelection: () => { counts.clear++; },
        cutSelectedItems: () => { counts.cut++; }, pasteClipboard: () => { counts.paste++; },
        commands: { executeCommand: () => { counts.text++; } }, location: undefined
    };
    const factory = new Function('isImeCompositionKeydown', 'document', 'window', 'HTMLElement',
        'PLACE_TEXT_COMMAND_ID', 'getComputedStyle', 'captionEditFocusWithinMarkedWidget', `return function () { return (${js}); };`);
    const onKeyDown = factory(event => event.isComposing || event.keyCode === 229,
        document, window, Element, 'place-text', element => ({ visibility: element.visibility }),
        captionEditFocusWithinMarkedWidget).call(widget);
    onKeyDown({ key, code, isComposing, keyCode, metaKey, ctrlKey: false, altKey: false, shiftKey: false,
        target: elements[eventTarget], preventDefault: () => { counts.prevented++; },
        stopPropagation: () => { counts.stopped++; } });
    return counts;
}

test('IME 中はタイムラインのキーを扱わない', () => {
    assert.equal(dispatch(' ', { isComposing: true }).play, 0);
    assert.equal(dispatch('Delete', { keyCode: 229 }).delete, 0);
});

test('Space は操作部品と表示中モーダルでは扱わず、通常要素と webview は扱う', () => {
    assert.equal(dispatch(' ', { focus: 'timeline' }).play, 1);
    for (const focus of ['timelineButton', 'timelineRoleButton', 'timelineTabStop',
        'libraryCard', 'outsideRoleButton']) {
        assert.equal(dispatch(' ', { focus }).play, 0, focus);
    }
    for (const focus of ['outside', 'body', 'iframe']) {
        assert.equal(dispatch(' ', { focus }).play, 1, focus);
    }
    assert.equal(dispatch(' ', { focus: 'outside', eventTarget: 'iframe' }).play, 1);
    assert.equal(dispatch(' ', { focus: 'dialogButton', modal: 'theia' }).play, 0);
});

test('Delete は表示中モーダルだけで抑止する', () => {
    for (const modal of ['theia', 'aria']) assert.equal(dispatch('Delete', { modal }).delete, 0);
    for (const modal of [null, 'roleOnly', 'displayNone', 'visibilityHidden']) {
        assert.equal(dispatch('Delete', { modal }).delete, 1, String(modal));
    }
    assert.equal(dispatch('Delete').delete, 1);
});

test('Esc は外の行選択へ届き、タイムラインと webview では選択を解除する', () => {
    assert.equal(dispatch('Escape', { focus: 'outside' }).clear, 0);
    assert.equal(dispatch('Escape').clear, 1);
    assert.equal(dispatch('Escape', { focus: 'iframe' }).clear, 1);
    assert.equal(dispatch('Escape', { focus: 'outside', eventTarget: 'iframe' }).clear, 1);
});

test('コピー系はタイムラインと webview を優先し、外部・body の文字選択は横取りしない', () => {
    for (const key of ['c', 'x', 'v']) {
        const selected = dispatch(key, { metaKey: true, focus: 'body', selectionText: '会話ログ' });
        const outside = dispatch(key, { metaKey: true, focus: 'outside' });
        assert.equal(selected.prevented, 0, key);
        assert.equal(outside.prevented, 0, key);
        assert.equal(dispatch(key, { metaKey: true, selectionText: '残った選択' }).prevented, 1, key);
        assert.equal(dispatch(key, { metaKey: true, focus: 'iframe', selectionText: '残った選択' }).prevented, 1, key);
        assert.equal(dispatch(key, { metaKey: true, focus: 'outside', eventTarget: 'iframe' }).prevented, 1, key);
    }
    assert.equal(dispatch('c', { metaKey: true }).copy, 1);
    assert.equal(dispatch('c', { metaKey: true, focus: 'body' }).copy, 1);
});

test('T は文字を置き、IME 中は置かない', () => {
    assert.equal(dispatch('t').text, 1);
    assert.equal(dispatch('t', { isComposing: true }).text, 0);
    assert.equal(dispatch('t', { focus: 'timelineInput' }).text, 0);
});
