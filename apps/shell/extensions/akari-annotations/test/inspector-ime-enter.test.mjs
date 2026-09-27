import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const methods = ['appendRow', 'appendColorInput'];
const code = ts.transpileModule(`class Widget { ${methods.map(name =>
    widgetClass.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.listeners = new Map();
        this.attributes = new Map();
        this.style = {};
        this.classList = { add: () => {} };
        this.blurCount = 0;
    }
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }
    emit(type, properties = {}) {
        const event = { prevented: false, preventDefault() { this.prevented = true; }, ...properties };
        for (const listener of this.listeners.get(type) ?? []) listener(event);
        return event;
    }
    blur() { this.blurCount++; this.emit('blur'); }
}

const Widget = new Function('document', 'createColorRowSwatch', 'parsePaint', 'swatchBackground',
    `${code}; return Widget;`)(
    { createElement: tag => new FakeElement(tag) },
    () => new FakeElement('button'),
    value => value,
    value => value
);

function inputFor(inputKind) {
    const widget = new Widget();
    widget.attachRowMenu = () => {};
    const parent = new FakeElement('div');
    const writes = [];
    widget.appendRow(parent, {
        name: inputKind === 'text' ? 'prompt' : inputKind,
        label: inputKind === 'text' ? '指示文（prompt）' : inputKind,
        inputKind,
        getValue: () => inputKind === 'color' ? '#000000' : '',
        write: async (_snapshot, value) => { writes.push(value); return { ok: true }; }
    }, { kind: 'cut' }, 'cut');
    const input = inputKind === 'color' ? parent.children[0].children[1].children[1]
        : parent.children[0].children[1];
    return { input, writes };
}

for (const inputKind of ['text', 'number', 'color']) {
    test(`${inputKind}: IME 中の Enter / Escape は blur も書き込みもしない`, () => {
        const { input, writes } = inputFor(inputKind);
        input.value = inputKind === 'color' ? '#123456' : '日本語';
        for (const composition of [{ isComposing: true }, { keyCode: 229 }]) {
            for (const key of ['Enter', 'Escape']) {
                const event = input.emit('keydown', { key, ...composition });
                assert.equal(event.prevented, false);
                assert.equal(input.blurCount, 0);
                assert.deepEqual(writes, []);
                assert.equal(input.value, inputKind === 'color' ? '#123456' : '日本語');
            }
        }
    });

    test(`${inputKind}: 通常の Enter は blur して書き込む`, () => {
        const { input, writes } = inputFor(inputKind);
        input.value = inputKind === 'color' ? '#123456' : '日本語';
        const event = input.emit('keydown', { key: 'Enter', isComposing: false, keyCode: 13 });
        assert.equal(event.prevented, true);
        assert.equal(input.blurCount, 1);
        assert.deepEqual(writes, [input.value]);
    });
}
