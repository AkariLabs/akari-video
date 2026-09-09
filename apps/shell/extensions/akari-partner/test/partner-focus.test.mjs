import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../src/browser/akari-partner-widget.tsx', import.meta.url);
const source = ts.createSourceFile(sourceUrl.pathname, readFileSync(sourceUrl, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPartnerWidget');
const method = name => {
    const member = owner.members.find(node => node.name?.getText(source) === name);
    assert.ok(member, name);
    return member;
};

// home-init.test.mjs と同様、実ソースのメソッドを DOM/DI の import なしで実行する。
function loadMethod(name, dependencies = {}) {
    const code = ts.transpileModule(`class Partner extends Base { ${method(name).getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
    }).outputText;
    const deps = { Base: class {}, ...dependencies };
    return new Function(...Object.keys(deps), `${code}\nreturn Partner.prototype.${name};`)(...Object.values(deps));
}

for (const active of ['outside', 'none', 'child', 'self']) {
    test(`partner activation preserves ReactWidget behavior and handles focus: ${active}`, () => {
        const calls = [];
        const child = {};
        const document = { activeElement: active === 'child' ? child : active === 'none' ? null : {} };
        const node = {
            tabIndex: 0,
            contains(element) { return element === child || element === this; },
            focus(options) {
                calls.push('focus');
                assert.equal(this.tabIndex, -1);
                assert.deepEqual(options, { preventScroll: true });
                document.activeElement = this;
            }
        };
        if (active === 'self') document.activeElement = node;
        const before = document.activeElement;
        const message = { type: 'activate-request' };
        const activate = loadMethod('onActivateRequest', {
            document,
            setTimeout() { assert.fail('synchronous activation must not schedule retries'); },
            Base: class {
                onActivateRequest(msg) {
                    assert.equal(msg, message);
                    assert.equal(this.node, node);
                    calls.push('super');
                }
            }
        });
        const widget = { node };
        activate.call(widget, message);
        const shouldFocus = active === 'outside' || active === 'none';
        assert.deepEqual(calls, shouldFocus ? ['super', 'focus'] : ['super']);
        assert.equal(document.activeElement, shouldFocus ? widget.node : before);
        if (!shouldFocus) assert.equal(node.tabIndex, 0);
    });
}

function detachedFixture() {
    const timers = [];
    const focusCalls = [];
    const document = { body: {}, activeElement: null };
    document.activeElement = document.body;
    const child = {};
    const node = {
        tabIndex: 0,
        isConnected: false,
        ownerDocument: document,
        contains(element) { return element === child || element === this; },
        focus(options) {
            assert.equal(this.tabIndex, -1);
            assert.deepEqual(options, { preventScroll: true });
            focusCalls.push(options);
            if (this.isConnected) document.activeElement = this;
        }
    };
    const widget = { node, isDisposed: false };
    const activate = loadMethod('onActivateRequest', {
        document,
        Base: class { onActivateRequest() {} },
        setTimeout(callback, delay) {
            assert.equal(delay, 16);
            timers.push(callback);
        }
    });
    activate.call(widget, { type: 'activate-request' });
    assert.equal(focusCalls.length, 1);
    assert.equal(document.activeElement, document.body);
    assert.equal(timers.length, 1);
    const tick = () => {
        assert.equal(timers.length, 1);
        timers.shift()();
    };
    return { document, widget, child, focusCalls, timers, tick };
}

test('detached partner activation accepts focus after attachment', () => {
    const { document, widget, focusCalls, timers, tick } = detachedFixture();
    tick();
    assert.equal(focusCalls.length, 1);
    widget.node.isConnected = true;
    tick();
    assert.equal(document.activeElement, widget.node);
    assert.equal(focusCalls.length, 2);
    assert.equal(timers.length, 0);
});

test('detached partner activation stops when another element takes focus', () => {
    const { document, widget, focusCalls, timers, tick } = detachedFixture();
    tick();
    const outside = {};
    document.activeElement = outside;
    widget.node.isConnected = true;
    tick();
    assert.equal(document.activeElement, outside);
    assert.equal(focusCalls.length, 1);
    assert.equal(timers.length, 0);
});

test('detached partner activation stops after 60 retries without attachment', () => {
    const { document, focusCalls, timers, tick } = detachedFixture();
    for (let attempt = 0; attempt < 60; attempt++) tick();
    assert.equal(document.activeElement, document.body);
    assert.equal(focusCalls.length, 1);
    assert.equal(timers.length, 0);
});

for (const stop of ['disposed', 'child', 'self']) {
    test(`detached partner activation cancels pending focus: ${stop}`, () => {
        const { document, widget, child, focusCalls, timers, tick } = detachedFixture();
        widget.node.isConnected = true;
        if (stop === 'disposed') widget.isDisposed = true;
        if (stop === 'child') document.activeElement = child;
        if (stop === 'self') document.activeElement = widget.node;
        const before = document.activeElement;
        widget.node.tabIndex = 0;
        tick();
        assert.equal(document.activeElement, before);
        assert.equal(widget.node.tabIndex, 0);
        assert.equal(focusCalls.length, 1);
        assert.equal(timers.length, 0);
    });
}
