import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
const gateSource = readFileSync(new URL('../src/browser/akari-lazy-webview-resolve.ts', import.meta.url), 'utf8')
    .replace(/^export class /m, 'class ');
const gateJs = ts.transpileModule(gateSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const AkariLazyWebviewResolve = new Function(`${gateJs}\nreturn AkariLazyWebviewResolve;`)();

// Run the derived methods against Theia's actual prepareView -> createViewDataWidget path.
const methodsFrom = (url, className, names) => {
    const file = ts.createSourceFile(className + '.ts', readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    return names.map(name => declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name).getText(file));
};
const derived = methodsFrom(new URL('../src/browser/akari-plugin-view-registry.ts', import.meta.url),
    'AkariPluginViewRegistry', ['prepareView', 'resolveWebviewView', 'registerWebviewView']);
const registrySource = ts.createSourceFile('akari-plugin-view-registry.ts',
    readFileSync(new URL('../src/browser/akari-plugin-view-registry.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const idsStatement = registrySource.statements.find(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => declaration.name.getText(registrySource) === 'CODEX_LAZY_WEBVIEW_IDS'));
assert.ok(idsStatement, 'Codex lazy webview ID list exists');
const idsSource = idsStatement.getText(registrySource).replace(/^export /, '');
const CODEX_PRIMARY = 'chatgpt.sidebarView';
const CODEX_SECONDARY = 'chatgpt.sidebarSecondaryView';
const OTHER_WEBVIEW = 'claudeVSCodeSidebar';
const theia = methodsFrom(new URL('../../../../../node_modules/@theia/plugin-ext/src/main/browser/view/plugin-view-registry.ts', import.meta.url),
    'PluginViewRegistry', ['prepareView', 'createViewDataWidget']);
const js = ts.transpileModule(`
    ${idsSource}
    class BaseRegistry {
        ${theia.join('\n')}
        async resolveWebviewView(viewId, webview) {
            const resolver = this.resolvers.get(viewId);
            if (resolver) return resolver.resolve(webview);
            this.revivals++;
            return new Promise(resolve => this.pendingRevivals.set(viewId, { webview, resolve }));
        }
        async registerWebviewView(viewId, resolver) {
            if (this.resolvers.has(viewId)) throw new Error('duplicate resolver');
            this.resolvers.set(viewId, resolver);
            const pending = this.pendingRevivals.get(viewId);
            if (pending) {
                await resolver.resolve(pending.webview);
                pending.resolve();
                this.pendingRevivals.delete(viewId);
            }
            return { dispose: () => this.resolvers.delete(viewId) };
        }
        async createWebviewWidget() { return undefined; }
        getViewWelcomes() { return []; }
    }
    class Harness extends BaseRegistry { ${derived.join('\n')} }
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture() {
    const hooks = new Map();
    const MessageLoop = {
        installMessageHook(widget, hook) { hooks.set(widget, hook); },
        removeMessageHook(widget) { hooks.delete(widget); }
    };
    const Disposable = { create: dispose => ({ dispose }) };
    const Harness = new Function('MessageLoop', 'AkariLazyWebviewResolve', 'Disposable', 'PluginViewType', 'WebviewWidget', 'StatefulWidget',
        `${js}\nreturn Harness;`)(MessageLoop, AkariLazyWebviewResolve, Disposable,
        { Webview: 'webview' }, class WebviewWidget {}, { is: () => false });
    const registry = new Harness();
    registry.viewWidgets = new Map();
    registry.visibilityHooks = new WeakSet();
    registry.gates = new WeakMap();
    registry.gateOwners = new WeakMap();
    registry.gatesByViewId = new Map();
    registry.registeredResolvers = new Set();
    registry.views = new Map();
    registry.viewDataProviders = new Map();
    registry.viewDataState = new Map();
    registry.resolvers = new Map();
    registry.pendingRevivals = new Map();
    registry.revivals = 0;
    const view = (viewId = CODEX_PRIMARY, visible = false) => {
        const listeners = [];
        const widget = {
            options: { viewId }, title: { label: '' }, widgets: [], isVisible: visible, isDisposed: false,
            addWidget(child) { this.widgets.push(child); },
            disposed: { connect(listener) { listeners.push(listener); } },
            dispose() { this.isDisposed = true; for (const listener of listeners) listener(); }
        };
        registry.views.set(viewId, ['container', { id: viewId, name: viewId, type: viewId === 'tree' ? 'tree' : 'webview' }]);
        return widget;
    };
    const webview = () => {
        const listeners = [];
        const child = { isDisposed: false, disposed: { connect(listener) { listeners.push(listener); } },
            dispose() { this.isDisposed = true; for (const listener of listeners) listener(); } };
        return { webview: child };
    };
    const show = async widget => {
        widget.isVisible = true;
        hooks.get(widget)?.(widget, { type: 'after-show' });
        await Promise.resolve();
    };
    return { registry, view, webview, show, hooks };
}

test('only Codex contributed view IDs use lazy resolution', () => {
    assert.deepEqual([...new Function(`${js}\nreturn CODEX_LAZY_WEBVIEW_IDS;`)()], [CODEX_PRIMARY, CODEX_SECONDARY]);
});

test('visible before registration, then hidden at registration, waits until shown and resolves once', async () => {
    const { registry, view, webview, show } = fixture();
    const parent = view(CODEX_PRIMARY, true);
    await registry.prepareView(parent);
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    parent.isVisible = false;
    let calls = 0;
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(registry.revivals, 0);
    await show(parent);
    await pending;
    await show(parent);
    assert.equal(calls, 1);
});

test('registered and visible webview resolves immediately', async () => {
    const { registry, view, webview } = fixture();
    await registry.prepareView(view(CODEX_SECONDARY, true));
    let calls = 0;
    await registry.registerWebviewView(CODEX_SECONDARY, { resolve: async () => { calls++; } });
    await registry.resolveWebviewView(CODEX_SECONDARY, webview(), {});
    assert.equal(calls, 1);
    assert.equal(registry.revivals, 0);
});

test('visible webview waits for resolver registration, then resolves once', async () => {
    const { registry, view, webview } = fixture();
    await registry.prepareView(view(CODEX_PRIMARY, true));
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    let calls = 0;
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    await pending;
    assert.equal(calls, 1);
    assert.equal(registry.revivals, 0);
});

test('webview without a prepared parent never enters Theia revival queue', async () => {
    const { registry, view, webview, show } = fixture();
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    let calls = 0;
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.equal(registry.revivals, 0);
    const parent = view(CODEX_PRIMARY, false);
    await registry.prepareView(parent);
    assert.equal(calls, 0);
    await show(parent);
    await pending;
    assert.equal(calls, 1);
});

test('resolver disposal closes the gate until another resolver registers', async () => {
    const { registry, view, webview, show } = fixture();
    const parent = view();
    await registry.prepareView(parent);
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    let calls = 0;
    const registration = await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    registration.dispose();
    await show(parent);
    assert.equal(calls, 0);
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    await pending;
    assert.equal(calls, 1);
});

test('disposed PluginViewWidget stays unresolved after show and registration', async () => {
    const { registry, view, webview, show } = fixture();
    const parent = view();
    await registry.prepareView(parent);
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    parent.dispose();
    await show(parent);
    let calls = 0;
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    await pending;
    assert.equal(calls, 0);
    assert.equal(registry.revivals, 0);
});

test('a disposed view cannot resolve its old webview through a replacement view', async () => {
    const { registry, view, webview } = fixture();
    const oldParent = view();
    await registry.prepareView(oldParent);
    const pending = registry.resolveWebviewView(CODEX_PRIMARY, webview(), {});
    oldParent.dispose();
    await registry.prepareView(view(CODEX_PRIMARY, true));
    let calls = 0;
    await registry.registerWebviewView(CODEX_PRIMARY, { resolve: async () => { calls++; } });
    await pending;
    assert.equal(calls, 0);
});

test('unlisted hidden webview enters Theia revival queue and resolves on registration', async () => {
    const { registry, view, webview, hooks } = fixture();
    const parent = view(OTHER_WEBVIEW, false);
    await registry.prepareView(parent);
    assert.equal(hooks.has(parent), false);
    assert.equal(registry.viewWidgets.has(OTHER_WEBVIEW), false);
    const pending = registry.resolveWebviewView(OTHER_WEBVIEW, webview(), {});
    assert.equal(registry.revivals, 1);
    assert.equal(registry.pendingRevivals.has(OTHER_WEBVIEW), true);
    assert.equal(registry.gatesByViewId.has(OTHER_WEBVIEW), false);
    let calls = 0;
    const registration = await registry.registerWebviewView(OTHER_WEBVIEW, { resolve: async () => { calls++; } });
    await pending;
    assert.equal(calls, 1);
    assert.equal(registry.pendingRevivals.has(OTHER_WEBVIEW), false);
    assert.equal(registry.registeredResolvers.has(OTHER_WEBVIEW), false);
    registration.dispose();
    assert.equal(registry.resolvers.has(OTHER_WEBVIEW), false);
});

test('unlisted hidden webview resolves immediately when resolver is registered', async () => {
    const { registry, view, webview, hooks } = fixture();
    const parent = view(OTHER_WEBVIEW, false);
    await registry.prepareView(parent);
    let calls = 0;
    await registry.registerWebviewView(OTHER_WEBVIEW, { resolve: async () => { calls++; } });
    await registry.resolveWebviewView(OTHER_WEBVIEW, webview(), {});
    assert.equal(calls, 1);
    assert.equal(registry.revivals, 0);
    assert.equal(hooks.has(parent), false);
    assert.equal(registry.viewWidgets.has(OTHER_WEBVIEW), false);
    assert.equal(registry.gatesByViewId.has(OTHER_WEBVIEW), false);
    assert.equal(registry.registeredResolvers.has(OTHER_WEBVIEW), false);
});

test('tree view creates and adds its data widget immediately through Theia prepareView', async () => {
    const { registry, view, hooks } = fixture();
    const parent = view('tree', false);
    const tree = { handleViewWelcomeContentChange() {} };
    registry.viewDataProviders.set('tree', async () => tree);
    await registry.prepareView(parent);
    assert.deepEqual(parent.widgets, [tree]);
    assert.equal(hooks.has(parent), false);
    assert.equal(registry.viewWidgets.has('tree'), false);
});
