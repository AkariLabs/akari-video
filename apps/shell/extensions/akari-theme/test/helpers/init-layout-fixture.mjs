import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { guardInitLayout } from '../../lib/browser/init-layout-guard.js';

// Follow audio-clip-fx-fixture: execute the real method, without loading Theia's DOM/DI imports.
export function loadInitLayout(sourceUrl, dependencies = {}) {
    const source = ts.createSourceFile(sourceUrl.pathname, readFileSync(sourceUrl, 'utf8'), ts.ScriptTarget.Latest, true);
    const owner = source.statements.find(node => ts.isClassDeclaration(node)
        && node.members.some(member => member.name?.getText(source) === 'onDidInitializeLayout'));
    const method = owner?.members.find(member => member.name?.getText(source) === 'onDidInitializeLayout');
    assert.ok(method, sourceUrl.pathname);
    const code = ts.transpileModule(`class Contribution { ${method.getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 }
    }).outputText;
    const deps = { guardInitLayout, ...dependencies };
    return new Function(...Object.keys(deps), `${code}\nreturn Contribution.prototype.onDidInitializeLayout;`)(...Object.values(deps));
}

export const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

export function layoutFixture() {
    const calls = [];
    const mark = name => () => { calls.push(name); };
    const widget = {
        id: 'home', isAttached: false,
        disposed: { connect: mark('disposed') },
        start: async () => { calls.push('start'); },
        configure: async () => { calls.push('configure'); },
        showError: mark('showError'),
        restorePartnerTerminals: async () => { calls.push('restore'); }
    };
    const shell = {
        addWidget: () => { calls.push('attach'); widget.isAttached = true; },
        activateWidget: async () => { calls.push('activate'); },
        onDidAddWidget: mark('subscribe'),
        bottomPanel: { widgets: () => [{ id: 'terminal' }], layoutModified: { connect: mark('connect') } },
        getAreaFor: () => 'bottom', closeWidget: async () => { calls.push('close'); },
        leftPanelHandler: { container: { parent: {} } }, mainPanel: { parent: {} }
    };
    const instance = {
        widgetManager: { getOrCreateWidget: async () => { calls.push('factory'); return widget; } },
        storageService: { getData: async () => { calls.push('storage'); } },
        correctFirstLaunchPaneWidth: mark('width'),
        reconcileRightPanelOrder: mark('right-order'),
        reconcileLeftPanel: mark('left'), ensureModeAppropriateAssetView: mark('asset'),
        ensureMenuWidgetAttachment: mark('menu'), leftPanelInternals: () => undefined,
        reconcile: mark('reconcile'), applyGap: mark('gap'),
        developerMode: { isEnabled: false, onDidChange: mark('mode') },
        toDispose: { push() {} },
        ensureWidget: async () => { calls.push('daihon'); return widget; },
        ensureCutsWidget: async () => { calls.push('cuts'); return widget; }
    };
    const dependencies = {
        AkariHomeWidget: { ID: 'home' }, AkariPartnerWidget: { ID: 'partner' },
        LAYOUT_STORAGE_KEY: 'layout', RIGHT_PANEL_FIXED_ORDER: [],
        TerminalWidget: class {}, shouldCloseAtStartup: () => true,
        installHomeTabAnchor: () => { calls.push('anchor'); return { dispose() {} }; }
    };
    return { calls, widget, shell, instance, dependencies, app: { shell } };
}

export function testLayoutGuard(sourceUrl, extension, expectedCalls) {
    for (const mode of ['success', 'throw', 'reject', 'pending']) {
        test(`${sourceUrl.pathname.split('/').pop()}: guarded callback ${mode}`, async t => {
            const warnings = [];
            t.mock.method(console, 'warn', (...args) => warnings.push(args));
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const fixture = layoutFixture();
            const error = new Error(`injected ${mode}`);
            let guarded = 0;
            let finished = false;
            let workCompleted = false;
            const method = loadInitLayout(sourceUrl, {
                ...fixture.dependencies,
                guardInitLayout(name, fn) {
                    assert.equal(name, extension);
                    guarded++;
                    // Execute the actual body before injecting a callback failure. Synchronous
                    // contributions have no awaited dependency to stub with a rejected promise.
                    return guardInitLayout(name, () => {
                        const work = fn();
                        if (mode === 'throw') {
                            Promise.resolve(work).catch(assert.fail);
                            throw error;
                        }
                        return Promise.resolve(work).then(() => {
                            if (mode === 'reject') return Promise.reject(error);
                            if (mode === 'pending') return new Promise(resolve => {
                                setTimeout(() => { workCompleted = true; resolve(); }, 5000);
                            });
                        });
                    }, { timeoutMs: 50 });
                }
            });
            const started = performance.now();
            const result = method.call(fixture.instance, fixture.app);
            assert.ok(result instanceof Promise, 'Theia must receive the guarded promise');
            result.then(() => { finished = true; });
            await flush();
            assert.equal(guarded, 1);
            for (const call of expectedCalls) assert.ok(fixture.calls.includes(call), `real body must call ${call}`);
            if (mode === 'pending') {
                t.mock.timers.tick(49);
                await flush();
                assert.equal(finished, false);
                t.mock.timers.tick(1);
            }
            await result;
            assert.ok(performance.now() - started < 2000);
            assert.equal(warnings.length, mode === 'success' ? 0 : 1);
            if (mode === 'pending') {
                assert.match(warnings[0][0], /timed out after 50ms/);
                assert.equal(workCompleted, false);
                t.mock.timers.tick(4950);
                await flush();
                assert.equal(workCompleted, true, 'timeout must not cancel ongoing work');
                assert.equal(warnings.length, 1);
            } else if (mode !== 'success') assert.equal(warnings[0][1], error);
        });
    }
}

// Inject directly into each awaited boundary as well, without replacing the guarded callback.
export function testLayoutDependency(sourceUrl, target) {
    for (const mode of ['throw', 'reject', 'pending']) {
        test(`${sourceUrl.pathname.split('/').pop()}: ${target} ${mode}`, async t => {
            t.mock.method(console, 'warn', () => {});
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const fixture = layoutFixture();
            let reached = false;
            const fault = () => {
                reached = true;
                if (mode === 'throw') throw new Error(target);
                if (mode === 'reject') return Promise.reject(new Error(target));
                return new Promise(() => {});
            };
            const segments = target.split('.');
            const member = segments.pop();
            const object = segments.reduce((object, segment) => object[segment], fixture);
            object[member] = fault;
            const method = loadInitLayout(sourceUrl, {
                ...fixture.dependencies,
                guardInitLayout: (name, fn) => guardInitLayout(name, fn, { timeoutMs: 50 })
            });
            let done = false;
            const started = performance.now();
            const result = method.call(fixture.instance, fixture.app).then(() => { done = true; });
            await flush();
            assert.equal(reached, true);
            if (mode === 'pending') {
                assert.equal(done, false, 'the real method awaits this dependency');
                t.mock.timers.tick(50);
            }
            await result;
            assert.ok(performance.now() - started < 2000);
        });
    }
}

export function testLayoutSynchronousFailure(sourceUrl, member) {
    test(`${sourceUrl.pathname.split('/').pop()}: real ${member} throws`, async t => {
        const fixture = layoutFixture();
        const error = new Error(member);
        const warnings = [];
        t.mock.method(console, 'warn', (...args) => warnings.push(args));
        fixture.instance[member] = () => { throw error; };
        const method = loadInitLayout(sourceUrl, fixture.dependencies);
        await assert.doesNotReject(method.call(fixture.instance, fixture.app));
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0][1], error);
    });
}
