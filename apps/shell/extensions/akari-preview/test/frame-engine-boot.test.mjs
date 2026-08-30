import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const compiledHandler = readFileSync(
    join(extensionRoot, 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);

function extractTemplate(methodName) {
    const methodAt = compiledHandler.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiledHandler.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let index = tick + 1;
    let output = '';
    while (index < compiledHandler.length) {
        const character = compiledHandler[index];
        if (character === '\\') {
            const next = compiledHandler[index + 1];
            if (next === 'n') output += '\n';
            else if (next === 't') output += '\t';
            else if (next === 'r') output += '\r';
            else output += next;
            index += 2;
            continue;
        }
        if (character === '`') break;
        if (character === '$' && compiledHandler[index + 1] === '{') {
            let braces = 1;
            index += 2;
            while (index < compiledHandler.length && braces > 0) {
                const nested = compiledHandler[index];
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

const watchdog = extractTemplate('frameEngineWatchdogScript');

function executeWatchdog({ error, rejection, engine = {}, root = null, engineErrorText = '' } = {}) {
    const listeners = new Map();
    let timeoutCallback;
    const nodes = new Map();
    const parent = {
        append(node) {
            nodes.set(node.id, node);
            node.parentElement = this;
        }
    };
    nodes.set('preview-message', { id: 'preview-message', parentElement: parent });
    if (root) nodes.set('frame-engine-preview', root);
    if (engineErrorText) nodes.set('frame-engine-error', { textContent: engineErrorText });
    const document = {
        documentElement: { dataset: {} },
        getElementById: id => nodes.get(id) ?? null,
        createElement: () => ({
            dataset: {},
            setAttribute() {},
            addEventListener() {},
            append(...children) { this.children = children; },
            remove() { nodes.delete(this.id); }
        })
    };
    const window = {
        __akariPreview: {},
        AkariFrameEngine: engine,
        addEventListener: (type, listener) => listeners.set(type, listener),
        setTimeout: callback => { timeoutCallback = callback; }
    };
    window.window = window;
    vm.runInNewContext(watchdog, { window, document, Number, String, Boolean, JSON });
    if (error) listeners.get('error')(error);
    if (rejection) listeners.get('unhandledrejection')(rejection);
    timeoutCallback();
    return { dataset: document.documentElement.dataset, nodes };
}

test('frame-engine scripts は watchdog、bundle、bootstrap の順で注入する', () => {
    assert.match(
        compiledHandler,
        /\? `<script>\$\{this\.frameEngineWatchdogScript\(\)\}<\/script>\\n<script>\$\{this\.inlineScript\(assets\.frameEngineJavaScript\)\}<\/script>\\n<script>\$\{this\.frameEngineBootstrapScript\(\)\}<\/script>\\n`\s*: '';/u
    );
});

test('frame-engine flag off では watchdog を含む注入全体が空文字になる', () => {
    assert.match(
        compiledHandler,
        /const frameEngineScripts = frameEngineEnabled && assets\.frameEngineJavaScript[\s\S]*?: '';/u
    );
});

test('fallback message は widget を opt-out して旧経路で強制再構築する', () => {
    assert.match(compiledHandler, /message\?\.type === 'akari-preview-frame-engine-fallback'/u);
    assert.match(compiledHandler, /widget\.akariPreviewFrameEngineOptOut = true;/u);
    assert.match(
        compiledHandler,
        /queueRefresh\(widget, identityUri, kind, widget\.akariPreviewLastKnownTime, true\)/u
    );
    assert.match(
        compiledHandler,
        /kind === 'output'\s*&& widget\.akariPreviewFrameEngineOptOut !== true\s*&& await this\.resolveFrameEngineEnabled\(\)/u
    );
    assert.match(
        compiledHandler,
        /requestFrameEngineFallback = \(\) => vscode\.postMessage\(\{ type: 'akari-preview-frame-engine-fallback' \}\)/u
    );
});

test('watchdog timeout は既定 15000 ms で環境変数の有限正数を initial state へ渡す', () => {
    assert.match(watchdog, /: 15000;/u);
    assert.match(compiledHandler, /getValue\('AKARI_FRAME_ENGINE_READY_TIMEOUT_MS'\)/u);
    assert.match(compiledHandler, /Number\.isFinite\(value\) && value > 0 \? value : undefined/u);
    assert.match(
        compiledHandler,
        /frameEngineReadyTimeoutMs === undefined \? \{\} : \{ frameEngineReadyTimeoutMs \}/u
    );
});

test('watchdog は boot 失敗を捕捉し、見える fallback カードを作る', () => {
    assert.match(watchdog, /addEventListener\('error', recordError, true\)/u);
    assert.match(watchdog, /addEventListener\('unhandledrejection', recordRejection, true\)/u);
    assert.match(watchdog, /frame-engine-boot-error/u);
    assert.match(watchdog, /data\.frameEngineBootFailure|dataset\.frameEngineBootFailure/u);
    assert.match(watchdog, /旧経路で開き直す/u);
    assert.match(watchdog, /target\.length >= 5/u);
});

test('watchdog 原因は error を優先し rejection だけなら補足へ回す', () => {
    const both = executeWatchdog({
        error: { message: 'bootstrap syntax', filename: 'webview.html', lineno: 42, colno: 7 },
        rejection: { reason: new Error('unrelated pressure observer') }
    });
    assert.equal(
        both.dataset.frameEngineBootFailure,
        '最初のエラー: bootstrap syntax (webview.html:42)'
    );

    const rejectionOnly = executeWatchdog({
        rejection: { reason: new Error('unrelated pressure observer') }
    });
    assert.equal(
        rejectionOnly.dataset.frameEngineBootFailure,
        '初期化スクリプトが実行されていません (#frame-engine-preview 未生成)'
            + '（未処理の Promise 拒否: unrelated pressure observer）'
    );

    const engineError = executeWatchdog({
        root: { dataset: { frameEngineReady: 'false' } },
        engineErrorText: 'Frame engine: decoder failed'
    });
    assert.equal(
        engineError.dataset.frameEngineBootFailure,
        '初期化が 15000 ms 以内に完了しませんでした (data-frame-engine-ready=false)'
            + ' / engine エラー: Frame engine: decoder failed'
    );
});

test('watchdog は error と rejection を区別した診断 JSON を dataset へ載せる', () => {
    const result = executeWatchdog({
        error: { message: 'syntax', filename: 'webview.html', lineno: 3, colno: 9 },
        rejection: { reason: new Error('pressure observer') }
    });
    const diagnostics = JSON.parse(result.dataset.frameEngineBootErrors);
    assert.deepEqual(
        diagnostics.events.map(event => event.type),
        ['error', 'rejection']
    );
    assert.ok(result.dataset.frameEngineBootErrors.length <= 2000);
});
