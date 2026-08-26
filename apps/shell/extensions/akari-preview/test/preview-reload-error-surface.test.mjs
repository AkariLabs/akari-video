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

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} が webview script に見つからない`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
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
        if (character === '}' && --depth === 0) return source.slice(start, index + 1);
    }
    assert.fail(`${name} の終端が見つからない`);
}

const bootstrap = extractTemplate('hostAdapterScript');
const functionNames = ['showReloadToast', 'showReloadError', 'hideReloadError', 'applyCompositeError'];
const statusFunctions = functionNames.map(name => extractFunction(bootstrap, name)).join('\n');

function createStatusRuntime() {
    const reloadToast = { hidden: true };
    const reloadErrorCard = { hidden: true };
    const reloadErrorDetail = { textContent: '' };
    const compositeErrorBanner = { hidden: true };
    const compositeErrorDetail = { textContent: '' };
    const timers = [];
    const window = {
        clearTimeout: id => { timers[id].cleared = true; },
        setTimeout: (callback, delay) => {
            timers.push({ callback, delay, cleared: false });
            return timers.length - 1;
        }
    };
    const runtime = vm.runInNewContext(`(() => {
        let reloadToastTimer;
        ${statusFunctions}
        return { showReloadToast, showReloadError, hideReloadError, applyCompositeError };
    })()`, {
        window,
        reloadToast,
        reloadErrorCard,
        reloadErrorDetail,
        compositeErrorBanner,
        compositeErrorDetail
    });
    return {
        runtime,
        timers,
        reloadToast,
        reloadErrorCard,
        reloadErrorDetail,
        compositeErrorBanner,
        compositeErrorDetail
    };
}

test('成功リロードのトーストは表示され 4 秒後に消える', () => {
    const state = createStatusRuntime();
    state.runtime.showReloadToast();
    assert.equal(state.reloadToast.hidden, false);
    assert.equal(state.timers.length, 1);
    assert.equal(state.timers[0].delay, 4000);
    state.timers[0].callback();
    assert.equal(state.reloadToast.hidden, true);
    assert.match(bootstrap, /if \(initial\.reloadNotice\) showReloadToast\(\)/u);
});

test('失敗は旧 DOM 上の非モーダルカードへ要旨を表示する', () => {
    const state = createStatusRuntime();
    state.runtime.showReloadError('JSON が壊れています');
    assert.equal(state.reloadErrorCard.hidden, false);
    assert.equal(state.reloadErrorDetail.textContent, 'JSON が壊れています');

    const methodStart = compiled.indexOf('handleRefreshFailure(widget, error) {');
    const methodEnd = compiled.indexOf('\n    resourceSuffix(', methodStart);
    const methodSection = compiled.slice(methodStart, methodEnd);
    const method = methodSection.slice(0, methodSection.lastIndexOf('\n    }') + 6).trim();
    assert.ok(methodStart >= 0 && methodEnd > methodStart);
    assert.doesNotMatch(method, /setHTML|showMessageCard/u);
    const handleRefreshFailure = vm.runInNewContext(`(function ${method})`, {
        preview_error_summary_1: { summarizePreviewError: () => '安全な要旨' }
    });
    const messages = [];
    handleRefreshFailure({
        isDisposed: false,
        sendMessage: message => messages.push(message),
        setHTML: () => assert.fail('旧 webview を差し替えてはならない')
    }, new Error('raw'));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'akari-preview-refresh-error');
    assert.equal(messages[0].message, '安全な要旨');
});

test('縮退バナーは要旨付きで常設される', () => {
    const state = createStatusRuntime();
    state.runtime.applyCompositeError('source.path が不正です');
    assert.equal(state.compositeErrorBanner.hidden, false);
    assert.equal(state.compositeErrorDetail.textContent, 'source.path が不正です');
    assert.match(compiled, /compositeError: \(0, preview_error_summary_1\.summarizePreviewError\)\(error\)/u);
});

test('refresh-ok と再構築の双方で解消済み表示を消す', () => {
    const incremental = createStatusRuntime();
    incremental.runtime.showReloadError('前回の失敗');
    incremental.runtime.applyCompositeError('前回の縮退');
    incremental.runtime.hideReloadError();
    incremental.runtime.applyCompositeError(null);
    assert.equal(incremental.reloadErrorCard.hidden, true);
    assert.equal(incremental.compositeErrorBanner.hidden, true);

    const rebuilt = createStatusRuntime();
    rebuilt.runtime.applyCompositeError(null);
    assert.equal(rebuilt.reloadErrorCard.hidden, true);
    assert.equal(rebuilt.compositeErrorBanner.hidden, true);

    assert.match(bootstrap, /akari-preview-refresh-ok[\s\S]*hideReloadError\(\);[\s\S]*applyCompositeError\(message\.compositeError\)/u);
    assert.match(compiled, /const reloadNotice = widget\.akariPreviewModelSnapshot !== undefined;\s*widget\.setHTML/u);
});

test('失敗・成功・再試行のホスト配線と z-index 優先順位を維持する', () => {
    assert.match(compiled, /failed to refresh preview[\s\S]*this\.handleRefreshFailure\(widget, error\)/u);
    assert.match(compiled, /akari-preview-reload-retry[\s\S]*this\.queueRefresh\(widget, identityUri, kind, undefined, true\)/u);
    assert.ok((compiled.match(/type: 'akari-preview-refresh-ok'/gu) ?? []).length >= 2);
    assert.match(compiled, /\.message-card \{[^}]*z-index: 10/u);
    assert.match(compiled, /\.reload-surface \{[^}]*z-index: 8[^}]*display: flex[^}]*flex-direction: column[^}]*gap: 6px[^}]*pointer-events: none/u);
    assert.match(compiled, /\.reload-surface > \* \{[^}]*position: static[^}]*transform: none[^}]*width: 100%/u);
    assert.match(compiled, /#reload-error-retry \{[^}]*pointer-events: auto/u);

    const surfaceStart = compiled.indexOf('<div id="reload-surface" class="reload-surface">');
    const surfaceEnd = compiled.indexOf('<div id="audio-notice"', surfaceStart);
    const surface = compiled.slice(surfaceStart, surfaceEnd);
    assert.ok(surfaceStart >= 0 && surfaceEnd > surfaceStart, '通知コンテナが audio notice より前に存在する');
    const childPositions = [
        'id="reload-toast"',
        'id="composite-error-banner"',
        'id="reload-error-card"'
    ].map(id => surface.indexOf(id));
    assert.ok(childPositions.every(position => position >= 0), '3 通知が同じコンテナ内に存在する');
    assert.deepEqual([...childPositions].sort((left, right) => left - right), childPositions);
});
