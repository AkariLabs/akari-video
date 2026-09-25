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

test('getAnimations の無い環境でも選択枠を戻す', async () => {
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

async function measurePaintedFixture(specs, fallback = { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 }) {
    const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
    const stage = { appendChild() {}, getBoundingClientRect: () => rect(0, 0, 1280, 720) };
    const probe = { style: { setProperty() {} }, parentElement: stage, setAttribute() {}, appendChild() {}, remove() {},
        getBoundingClientRect: () => rect(480, 270, 320, 180), getAnimations: () => [],
        querySelectorAll(selector) { return selector === '*' ? elements : []; } };
    const elements = specs.map(spec => ({ tagName: spec.tag ?? 'DIV', childNodes: spec.text ? [{ nodeType: 3,
        textContent: spec.text, rect: spec.textRect }] : [],
    getBoundingClientRect: () => spec.rect, parentElement: null }));
    elements.forEach((element, index) => { element.parentElement = specs[index].parent === undefined
        ? probe : elements[specs[index].parent]; });
    const styleOf = element => {
        const index = elements.indexOf(element);
        return { display: 'block', visibility: 'visible', opacity: element === probe ? '0.001' : '1',
            overflow: 'visible', overflowX: 'visible', overflowY: 'visible', contain: 'none',
            backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
            ...(index >= 0 ? specs[index].style : {}) };
    };
    const document = { fonts: { ready: Promise.resolve() },
        createElement: name => name === 'template' ? { content: { cloneNode: () => ({}) },
            set innerHTML(_value) {} } : probe,
        createRange: () => ({ selectNodeContents(node) { this.node = node; },
            getBoundingClientRect() { return this.node.rect; } }) };
    const window = { setTimeout, clearTimeout, akari: { viewportUnits: { applyAll() {} },
        interaction: { fragmentBounds: () => fallback } } };
    const measure = runInNewContext(`(${measureOverlayBoxInStage.toString()})`,
        { window, document, getComputedStyle: styleOf });
    return { ...await measure(stage, '<div>見本</div>', {}, { width: 1280, height: 720 }) };
}

test('はみ出した装飾は親の overflow hidden で切って測る', async () => {
    const frame = { left: 480, top: 270, right: 860, bottom: 485, width: 380, height: 215 };
    const wipe = { left: 462, top: 260, right: 878, bottom: 495, width: 416, height: 235 };
    assert.deepEqual(await measurePaintedFixture([
        { rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 } },
        { rect: frame, parent: 0, style: { backgroundColor: 'rgb(17, 24, 39)', overflowX: 'hidden', overflowY: 'hidden' } },
        { rect: wipe, parent: 1, style: { backgroundImage: 'linear-gradient(red, blue)' } }
    ]), { x: 0, y: 0, width: 1520, height: 860 });
});

test('overflow は横軸だけ指定された場合に縦を切らない', async () => {
    assert.deepEqual(await measurePaintedFixture([
        { rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 } },
        { rect: { left: 500, top: 300, right: 700, bottom: 400, width: 200, height: 100 }, parent: 0,
            style: { overflowX: 'hidden', overflowY: 'visible' } },
        { rect: { left: 480, top: 280, right: 720, bottom: 420, width: 240, height: 140 }, parent: 1,
            style: { backgroundColor: 'rgb(30, 40, 50)' } }
    ]), { x: 80, y: 40, width: 800, height: 560 });
});

test('透明な全面ラッパーを数えず板の枠を測る', async () => {
    assert.deepEqual(await measurePaintedFixture([
        { rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 } },
        { rect: { left: 500, top: 300, right: 700, bottom: 400, width: 200, height: 100 },
            parent: 0, style: { backgroundColor: 'rgb(20, 30, 40)' } }
    ]), { x: 80, y: 120, width: 800, height: 400 });
});

test('文字だけの断片は Range の文字矩形を測る', async () => {
    assert.deepEqual(await measurePaintedFixture([
        { rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 } },
        { tag: 'SPAN', rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 },
            parent: 0, text: '見出し', textRect: { left: 510, top: 310, right: 600, bottom: 340, width: 90, height: 30 } }
    ]), { x: 120, y: 160, width: 360, height: 120 });
});

test('描く要素が無い断片は fragmentBounds に戻す', async () => {
    assert.deepEqual(await measurePaintedFixture([
        { rect: { left: 480, top: 270, right: 800, bottom: 450, width: 320, height: 180 } }
    ]), { x: 0, y: 0, width: 1280, height: 720 });
});

test('見える枠を測る前に有限・無限アニメーションを終端へ進める', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const finite = { currentTime: 0, paused: false, pause() { this.paused = true; },
        effect: { getComputedTiming: () => ({ endTime: 820 }) } };
    const infinite = { currentTime: 0, paused: false, pause() { this.paused = true; },
        effect: { getComputedTiming: () => ({ endTime: Infinity, delay: 120, duration: 480 }) } };
    const probe = { style: { setProperty() {} }, setAttribute() {}, appendChild() {},
        querySelectorAll: () => [], getBoundingClientRect() {}, getAnimations: () => [finite, infinite], remove() {} };
    globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: name => name === 'template'
        ? { content: { cloneNode: () => ({}) }, set innerHTML(_value) {} } : probe };
    globalThis.window = { setTimeout, clearTimeout, akari: { viewportUnits: { applyAll() {} },
        interaction: { fragmentBounds: () => {
            assert.equal(finite.paused, true);
            assert.equal(finite.currentTime, 820);
            assert.equal(infinite.paused, true);
            assert.equal(infinite.currentTime, 600);
            return { left: 348, top: 188.75, width: 82.5, height: 44.5 };
        } } } };
    const stage = { appendChild() {}, getBoundingClientRect: () => ({ left: 100, top: 50, width: 640, height: 360 }) };
    try {
        assert.deepEqual(await measureOverlayBoxInStage(stage, '<div>黒板</div>', {}, { width: 1280, height: 720 }),
            { x: 64, y: 30, width: 660, height: 356 });
    } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test('probe.getAnimations が無いときは文書内の probe のアニメーションだけ進める', async () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const oldNode = globalThis.Node;
    globalThis.Node = class {};
    const target = new globalThis.Node();
    const animation = { currentTime: 0, pause() {}, effect: {
        target, getComputedTiming: () => ({ endTime: 300 }) } };
    const probe = { style: { setProperty() {} }, setAttribute() {}, appendChild() {},
        querySelectorAll: () => [], contains: value => value === target, remove() {} };
    globalThis.document = { fonts: { ready: Promise.resolve() }, getAnimations: () => [animation],
        createElement: name => name === 'template'
            ? { content: { cloneNode: () => ({}) }, set innerHTML(_value) {} } : probe };
    globalThis.window = { setTimeout, clearTimeout, akari: { viewportUnits: { applyAll() {} },
        interaction: { fragmentBounds: () => {
            assert.equal(animation.currentTime, 300);
            return { left: 348, top: 188.75, width: 82.5, height: 44.5 };
        } } } };
    const stage = { appendChild() {}, getBoundingClientRect: () => ({ left: 100, top: 50, width: 640, height: 360 }) };
    try {
        assert.ok(await measureOverlayBoxInStage(stage, '<div>黒板</div>', {}, { width: 1280, height: 720 }));
    } finally { globalThis.window = oldWindow; globalThis.document = oldDocument; globalThis.Node = oldNode; }
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
