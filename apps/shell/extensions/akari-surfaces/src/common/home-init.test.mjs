import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const sourceUrl = new URL('../browser/akari-home-widget.tsx', import.meta.url);
const source = ts.createSourceFile(sourceUrl.pathname, readFileSync(sourceUrl, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariHomeWidget');
const method = name => {
    const member = owner.members.find(node => node.name?.getText(source) === name);
    assert.ok(member, name);
    return member;
};

// init-layout.test.mjs と同様、実ソースのメソッドを DOM/DI の import なしで実行する。
function loadMethod(name, dependencies = {}) {
    const code = ts.transpileModule(`class Home extends Base { ${method(name).getText(source)} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.React }
    }).outputText;
    const deps = { Base: class {}, performance: undefined, ...dependencies };
    return new Function(...Object.keys(deps), `${code}\nreturn Home.prototype.${name};`)(...Object.values(deps));
}

for (const active of ['outside', 'none', 'child', 'self']) {
    test(`home activation preserves ReactWidget behavior and handles focus: ${active}`, () => {
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
            Base: class {
                onActivateRequest(msg) {
                    assert.equal(msg, message);
                    assert.equal(this.node, node);
                    calls.push('super');
                }
            }
        });
        activate.call({ node }, message);
        const shouldFocus = active === 'outside' || active === 'none';
        assert.deepEqual(calls, shouldFocus ? ['super', 'focus'] : ['super']);
        assert.equal(document.activeElement, shouldFocus ? node : before);
        if (!shouldFocus) assert.equal(node.tabIndex, 0);
    });
}

const initialSteps = [
    'refreshWelcomeMode', 'loadHomeFlow', 'loadCreatorRootProjects',
    'loadStandaloneProjects', 'initializeFirstRunSetup', 'refreshCurrentLocation'
];
const deferredSteps = ['initializeProjectLauncher', 'loadUpdateStatus', 'checkVersionNotice'];
const allSteps = [...initialSteps, ...deferredSteps];

test('start source fixes the awaited methods before and after its first update', () => {
    const before = [];
    const after = [];
    let updated = false;
    for (const statement of method('start').body.statements) {
        if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
            && statement.expression.expression.getText(source) === 'this.update') {
            updated = true;
        }
        const visit = node => {
            // The measurement helper's await run() is not an initialization step.
            if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return;
            if (ts.isAwaitExpression(node)) {
                const call = node.expression;
                assert.ok(ts.isCallExpression(call));
                assert.equal(call.expression.getText(source), 'measureStep');
                const [label, callback] = call.arguments;
                assert.ok(ts.isStringLiteral(label));
                assert.ok(ts.isArrowFunction(callback) && ts.isCallExpression(callback.body));
                assert.equal(callback.body.expression.getText(source), `this.${label.text}`);
                (updated ? after : before).push(label.text);
            }
            ts.forEachChild(node, visit);
        };
        visit(statement);
    }
    assert.ok(updated);
    assert.deepEqual(before, initialSteps);
    assert.deepEqual(after, deferredSteps);
});

function startFixture(firstRunWillAutoOpen = false) {
    const calls = [];
    const instance = {
        homeReady: false, watching: false, toDispose: [],
        update() { assert.equal(this.homeReady, true); calls.push('update'); },
        initUpdaterEvents() { calls.push('updater'); },
        fileService: { onDidFilesChange() { calls.push('watch'); return { dispose() {} }; } }
    };
    for (const step of allSteps) {
        instance[step] = async (...args) => {
            calls.push(step);
            assert.equal(instance.homeReady, deferredSteps.includes(step), step);
            if (step === 'initializeProjectLauncher') assert.deepEqual(args, [firstRunWillAutoOpen]);
            if (step === 'initializeFirstRunSetup') return firstRunWillAutoOpen;
        };
    }
    return { calls, instance };
}

for (const firstRunWillAutoOpen of [false, true]) {
    test(`start works without performance and retains first-run priority: ${firstRunWillAutoOpen}`, async () => {
        const { calls, instance } = startFixture(firstRunWillAutoOpen);
        await loadMethod('start').call(instance);
        assert.deepEqual(calls, [...initialSteps, 'update', ...deferredSteps.slice(0, 2), 'updater', 'checkVersionNotice', 'watch']);
        assert.equal(instance.watching, true);
        assert.equal(instance.toDispose.length, 1);
    });
}

test('ready stays false until every initial await resolves and precedes deferred work', async () => {
    const { instance } = startFixture();
    let release;
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    instance.refreshCurrentLocation = () => {
        reached();
        return new Promise(resolve => { release = resolve; });
    };
    const started = loadMethod('start').call(instance);
    await waiting;
    assert.equal(instance.homeReady, false);
    release();
    await started;
    assert.equal(instance.homeReady, true);
});

test('all nine steps retain performance measures and print a single data row', async () => {
    const { instance } = startFixture();
    const marks = new Map();
    const measures = [];
    const tables = [];
    let clock = 0;
    const performance = {
        mark(name) { marks.set(name, clock++); },
        measure(name, start, end) {
            assert.ok(marks.has(start) && marks.has(end));
            const entry = { name, entryType: 'measure', duration: marks.get(end) - marks.get(start) };
            measures.push(entry);
            return entry;
        },
        clearMarks(name) { marks.delete(name); },
        clearMeasures() { assert.fail('CDP needs retained measures'); }
    };
    await loadMethod('start', { performance, console: { table: rows => tables.push(rows) } }).call(instance);
    assert.deepEqual(measures.map(entry => entry.name), allSteps.map(step => `akari-home:${step}`));
    assert.ok(measures.every(entry => entry.duration === 1));
    assert.equal(marks.size, 0);
    assert.deepEqual(tables, [[Object.fromEntries(allSteps.map(step => [`${step} (ms)`, 1]))]]);
});

test('both rendered roots expose readiness only after initial data is ready', () => {
    const React = { createElement: (tag, props, ...children) => ({ tag, props, children }) };
    const render = loadMethod('render', { React });
    const renderWelcomeSurface = loadMethod('renderWelcomeSurface', { React, homeFlowStyles: {} });
    const instance = { updateStatus: {}, updaterUiState: {}, renderWelcomeSurface };
    for (const name of ['renderDashboardHeader', 'renderExplanation', 'renderProjectList', 'renderStoreCard', 'renderWelcomeCard']) {
        instance[name] = () => null;
    }
    for (const welcomeMode of [false, true]) {
        for (const homeReady of [false, true]) {
            Object.assign(instance, { welcomeMode, homeReady });
            const root = render.call(instance);
            assert.equal(root.props['data-akari-home-stage'], welcomeMode ? 'welcome' : 'dashboard');
            assert.equal(root.props['data-akari-home-ready'], String(homeReady));
        }
    }
});
