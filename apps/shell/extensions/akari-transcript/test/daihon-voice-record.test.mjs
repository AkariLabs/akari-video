import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
const start = source.indexOf("        const voice = document.createElement('button');", source.indexOf('    protected createRow('));
const end = source.indexOf('        head.appendChild(voice);', start) + '        head.appendChild(voice);'.length;
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(`function makeVoice(row) {
    const head = { appendChild() {} };
    ${source.slice(start, end)}
    return voice;
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function makeHarness() {
    const calls = [];
    const document = { createElement: tag => ({ tag, attributes: {}, listeners: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        click() { this.listeners.click?.({ stopPropagation() {} }); }
    }) };
    const create = vm.runInContext(`${compiled}\nmakeVoice;`, vm.createContext({ document }));
    const widget = { editUri: { toString: () => 'file:///project/edit.json' },
        commands: { executeCommand: (...args) => { calls.push(args); } } };
    return { create: row => create.call(widget, row), calls };
}

test('row microphone opens voice recording with edit URI and script', () => {
    const { create, calls } = makeHarness();
    const button = create({ id: 'c-0001', text: '読む文', outStart: 12.5, outEnd: 15 });
    assert.equal(button.textContent, '🎙');
    assert.equal(button.title, 'この行をアフレコで録る');
    assert.equal(button.attributes['aria-label'], button.title);
    assert.equal(button.attributes['data-akari-ui'], 'daihon:voice-record');
    button.click();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['akari.voice.record', { editUri: 'file:///project/edit.json',
        script: { text: '読む文', captionId: 'c-0001', start: 12.5, end: 15 } }]]);
});

test('cut row microphone is disabled and cannot open the dialog', () => {
    const { create, calls } = makeHarness();
    const button = create({ id: 'c-0002', text: '切られた文', outStart: null, outEnd: null });
    assert.equal(button.disabled, true);
    assert.equal(button.title, '切られた行は録れません');
    button.click();
    assert.deepEqual(calls, []);
});

test('selection bar records ordered rows and disables all-cut selections', () => {
    const from = source.indexOf('    protected renderActionBar(): void {');
    const to = source.indexOf('\n    protected ', from + 1);
    assert.ok(from >= 0 && to > from);
    const js = ts.transpileModule(`class BarHarness { ${source.slice(from, to)} }`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const element = tag => ({ tag, children: [], listeners: {}, attributes: {}, classList: { toggle() {}, add() {} },
        append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
        setAttribute(name, value) { this.attributes[name] = value; },
        click() { this.listeners.click?.({ stopPropagation() {} }); }
    });
    const document = { createElement: element };
    const Harness = vm.runInContext(`${js}\nBarHarness;`, vm.createContext({ document,
        canMergeRows: () => ({ ok: true }) }));
    const calls = [];
    const widget = Object.assign(new Harness(), { actionBar: element('div'), footer: {},
        selection: { selected: ['b', 'a'] }, wordRanges: [], rows: [
            { id: 'b', text: '後', outStart: 15, outEnd: 17 },
            { id: 'a', text: '先', outStart: 12, outEnd: 14 }
        ], editUri: { toString: () => 'file:///project/edit.json' },
        commands: { executeCommand(...args) { calls.push(args); } },
        closePop() {}, audioOnlyCutReason() {}, updateToastPlacement() {}
    });
    widget.renderActionBar();
    const button = widget.actionBar.children.find(child => child.textContent === '🎙 アフレコ');
    assert.equal(button.attributes['data-akari-ui'], 'daihon:voice-record');
    assert.equal(button.disabled, false);
    button.click();
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['akari.voice.record', {
        editUri: 'file:///project/edit.json', script: { text: '先\n後', start: 12, end: 17 }
    }]]);
    widget.rows = [{ id: 'a', text: '切', outStart: null, outEnd: null }];
    widget.selection.selected = ['a'];
    widget.renderActionBar();
    assert.equal(widget.actionBar.children.find(child => child.textContent === '🎙 アフレコ').disabled, true);
});
