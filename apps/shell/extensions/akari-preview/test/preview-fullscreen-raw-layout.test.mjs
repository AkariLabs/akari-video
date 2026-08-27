import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const compiled = readFileSync(
    join(here, '..', 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

function extractMethod(name) {
    const start = compiled.indexOf(`    ${name}(`);
    assert.notEqual(start, -1, `${name} が compiled lib に見つからない`);
    const bodyStart = compiled.indexOf('{', start);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = bodyStart; index < compiled.length; index += 1) {
        const character = compiled[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = '';
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth += 1;
        if (character === '}' && --depth === 0) return compiled.slice(start, index + 1).trim();
    }
    assert.fail(`${name} の終端が見つからない`);
}

function extractTemplate(methodName) {
    const methodAt = compiled.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiled.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let index = tick + 1;
    let output = '';
    while (index < compiled.length) {
        const character = compiled[index];
        if (character === '\\') {
            const next = compiled[index + 1];
            if (next === 'n') output += '\n';
            else if (next === 't') output += '\t';
            else if (next === 'r') output += '\r';
            else output += next;
            index += 2;
            continue;
        }
        if (character === '`') break;
        if (character === '$' && compiled[index + 1] === '{') {
            let braces = 1;
            index += 2;
            while (index < compiled.length && braces > 0) {
                const nested = compiled[index];
                if (nested === '\\') { index += 2; continue; }
                if (nested === '{') braces += 1;
                else if (nested === '}') braces -= 1;
                index += 1;
            }
            output += '0';
            continue;
        }
        output += character;
        index += 1;
    }
    return output;
}

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add: value => values.add(value),
        remove: value => values.delete(value),
        contains: value => values.has(value)
    };
}

function createSignal() {
    const callbacks = new Set();
    return {
        connect: callback => callbacks.add(callback),
        disconnect: callback => callbacks.delete(callback),
        emit: () => {
            for (const callback of [...callbacks]) callback();
        }
    };
}

function createFullscreenRuntime() {
    const enterSource = extractMethod('enterPreviewFullscreen');
    const exitSource = extractMethod('exitPreviewFullscreen');
    const context = {
        PREVIEW_FULLSCREEN_CLASS: 'akari-preview-fullscreen',
        PREVIEW_FULLSCREEN_ANCESTOR_CLASS: 'akari-preview-fullscreen-ancestor',
        disposable_1: {
            Disposable: {
                create: dispose => ({ dispose })
            }
        }
    };
    return {
        enter: vm.runInNewContext(`(function ${enterSource})`, context),
        exit: vm.runInNewContext(`(function ${exitSource})`, context)
    };
}

function createScenario() {
    const documentElement = { classList: createClassList(), parentElement: null };
    const body = { classList: createClassList(), parentElement: documentElement };
    const dock = { classList: createClassList(), parentElement: body };
    const panel = { classList: createClassList(), parentElement: dock };
    const listeners = new Map();
    const ownerDocument = {
        body,
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => {
            if (listeners.get(type) === listener) listeners.delete(type);
        }
    };
    const disposed = createSignal();
    const messages = [];
    const widget = {
        node: {
            ownerDocument,
            parentElement: panel,
            classList: createClassList()
        },
        disposed,
        isDisposed: false,
        sendMessage: message => messages.push(message)
    };
    const disposables = [];
    const handler = {
        ensurePreviewFullscreenStyle: document => assert.equal(document, ownerDocument),
        toDisposeOnPreviewFullscreenExit: {
            push: disposable => disposables.push(disposable),
            dispose: () => {
                for (const disposable of disposables.splice(0)) disposable.dispose();
            }
        }
    };
    const runtime = createFullscreenRuntime();
    handler.enterPreviewFullscreen = runtime.enter;
    handler.exitPreviewFullscreen = runtime.exit;
    return { body, dock, panel, documentElement, handler, widget, messages };
}

test('全画面 enter/exit は ownerDocument.body までの祖先クラスを対称に復元する', () => {
    const state = createScenario();
    state.handler.enterPreviewFullscreen(state.widget);

    for (const ancestor of [state.panel, state.dock, state.body]) {
        assert.equal(ancestor.classList.contains('akari-preview-fullscreen-ancestor'), true);
    }
    assert.equal(state.documentElement.classList.contains('akari-preview-fullscreen-ancestor'), false);
    assert.equal(state.widget.node.classList.contains('akari-preview-fullscreen'), true);

    state.handler.exitPreviewFullscreen();

    for (const ancestor of [state.panel, state.dock, state.body]) {
        assert.equal(ancestor.classList.contains('akari-preview-fullscreen-ancestor'), false);
    }
    assert.equal(state.widget.node.classList.contains('akari-preview-fullscreen'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(state.messages)), [
        { type: 'akari-preview-fullscreen-state', active: true },
        { type: 'akari-preview-fullscreen-state', active: false }
    ]);
});

test('全画面 widget の破棄でも祖先クラスを漏れなく復元する', () => {
    const state = createScenario();
    state.handler.enterPreviewFullscreen(state.widget);
    state.widget.isDisposed = true;
    state.widget.disposed.emit();

    for (const ancestor of [state.panel, state.dock, state.body]) {
        assert.equal(ancestor.classList.contains('akari-preview-fullscreen-ancestor'), false);
    }
    assert.equal(state.widget.node.classList.contains('akari-preview-fullscreen'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(state.messages)), [
        { type: 'akari-preview-fullscreen-state', active: true }
    ]);
});

test('全画面スタイルは祖先の z-index スタッキングコンテキストを解除する', () => {
    const ensureStyle = vm.runInNewContext(`(function ${extractMethod('ensurePreviewFullscreenStyle')})`, {
        PREVIEW_FULLSCREEN_CLASS: 'akari-preview-fullscreen',
        PREVIEW_FULLSCREEN_ANCESTOR_CLASS: 'akari-preview-fullscreen-ancestor',
        PREVIEW_FULLSCREEN_STYLE_ID: 'akari-preview-fullscreen-style'
    });
    let appendedStyle;
    const ownerDocument = {
        getElementById: () => null,
        createElement: () => ({}),
        head: { appendChild: style => { appendedStyle = style; } }
    };
    ensureStyle(ownerDocument);
    assert.match(appendedStyle.textContent, /\.akari-preview-fullscreen-ancestor \{\s*z-index: auto !important;/u);
});

test('raw wrapper と stage は素材比の固定矩形で両軸中央に留まる', () => {
    const hostAdapter = extractTemplate('hostAdapterScript');
    assert.doesNotThrow(() => new vm.Script(hostAdapter, { filename: 'host-adapter.js' }));
    const rawStart = hostAdapter.indexOf("if (initial.kind === 'raw')");
    const rawSection = hostAdapter.slice(rawStart);
    assert.ok(rawStart >= 0, 'raw 分岐が webview script に見つからない');
    assert.match(rawSection, /wrapper\.style\.position = 'absolute';/u);
    assert.match(rawSection, /wrapper\.style\.inset = '0';/u);
    assert.match(rawSection, /wrapper\.style\.margin = 'auto';/u);
    assert.match(rawSection, /wrapper\.style\.width = fit\.width \+ 'px';/u);
    assert.match(rawSection, /wrapper\.style\.height = fit\.height \+ 'px';/u);
    assert.match(rawSection, /previewStage\.style\.aspectRatio = video\.videoWidth \+ ' \/ ' \+ video\.videoHeight;/u);
    assert.match(rawSection, /previewStage\.style\.width = 'min\(100cqw, calc\(100cqh \* '/u);
    assert.match(rawSection, /\+ video\.videoWidth \+ ' \/ ' \+ video\.videoHeight \+ '\)\)';/u);
});
