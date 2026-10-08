import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { AkariLazyWebviewResolve } from '../lib/browser/akari-lazy-webview-resolve.js';

test('hidden webviews wait, then resolve once across repeated shows and resolver registration', async () => {
    let visible = false;
    let calls = 0;
    const gate = new AkariLazyWebviewResolve();
    const run = () => { calls++; return Promise.resolve(); };
    const first = gate.request(() => visible, run);
    gate.request(() => visible, run);
    assert.equal(calls, 0);
    visible = true;
    gate.onVisible();
    await first;
    gate.onVisible();
    assert.equal(calls, 1);
});

test('disposed hidden webviews never resolve', async () => {
    let visible = false;
    let calls = 0;
    const gate = new AkariLazyWebviewResolve();
    const pending = gate.request(() => visible, () => { calls++; return Promise.resolve(); });
    gate.dispose();
    visible = true;
    gate.onVisible();
    await pending;
    assert.equal(calls, 0);
});

test('already visible webviews resolve immediately', async () => {
    let calls = 0;
    const gate = new AkariLazyWebviewResolve();
    const pending = gate.request(() => true, () => { calls++; return Promise.resolve(); });
    assert.equal(calls, 1);
    await pending;
});

// Run the actual override methods with a small Theia stand-in, without loading DOM or DI.
const source = readFileSync(new URL('../src/browser/akari-plugin-view-registry.ts', import.meta.url), 'utf8');
const file = ts.createSourceFile('registry.ts', source, ts.ScriptTarget.Latest, true);
const registry = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariPluginViewRegistry');
const methods = ['prepareView', 'resolveWebviewView'].map(name =>
    registry.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
const transpiled = ts.transpileModule(`class Harness extends BaseRegistry { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;

test('registry override routes visibility messages through the one-shot gate; tree path stays immediate', async () => {
    let calls = 0;
    let hook;
    const MessageLoop = {
        installMessageHook(_widget, value) { hook = value; },
        removeMessageHook() {}
    };
    class BaseRegistry {
        async prepareView() { calls++; }
        resolveWebviewView() { calls++; return Promise.resolve(); }
    }
    const Harness = new Function('BaseRegistry', 'MessageLoop', 'AkariLazyWebviewResolve',
        `${transpiled}\nreturn Harness;`)(BaseRegistry, MessageLoop, AkariLazyWebviewResolve);
    const instance = new Harness();
    instance.viewWidgets = new Map();
    instance.visibilityHooks = new WeakSet();
    instance.gates = new WeakMap();
    instance.gatesByView = new Map();
    const widget = {
        options: { viewId: 'webview' }, isVisible: false, isDisposed: false,
        disposed: { connect() {} }
    };
    await instance.prepareView(widget);
    assert.equal(calls, 1); // Theia's normal prepare path also serves tree views.
    const webviewWidget = { isDisposed: false, disposed: { connect() {} } };
    const pending = instance.resolveWebviewView('webview', { webview: webviewWidget }, {});
    assert.equal(calls, 1);
    widget.isVisible = true;
    hook(widget, { type: 'after-show' });
    await pending;
    assert.equal(calls, 2);
    hook(widget, { type: 'after-show' });
    await Promise.resolve();
    assert.equal(calls, 2);
});

test('restored child is replaced with a live resolver wrapper', async () => {
    const method = registry.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === 'createWebviewWidget').getText(file);
    const js = ts.transpileModule(`class Harness extends BaseRegistry { ${method} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
    }).outputText;
    const restored = { storeState: () => ({ state: 'saved' }) };
    const replacement = { restoreState(state) { this.state = state; } };
    class BaseRegistry {
        async createWebviewWidget(_id, existingId) { return existingId ? restored : replacement; }
    }
    const Harness = new Function('BaseRegistry', `${js}\nreturn Harness;`)(BaseRegistry);
    const instance = new Harness();
    instance.createdWebviews = new WeakSet();
    assert.equal(await instance.createWebviewWidget('webview', 'restored-id'), replacement);
    assert.deepEqual(replacement.state, { state: 'saved' });
});
