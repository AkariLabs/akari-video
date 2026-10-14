import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { matchWordDoublePress } from '../lib/common/daihon-word-double-click.js';
import { selectedDaihonEdit } from '../lib/common/daihon-dock.js';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sourceText = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('widget.ts', sourceText, ts.ScriptTarget.Latest, true);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariDaihonWidget');
const methods = owner.members.filter(node => ['wordHit', 'handleWordDoubleClickPointerDown', 'handleWordPointerDown',
    'handleWordDoubleClickMouseEvent', 'startEdit'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const compiled = ts.transpileModule(`class Harness { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const document = { createElement: () => ({ appendChild() {}, setAttribute() {}, addEventListener() {},
    focus() {}, select() { this.selection = [0, this.value.length]; },
    setSelectionRange(start, end) { this.selection = [start, end]; } }) };
const Harness = new Function('matchWordDoublePress', 'selectedDaihonEdit', 'document', 't', 'DaihonCaptionInput',
    'DaihonCaptionEditSession', `${compiled}\nreturn Harness;`)(matchWordDoublePress, selectedDaihonEdit,
    document, () => '', class {}, class {});

function press(timeStamp, x, y, target, extra = {}) {
    const event = { timeStamp, clientX: x, clientY: y, target, button: 0, detail: 1,
        altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
        prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...extra };
    return event;
}

function pointerDown(instance, event, inRows = true) {
    instance.handleWordDoubleClickPointerDown(event);
    if (!event.stopped && inRows) instance.handleWordPointerDown(event);
}

function widget() {
    const instance = new Harness();
    instance.wordRanges = [];
    instance.rows = [{ id: 'first', text: '甲乙', words: [{ text: '甲' }, { text: '乙' }] },
        { id: 'other', text: '丙', words: [{ text: '丙' }] }];
    instance.rowOrder = () => ['first', 'other'];
    instance.setSelection = () => {};
    instance.renderWordSelection = () => {};
    instance.focusRows = () => {};
    instance.closePop = () => {};
    instance.edits = [];
    instance.startEdit = (row, index) => instance.edits.push([row.id, index]);
    return instance;
}

const word = (row, index) => ({ closest: () => ({ dataset: { rowId: row, wordIndex: String(index) } }) });
const otherElement = { closest: () => null };

test('スクロール後に別の要素を押しても元の語を編集し、続く click を止める', () => {
    const instance = widget();
    pointerDown(instance, press(100, 120, 320, word('first', 1)));
    assert.deepEqual(instance.wordRanges, [{ row: 'first', a: 1, b: 1 }]);
    assert.deepEqual(instance.edits, []);
    instance.wordDrag = undefined;
    const second = press(310, 122, 323, otherElement, { detail: 2 });
    pointerDown(instance, second);
    assert.deepEqual(instance.edits, [['first', 1]]);
    assert.equal(second.prevented, true);
    assert.equal(second.stopped, true);
    const mousedown = press(315, 122, 323, word('other', 0), { type: 'mousedown' });
    instance.handleWordDoubleClickMouseEvent(mousedown);
    assert.equal(mousedown.prevented, true);
    assert.equal(mousedown.stopped, true);
    const click = press(320, 122, 323, word('other', 0));
    instance.handleWordDoubleClickMouseEvent(click);
    assert.equal(click.prevented, true);
    assert.equal(click.stopped, true);
    const dblclick = press(321, 122, 323, word('other', 0), { type: 'dblclick' });
    instance.handleWordDoubleClickMouseEvent(dblclick);
    assert.equal(dblclick.prevented, true);
    assert.equal(instance.suppressWordDoubleClick, false);
    assert.match(sourceText, /this\.node\.addEventListener\('mousedown', event => this\.handleWordDoubleClickMouseEvent\(event\), \{ capture: true \}\)/);
    assert.match(sourceText, /this\.node\.addEventListener\('click', event => this\.handleWordDoubleClickMouseEvent\(event\), \{ capture: true \}\)/);
    assert.match(sourceText, /this\.node\.addEventListener\('dblclick', event => this\.handleWordDoubleClickMouseEvent\(event\), \{ capture: true \}\)/);
});

test('2 回目がリスト外のアクションバーに落ちてもボタンを押さず元の語を開く', () => {
    assert.match(sourceText, /this\.node\.addEventListener\('pointerdown', event => this\.handleWordDoubleClickPointerDown\(event\), \{ capture: true \}\)/);
    for (const type of ['mousedown', 'click', 'dblclick']) {
        assert.match(sourceText, new RegExp(`this\\.node\\.addEventListener\\('${type}', event => this\\.handleWordDoubleClickMouseEvent\\(event\\), \\{ capture: true \\}\\)`));
    }
    const instance = widget();
    pointerDown(instance, press(100, 120, 470, word('first', 1)));
    instance.wordDrag = undefined;
    const actionButton = { closest: () => null };
    const second = press(300, 121, 471, actionButton, { detail: 2 });
    pointerDown(instance, second, false);
    let buttonRuns = 0;
    if (!second.stopped) buttonRuns++;
    assert.deepEqual(instance.edits, [['first', 1]]);
    assert.equal(buttonRuns, 0);
    for (const type of ['mousedown', 'click', 'dblclick']) {
        const follow = press(301, 121, 471, actionButton, { type });
        instance.handleWordDoubleClickMouseEvent(follow);
        if (!follow.stopped) buttonRuns++;
    }
    assert.equal(buttonRuns, 0);
    assert.equal(instance.suppressWordDoubleClick, false);
    const next = press(900, 121, 471, actionButton);
    pointerDown(instance, next, false);
    assert.equal(instance.suppressWordDoubleClick, false);
    assert.equal(next.stopped, false);
    const withoutDblclick = widget();
    pointerDown(withoutDblclick, press(100, 120, 470, word('first', 1)));
    withoutDblclick.wordDrag = undefined;
    pointerDown(withoutDblclick, press(300, 121, 471, actionButton, { detail: 2 }), false);
    withoutDblclick.handleWordDoubleClickMouseEvent(press(301, 121, 471, actionButton, { type: 'click' }));
    pointerDown(withoutDblclick, press(900, 121, 471, actionButton), false);
    const ordinaryClick = press(901, 121, 471, actionButton, { type: 'click' });
    withoutDblclick.handleWordDoubleClickMouseEvent(ordinaryClick);
    assert.equal(ordinaryClick.stopped, false);
});

test('同じ語への二度押しは一度だけ開き、時間外・距離外・修飾キー・ドラッグを除く', () => {
    for (const target of [word('first', 1), otherElement]) {
        const instance = widget();
        pointerDown(instance, press(100, 120, 320, word('first', 1)));
        instance.wordDrag = undefined;
        pointerDown(instance, press(300, 120, 320, target, { detail: 2 }));
        assert.deepEqual(instance.edits, [['first', 1]]);
    }
    for (const second of [press(700, 120, 320, otherElement), press(200, 130, 320, otherElement),
        press(200, 120, 320, otherElement, { shiftKey: true }), press(200, 120, 320, otherElement, { button: 2 })]) {
        const instance = widget();
        pointerDown(instance, press(100, 120, 320, word('first', 1)));
        instance.wordDrag = undefined;
        pointerDown(instance, second);
        assert.deepEqual(instance.edits, []);
    }
    const dragged = widget();
    pointerDown(dragged, press(100, 120, 320, word('first', 1)));
    dragged.wordDrag.moved = true;
    pointerDown(dragged, press(200, 120, 320, otherElement));
    assert.deepEqual(dragged.edits, []);
});

test('編集開始は押した語の文字範囲を選択する', () => {
    assert.deepEqual(selectedDaihonEdit('甲乙', [{ text: '甲' }, { text: '乙' }], { a: 1, b: 1 }),
        { value: '甲乙', start: 1, end: 2 });
    const instance = widget();
    instance.captionsUri = { toString: () => 'captions' };
    instance.rootUri = { toString: () => 'root' };
    instance.revealSourceGroupForRow = () => {};
    instance.captionEditQueue = { readUntimed: () => Promise.resolve('') };
    instance.elements = new Map([['first', { root: { querySelector: () => ({ replaceWith() {} }) } }]]);
    Harness.prototype.startEdit.call(instance, instance.rows[0], 1);
    assert.deepEqual(instance.editing.input.selection, [1, 2]);
    instance.editing = undefined;
    instance.rows[0].text = '甲 乙';
    Harness.prototype.startEdit.call(instance, instance.rows[0], 1);
    assert.deepEqual(instance.editing.input.selection, [0, 3]);
});
