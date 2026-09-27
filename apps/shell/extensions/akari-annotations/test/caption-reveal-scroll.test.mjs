import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { captionRevealDestination } from '../lib/common/caption-reveal-destination.js';
import { captionRevealScrollTop } from '../lib/common/caption-reveal-scroll.js';
import { inspectorScrollPin } from '../lib/browser/inspector/live-state.js';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node)
    && node.name?.text === 'AkariInspectorWidget');
const method = widgetClass.members.find(node => node.name?.getText(ast) === 'revealCaptionField');
const code = ts.transpileModule(`class Widget { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

class FakeHTMLElement {
    classList = { add() {}, remove() {} };
    constructor(top) { this.top = top; }
    getBoundingClientRect() { return { top: this.top }; }
    querySelector() { return null; }
    scrollIntoView() { throw new Error('The inspector scroll owner must be moved directly'); }
}
const Widget = new Function('captionRevealDestination', 'captionRevealScrollTop', 'HTMLElement',
    `${code}; return Widget;`)(captionRevealDestination, captionRevealScrollTop, FakeHTMLElement);

test('render の scroll pin が使う記憶値ごと移し、3 つの行き先を開く', () => {
    for (const [field, owner, expectedTab, expectedSection] of [
        ['caption-effect', false, 'text', 'style:effect'],
        ['caption-animation', true, 'motion', 'motion:caption'],
        ['caption-animation', false, 'motion', 'motion:caption'],
        ['caption-style', false, 'text', 'style']
    ]) {
        const previousWindow = globalThis.window;
        globalThis.window = { setTimeout() {} };
        try {
            const widget = new Widget();
            const target = new FakeHTMLElement(1034);
            widget.model = { snapshot: { kind: 'caption', animatorOwner: owner ? { id: 'bag' } : null } };
            widget.node = { scrollTop: 0, scrollHeight: 1524, clientHeight: 803,
                getBoundingClientRect: () => ({ top: 50 }) };
            widget.rememberedView = { scrollTop: 0 };
            widget.captionPanel = 'font';
            widget.closeCaptionPanel = () => { widget.captionPanel = null; };
            widget.focusField = options => {
                assert.deepEqual(options, { tabId: expectedTab, sectionId: expectedSection, pulse: false });
                return true;
            };
            widget.body = { querySelector: selector => {
                assert.equal(selector, field === 'caption-style'
                    ? '[data-inspector-field="caption-style"]'
                    : `[data-akari-ui="section:inspector-${expectedSection}"]`);
                return target;
            } };
            assert.equal(widget.revealCaptionField({ field }), true);
            assert.equal(widget.captionPanel, null);
            assert.equal(widget.node.scrollTop, 721);
            assert.equal(widget.rememberedView.scrollTop, 721);
            assert.equal(inspectorScrollPin(widget.rememberedView.scrollTop, 0, 0, 1), 721);
            assert.ok(target.top - widget.node.scrollTop < 50 + 803 - 60);
        } finally { globalThis.window = previousWindow; }
    }
});

test('スクロール値は表示範囲に収める', () => {
    assert.equal(captionRevealScrollTop(0, 50, 803, 1524, 1034), 721);
    assert.equal(captionRevealScrollTop(0, 50, 803, 1524, 60), 0);
    assert.equal(captionRevealScrollTop(100, 50, 803, 1524, 400), 430);
});
