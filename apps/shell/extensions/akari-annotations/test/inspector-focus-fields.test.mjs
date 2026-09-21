import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/browser/akari-inspector-widget.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('inspector.ts', source, ts.ScriptTarget.Latest, true);
const widgetClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariInspectorWidget');
const methods = ['focusField', 'pulseField', 'pulse', 'appendRow', 'appendSection'];
const code = ts.transpileModule(`class Widget { ${methods.map(name =>
    widgetClass.members.find(member => member.name?.getText(ast) === name).getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const Widget = new Function(`${code}; return Widget;`)();

class FakeElement {
    children = []; attributes = new Map(); style = {}; dataset = {}; className = '';
    classList = {
        add: name => { this.className = `${this.className} ${name}`.trim(); },
        remove: name => { this.className = this.className.split(/\s+/u).filter(value => value !== name).join(' '); },
        contains: name => this.className.split(/\s+/u).includes(name)
    };
    setAttribute(name, value) { this.attributes.set(name, value); }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); return child; }
    addEventListener() {}
    scrollIntoView(options) { this.scroll = options; }
    querySelector(selector) {
        const [, attribute, value, active] = selector.match(/^\[([^=]+)="([^"]+)"\](\.is-active)?$/u);
        for (const child of this.children) {
            if (child.attributes.get(attribute) === value && (!active || child.classList.contains('is-active'))) return child;
            const nested = child.querySelector(selector);
            if (nested) return nested;
        }
        return null;
    }
}

function dom(callback, reduced = false) {
    const previous = ['document', 'window'].map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    const timers = [];
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new FakeElement() } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
        matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return { matches: reduced }; },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
    } });
    try { callback(timers); } finally {
        ['document', 'window'].forEach((name, index) => {
            if (previous[index]) Object.defineProperty(globalThis, name, previous[index]);
            else delete globalThis[name];
        });
    }
}

function fixture(missing, kind = 'cut') {
    const widget = new Widget();
    widget.body = new FakeElement();
    widget.model = { snapshot: kind ? { kind } : undefined };
    widget.writes = [];
    widget.tabState = { setActiveTab: (...args) => widget.writes.push(['tab', ...args]) };
    widget.sectionState = { setCollapsed: (...args) => widget.writes.push(['section', ...args]), isCollapsed: () => false };
    widget.renders = 0;
    widget.render = () => {
        widget.renders++;
        widget.body.children = [];
        for (const [key, attribute, value] of [
            ['tab', 'data-akari-ui', 'tab:inspector-adjust'],
            ['section', 'data-akari-ui', 'section:inspector-adjust:basic'],
            ['field', 'data-akari-field', 'adjust-basic-exposure']
        ]) {
            if (key === missing) continue;
            const element = new FakeElement();
            element.setAttribute(attribute, value);
            if (key === 'tab' && missing !== 'inactive') element.classList.add('is-active');
            widget.body.appendChild(element);
        }
    };
    widget.attachRowMenu = () => {};
    return widget;
}
const options = { tabId: 'adjust', sectionId: 'adjust:basic', fieldName: 'adjust-basic-exposure' };

test('focusField opens the requested tab and section and pulses the field after rendering', () => dom(timers => {
    const widget = fixture();
    assert.equal(widget.focusField(options), true);
    assert.equal(widget.renders, 1);
    assert.deepEqual(widget.writes, [['tab', 'cut', 'adjust'], ['section', 'cut', 'adjust:basic', false]]);
    assert.equal(widget.body.children[2].classList.contains('akari-inspector-focus-pulse'), true);
    assert.equal(timers.length, 1);
}));

for (const missing of ['tab', 'inactive', 'section', 'field']) {
    test(`focusField returns false for a missing or inactive ${missing}`, () => dom(timers => {
        const widget = fixture(missing);
        assert.equal(widget.focusField(options), false);
        assert.equal(widget.renders, 1);
        assert.equal(timers.length, 0);
    }));
}

test('focusField skips rendering for empty options, no snapshot and world selection', () => dom(timers => {
    for (const [kind, request] of [['cut', { tabId: undefined, sectionId: undefined, fieldName: undefined }],
        [undefined, options], ['world', options]]) {
        const widget = fixture();
        widget.model.snapshot = kind ? { kind } : undefined;
        assert.equal(widget.focusField(request), false);
        assert.equal(widget.renders, 0);
        assert.deepEqual(widget.writes, []);
    }
    assert.equal(timers.length, 0);
}));

test('focusField supports section-only and tab-only requests and maps multi selection to caption', () => dom(timers => {
    const widget = fixture(undefined, 'multi');
    assert.equal(widget.focusField({ sectionId: options.sectionId }), true);
    assert.equal(widget.body.children[1].classList.contains('akari-inspector-focus-pulse'), true);
    assert.equal(widget.focusField({ tabId: options.tabId }), true);
    assert.deepEqual(widget.writes, [['section', 'caption', 'adjust:basic', false], ['tab', 'caption', 'adjust']]);
    assert.equal(timers.length, 1);
}));

for (const reduced of [false, true]) {
    test(`pulseField targets rendered fields and removes emphasis after 1600ms (reduced=${reduced})`, () => dom(timers => {
        const widget = fixture();
        assert.equal(widget.pulseField(options.fieldName), false);
        widget.render();
        assert.equal(widget.pulseField(options.fieldName), true);
        const element = widget.body.children[2];
        const className = reduced ? 'akari-inspector-focus-pulse-reduced' : 'akari-inspector-focus-pulse';
        assert.equal(element.classList.contains(className), true);
        assert.deepEqual(element.scroll, { block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        assert.equal(timers.length, 1);
        assert.equal(timers[0].delay, 1600);
        timers[0].callback();
        assert.equal(element.classList.contains(className), false);
        assert.equal(widget.renders, 1);
        assert.deepEqual(widget.writes, []);
    }, reduced));
}

const write = async () => ({ ok: true });
for (const [branch, definition, control] of [
    ['writable', { write }, 'field:inspector-target'],
    ['read-only', {}, undefined],
    ['action', { action: write }, 'action:inspector-target'],
    ['actions', { actions: [{ name: 'apply', label: 'Apply', action: write }] }, 'action:inspector-target-apply'],
    ['zone-grid', { write, inputKind: 'zone-grid', options: ['center'] }, 'field:inspector-target']
]) {
    test(`appendRow stamps the ${branch} row and preserves its control marker`, () => dom(() => {
        const widget = fixture();
        const parent = new FakeElement();
        widget.appendRow(parent, { name: 'target', label: 'Target', getValue: () => 'center', ...definition }, { kind: 'cut' }, 'cut');
        assert.equal(parent.children.length, 1);
        assert.equal(parent.children[0].attributes.get('data-akari-field'), 'target');
        if (control) assert.ok(parent.querySelector(`[data-akari-ui="${control}"]`));
    }));
}

test('appendRow uses the existing label fallback for unnamed fields', () => dom(() => {
    const widget = fixture();
    widget.appendRow(widget.body, { label: 'Output Start', getValue: () => '0' }, { kind: 'cut' }, 'cut');
    assert.equal(widget.body.children[0].attributes.get('data-akari-field'), 'output-start');
}));

test('appendSection stamps the enable checkbox and preserves its existing marker', () => dom(() => {
    const widget = fixture();
    widget.appendSection({ id: 'adjust:basic', label: 'Basic', fields: [],
        enable: { name: 'adjust-basic-enabled', label: 'Enabled', checked: true, write }
    }, { kind: 'cut' }, 'cut');
    const checkbox = widget.body.querySelector('[data-akari-field="adjust-basic-enabled"]');
    assert.ok(checkbox);
    assert.equal(checkbox.type, 'checkbox');
    assert.equal(checkbox.checked, true);
    assert.equal(checkbox.attributes.get('data-akari-ui'), 'field:inspector-adjust-basic-enabled');
}));

test('focusField passes adjust / generation as explicit tab choices before rendering', () => dom(() => {
    for (const tabId of ['adjust', 'generation']) {
        const widget = fixture();
        widget.render = () => {
            assert.equal(widget.explicitTabId, tabId);
            const tab = new FakeElement();
            tab.setAttribute('data-akari-ui', `tab:inspector-${tabId}`);
            tab.classList.add('is-active');
            widget.body.appendChild(tab);
        };
        assert.equal(widget.focusField({ tabId }), true);
        assert.deepEqual(widget.writes, [['tab', 'cut', tabId]]);
    }
}));
