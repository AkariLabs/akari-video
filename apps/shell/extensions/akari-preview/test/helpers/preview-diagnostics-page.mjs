// 診断ガード／診断末尾スクリプトを「実際に注入される形」で評価するためのハーネス。
//
// akari-preview-open-handler.ts の `previewDiagnosticsGuardScript()` /
// `previewDiagnosticsTailScript()` は、共通モジュールの関数を toString() で埋め込む
// テンプレートリテラルを返す。ここでは TypeScript の AST でそのテンプレートを取り出し、
// 共通モジュールの実物を渡して評価し（= webview へ送られる本物の JS 文字列を得て）、
// 最小の DOM スタブの上で走らせる。jsdom はこのリポには入っていないので使わない。

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
export const diagnosticsModule = require('../../lib/common/preview-init-diagnostics.js');

const handlerPath = fileURLToPath(new URL('../../src/browser/akari-preview-open-handler.ts', import.meta.url));
const handlerSource = readFileSync(handlerPath, 'utf8');
const handlerFile = ts.createSourceFile(handlerPath, handlerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** 指定メソッドが return するテンプレートリテラルのソース（`${}` を含む生テキスト）。 */
export function methodTemplateSource(name) {
    let found;
    const visit = node => {
        if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === name) {
            const body = node.body;
            if (body) {
                ts.forEachChild(body, child => {
                    if (ts.isReturnStatement(child) && child.expression) {
                        found = child.expression.getText(handlerFile);
                    }
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(handlerFile);
    assert.ok(found, `${name}() のテンプレートリテラルが見つかりません`);
    return found;
}

/** テンプレートを評価して、webview に実際に入る JS 文字列を得る。 */
export function injectedScript(name) {
    return vm.runInNewContext(methodTemplateSource(name), { ...diagnosticsModule, JSON, String, Number });
}

/** prepareHtml() の本文（スクリプトの並び順の検査に使う）。 */
export function prepareHtmlSource() {
    let found;
    const visit = node => {
        if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)
            && node.name.text === 'prepareHtml') {
            found = node.getText(handlerFile);
        }
        ts.forEachChild(node, visit);
    };
    visit(handlerFile);
    assert.ok(found, 'prepareHtml() が見つかりません');
    return found;
}

function createElement(tagName, registry) {
    const element = {
        tagName: String(tagName).toUpperCase(),
        id: '',
        type: '',
        textContent: '',
        hidden: false,
        style: {},
        dataset: {},
        attributes: {},
        children: [],
        parentElement: null,
        listeners: new Map(),
        readyState: 0,
        complete: false,
        naturalWidth: 0,
        clientWidth: 0,
        setAttribute(name, value) { element.attributes[name] = String(value); },
        getAttribute(name) { return element.attributes[name] ?? null; },
        addEventListener(type, handler) {
            const bucket = element.listeners.get(type) ?? [];
            bucket.push(handler);
            element.listeners.set(type, bucket);
        },
        removeEventListener(type, handler) {
            const bucket = element.listeners.get(type) ?? [];
            element.listeners.set(type, bucket.filter(candidate => candidate !== handler));
        },
        dispatch(type, event) {
            for (const handler of element.listeners.get(type) ?? []) handler(event);
        },
        append(...nodes) {
            for (const node of nodes) {
                node.parentElement = element;
                element.children.push(node);
                if (node.id) registry.set(node.id, node);
            }
        },
        remove() {
            const siblings = element.parentElement?.children ?? [];
            const index = siblings.indexOf(element);
            if (index >= 0) siblings.splice(index, 1);
            if (element.id) registry.delete(element.id);
            element.parentElement = null;
        },
        querySelector() { return null; },
        querySelectorAll() { return []; }
    };
    return element;
}

/**
 * 最小の webview 環境。`state` に何を持たせるかで段の到達状況を作り分ける。
 *
 * - `pressureObserver`: 'rejecting'（既定 / 拒否する本物相当）| 'none' | 'sealed'（削除不可）
 * - `globals`: window に載せるグローバル（akari / AkariEditKernel / AkariFrameEngine）
 */
export function createPreviewPage({
    initial = {},
    pressureObserver = 'rejecting',
    globals = {}
} = {}) {
    const registry = new Map();
    const timeouts = [];
    const intervals = [];
    const posted = [];
    const consoleCalls = [];
    const rejections = [];

    const context = {
        console: {
            log: (...args) => consoleCalls.push(args),
            warn: (...args) => consoleCalls.push(args),
            info: (...args) => consoleCalls.push(args),
            error: (...args) => consoleCalls.push(args),
            debug: (...args) => consoleCalls.push(args)
        },
        navigator: { userAgent: 'test-electron-ua', clipboard: undefined },
        performance: { now: () => 1000 }
    };
    context.window = context;
    context.globalThis = context;

    const document = {
        listeners: new Map(),
        addEventListener(type, handler) {
            const bucket = document.listeners.get(type) ?? [];
            bucket.push(handler);
            document.listeners.set(type, bucket);
        },
        createElement: tagName => createElement(tagName, registry),
        getElementById: id => registry.get(id) ?? null,
        createRange: () => ({ selectNodeContents() {} }),
        querySelector: () => null
    };
    document.documentElement = createElement('html', registry);
    document.body = createElement('body', registry);
    document.documentElement.append(document.body);
    context.document = document;

    for (const id of ['preview-video', 'preview-still', 'preview-stage', 'preview-layers', 'preview-message']) {
        const node = createElement(id === 'preview-video' ? 'video' : 'div', registry);
        node.id = id;
        registry.set(id, node);
        document.body.append(node);
    }

    context.setTimeout = (handler, ms) => {
        timeouts.push({ handler, ms });
        return timeouts.length;
    };
    context.clearTimeout = () => {};
    context.setInterval = (handler, ms) => {
        intervals.push({ handler, ms });
        return intervals.length;
    };
    context.clearInterval = () => {};
    context.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
    context.addEventListener = (type, handler) => {
        const bucket = document.listeners.get('window:' + type) ?? [];
        bucket.push(handler);
        document.listeners.set('window:' + type, bucket);
    };
    context.removeEventListener = () => {};
    context.dispatch = (type, event) => {
        for (const handler of document.listeners.get('window:' + type) ?? []) handler(event);
    };

    if (pressureObserver !== 'none') {
        // 本物と同じ「observe() が拒否する Promise を返す」形。WebAV は catch を付けていない。
        class RejectingPressureObserver {
            constructor(callback) { this.callback = callback; }
            observe() {
                return Promise.reject(new Error('NotAllowedError: compute-pressure'));
            }
        }
        if (pressureObserver === 'sealed') {
            Object.defineProperty(context, 'PressureObserver', {
                value: RejectingPressureObserver,
                configurable: false,
                writable: true,
                enumerable: true
            });
        } else {
            context.PressureObserver = RejectingPressureObserver;
        }
    }

    context.__akariPreview = initial;
    Object.assign(context, globals);

    const sandbox = vm.createContext(context);
    // 未処理拒否の観測（第13項の再現検査に使う）。
    const runWebAvLogInit = () => {
        vm.runInContext(
            `(() => { if ("PressureObserver" in globalThis) {`
            + ` const observer = new PressureObserver(() => {});`
            + ` const result = observer.observe("cpu");`
            + ` if (result && typeof result.then === 'function') {`
            + `   result.then(() => { globalThis.__webavObserveSettled = 'resolved'; },`
            + `     reason => { globalThis.__webavObserveSettled = 'rejected:' + String(reason && reason.message); });`
            + ` } globalThis.__webavObserveCalled = true; } else { globalThis.__webavObserveCalled = false; } })()`,
            sandbox
        );
        return {
            observeCalled: sandbox.__webavObserveCalled,
            settled: () => sandbox.__webavObserveSettled
        };
    };

    return {
        context: sandbox,
        registry,
        timeouts,
        intervals,
        posted,
        rejections,
        consoleCalls,
        run(script) { return vm.runInContext(script, sandbox); },
        runWebAvLogInit,
        diag: () => sandbox.__akariPreviewDiag,
        /** hostAdapterScript が渡すのと同じ形の vscode api を繋ぐ。 */
        attachHost() {
            sandbox.__akariPreviewDiag.attachHost({ postMessage: message => posted.push(message) });
        },
        card: () => registry.get('akari-preview-diagnostics-card') ?? null,
        cardText: () => registry.get('akari-preview-diagnostics-report')?.textContent ?? '',
        cardTitle: () => registry.get('akari-preview-diagnostics-title')?.textContent ?? '',
        /** 監視タイマー（18 秒）を手で発火させる。 */
        fireAlarm() {
            const alarm = timeouts.find(entry => entry.ms === 18000);
            assert.ok(alarm, '18000ms の監視タイマーが仕掛けられていません');
            alarm.handler();
        },
        /** 段の観測（250ms 間隔）を手で 1 回回す。 */
        probeOnce() {
            const probe = intervals.find(entry => entry.ms === 250);
            assert.ok(probe, '250ms の段観測が仕掛けられていません');
            probe.handler();
        }
    };
}
