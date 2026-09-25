import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { installOverlayBoxRequestListener, measureOverlayBoxInStage, unscaleOverlayBox } from '../lib/common/preview-overlay-measure.js';

test('縮小して測った box はコンテナ中心を基準に元の座標へ戻る', () => {
    const output = { width: 1280, height: 720 };
    // 左上寄せの 1520×860 の板と周囲の余白を含む 1660×900 の枠。
    assert.deepEqual(unscaleOverlayBox(output, { x: 462.5, y: 260.75, width: 415, height: 225 }, 0.25),
        { x: -70, y: -37, width: 1660, height: 900 });
});

test('選択枠の client 矩形を出力 px の未変形 box に戻す', async () => {
    let removed = false;
    const probe = {
        style: { setProperty() {} }, setAttribute() {}, appendChild() {}, querySelectorAll: () => [],
        remove() { removed = true; }
    };
    const document = {
        fonts: { ready: Promise.resolve() },
        createElement: name => name === 'template'
            ? { content: { cloneNode: () => ({}) }, set innerHTML(_value) {} } : probe
    };
    const window = {
        setTimeout, clearTimeout,
        akari: { viewportUnits: { applyAll() {} },
            interaction: { fragmentBounds: () => ({ left: 348, top: 188.75, width: 82.5, height: 44.5 }) } }
    };
    const stage = { appendChild() {}, getBoundingClientRect: () => ({ left: 100, top: 50, width: 640, height: 360 }) };
    const isolated = runInNewContext(`(${measureOverlayBoxInStage.toString()})`, { window, document });
    assert.deepEqual({ ...await isolated(stage, '<div>黒板</div>', {}, { width: 1280, height: 720 }) },
        { x: 64, y: 30, width: 660, height: 356 });
    assert.match(probe.style.transform, /scale\(0\.25\)/u);
    assert.equal(removed, true);
});

test('埋め込み listener は自身のスコープで stage と出力寸法を取り、例外でも返事する', async () => {
    const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(handler, /const unscaleOverlayBox = \(\$\{unscaleOverlayBox\.toString\(\)\}\);/u);
    assert.match(handler, /installOverlayBoxRequestListenerFn\(window, document, measureOverlayBoxFn,/u);
    assert.doesNotMatch(handler, /measureOverlayBoxFn\(stage, request\.fragment, request\.vars \?\? \{\}, output\)/u);
    const listeners = [];
    const replies = [];
    const win = { akari: { state: { summary: { output: { width: 1280, height: 720 } } } },
        addEventListener: (_type, listener) => listeners.push(listener) };
    const stage = { offsetWidth: 1280, offsetHeight: 720 };
    const doc = { getElementById: id => id === 'overlay-stage' ? stage : null };
    const install = runInNewContext(`(${installOverlayBoxRequestListener.toString()})`);
    install(win, doc, (foundStage, _html, _vars, output) => {
        assert.equal(foundStage, stage);
        assert.deepEqual({ ...output }, { width: 1280, height: 720 });
        return Promise.resolve({ x: 4, y: 5, width: 512, height: 288 });
    }, value => replies.push(value));
    listeners[0]({ data: { type: 'akari-preview-overlay-box-request', requestId: 'ok', fragment: '<div />' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(structuredClone(replies[0]), { type: 'akari-preview-overlay-box', requestId: 'ok',
        box: { x: 4, y: 5, width: 512, height: 288 } });

    install(win, doc, () => { throw new ReferenceError('probe failed'); }, value => replies.push(value));
    listeners[1]({ data: { type: 'akari-preview-overlay-box-request', requestId: 'error', fragment: '<div />' } });
    assert.deepEqual(structuredClone(replies[1]), { type: 'akari-preview-overlay-box', requestId: 'error' });

    install(win, doc, async () => { throw new Error('decode failed'); }, value => replies.push(value));
    listeners[2]({ data: { type: 'akari-preview-overlay-box-request', requestId: 'async-error', fragment: '<div />' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(structuredClone(replies[2]), { type: 'akari-preview-overlay-box', requestId: 'async-error' });
});

test('注入関数の本体はモジュール外の関数名に依存しない', () => {
    const source = readFileSync(new URL('../src/common/preview-overlay-measure.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('measure.ts', source, ts.ScriptTarget.Latest, true);
    const topLevelNames = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.name.text);
    for (const fn of [measureOverlayBoxInStage, installOverlayBoxRequestListener]) {
        for (const name of topLevelNames.filter(name => name !== fn.name)) {
            assert.doesNotMatch(fn.toString(), new RegExp(`\\b${name}\\b`, 'u'));
        }
    }
});

test('別 script の返答口だけを window 経由で呼ぶ', async () => {
    const text = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
    assert.match(text, /<script>\$\{this\.hostAdapterScript\(\)\}<\/script>/u);
    assert.match(text, /<script>\$\{this\.previewBootstrapScript\(\)\}<\/script>/u);
    const ast = ts.createSourceFile('preview.ts', text, ts.ScriptTarget.Latest, true);
    const owner = ast.statements.find(node => ts.isClassDeclaration(node)
        && node.members.some(member => member.name?.getText(ast) === 'hostAdapterScript'));
    const method = name => owner.members.find(member => member.name?.getText(ast) === name).getText(ast);
    const adapter = method('hostAdapterScript');
    const bootstrap = method('previewBootstrapScript');
    assert.match(adapter, /const vscode = acquireVsCodeApi\(\);/u);
    const bridge = adapter.match(/window\.akari\.reportOverlayBox = detail => \{\s*vscode\.postMessage\(\{ type: 'akari-preview-overlay-box', \.\.\.detail \}\);\s*\};/u)?.[0];
    const listener = bootstrap.match(/installOverlayBoxRequestListenerFn\(window, document, measureOverlayBoxFn,\s*message => [^;]+;/u)?.[0];
    assert.ok(bridge);
    assert.ok(listener);
    assert.doesNotMatch(listener, /\b(?:vscode|stage|output)\b/u);
    const listeners = [];
    const sent = [];
    const win = { akari: { state: { summary: { output: { width: 1280, height: 720 } } } },
        addEventListener: (_type, callback) => listeners.push(callback) };
    const doc = { getElementById: () => ({ offsetWidth: 1280, offsetHeight: 720 }) };
    // Separate Function calls model the two separate <script> elements. vscode is passed only to the first.
    new Function('window', 'acquireVsCodeApi', `const vscode = acquireVsCodeApi(); ${bridge}`)(win,
        () => ({ postMessage: message => sent.push(message) }));
    new Function('window', 'document', 'measure',
        `const installOverlayBoxRequestListenerFn = (${installOverlayBoxRequestListener.toString()});
         const measureOverlayBoxFn = measure; ${listener}`)(win, doc,
        async () => ({ x: 0, y: 0, width: 512, height: 288 }));
    listeners[0]({ data: { type: 'akari-preview-overlay-box-request', requestId: 'bridge', fragment: '<div />' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [{ type: 'akari-preview-overlay-box', requestId: 'bridge',
        box: { x: 0, y: 0, width: 512, height: 288 } }]);
});
