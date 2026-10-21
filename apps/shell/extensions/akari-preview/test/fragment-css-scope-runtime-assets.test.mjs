// シェル（アプリ）のプレビューが断片を載せる経路の検証。
// getOverlayRuntimeAssets().runtimeJavaScript は overlay-runtime.js の mount を含み、
// mount は preview-server / render-cut / gpu-export と同じ
// fragment-css-scope.mjs の純関数を window.akari.fragmentCssScope 経由で呼ぶ。
// ここでは実際に配られる runtimeJavaScript を最小フェイク DOM で評価し、
// 衝突 2 断片で後の方だけが書き換わり、衝突なしは 1 バイトも変わらないことを見る。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

const fixture = (name) => readFileSync(
    new URL(`../../../../../packages/edit-lint/test/fixtures/fragment-css-collision/overlays/${name}`, import.meta.url),
    'utf8'
);

function fakeStyle() {
    const properties = new Map();
    return {
        setProperty(name, value) { properties.set(name, String(value)); },
        getPropertyValue(name) { return properties.get(name) ?? ''; },
        removeProperty(name) { properties.delete(name); },
        properties
    };
}

// overlay-runtime.js の mount が触る面だけを持つ最小要素。HTML の解釈はせず、
// template.innerHTML の文字列を container.html として保持する（スコープ結果の比較用）。
function fakeElement(tagName, host) {
    const attributes = new Map();
    const element = {
        tagName: tagName.toUpperCase(),
        nodeType: 1,
        id: '',
        dataset: {},
        style: fakeStyle(),
        children: [],
        html: '',
        innerHTML: '',
        setAttribute(name, value) {
            attributes.set(name, String(value));
            if (name === 'id') element.id = String(value);
        },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
        hasAttribute(name) { return attributes.has(name); },
        removeAttribute(name) { attributes.delete(name); },
        toggleAttribute(name, force) {
            const next = force === undefined ? !attributes.has(name) : Boolean(force);
            if (next) attributes.set(name, '');
            else attributes.delete(name);
            return next;
        },
        appendChild(node) { element.children.push(node); return node; },
        insertBefore(node, before) {
            element.children = element.children.filter(child => child !== node);
            const index = before ? element.children.indexOf(before) : -1;
            element.children.splice(index < 0 ? element.children.length : index, 0, node);
            return node;
        },
        replaceChildren(...nodes) {
            element.children = nodes.flatMap(node => (node.nodeType === 11 ? node.children : [node]));
            for (const node of nodes) {
                if (typeof node.html === 'string') element.html = node.html;
            }
        },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getAnimations() { return []; }
    };
    if (tagName === 'template') {
        element.content = {
            nodeType: 11,
            children: [],
            cloneNode() { return { nodeType: 11, children: [], html: element.innerHTML }; }
        };
    }
    return element;
}

function runAppRuntime(runtimeJavaScript) {
    const host = {};
    const stage = fakeElement('div', host);
    const head = fakeElement('head', host);
    const document = {
        head,
        baseURI: 'http://localhost/',
        getElementById: (id) => (id === 'overlay-stage' ? stage : null),
        createElement: (tag) => fakeElement(tag, host),
        createDocumentFragment: () => ({
            nodeType: 11,
            children: [],
            appendChild(node) { this.children.push(node); return node; }
        })
    };
    const window = { akari: {} };
    vm.runInNewContext(runtimeJavaScript, {
        window,
        document,
        performance: { now: () => 0 },
        requestAnimationFrame: () => 0,
        console
    }, { filename: 'runtimeJavaScript.js' });
    host.stage = stage;
    host.window = window;
    return host;
}

test('runtimeJavaScript は fragment-css-scope を export 無しで overlay runtime より前に同梱する', async () => {
    const service = new AkariPreviewServiceImpl();
    const assets = await service.getOverlayRuntimeAssets();
    assert.match(assets.runtimeJavaScript, /function scopeFragmentCss\(fragments\)/u);
    assert.match(assets.runtimeJavaScript, /window\.akari\.fragmentCssScope = Object\.freeze/u);
    assert.doesNotMatch(assets.runtimeJavaScript, /^export /mu, 'runtimeJavaScript に ES module の export が残っている');
    assert.ok(
        assets.runtimeJavaScript.indexOf('function scopeFragmentCss(')
            < assets.runtimeJavaScript.indexOf('function createOverlayRuntime('),
        '断片 CSS スコープは overlay-runtime.js より前に必要です'
    );
    assert.ok(
        assets.runtimeJavaScript.indexOf('window.akari.fragmentCssScope = Object.freeze')
            < assets.runtimeJavaScript.indexOf('function createOverlayRuntime('),
        'browser global の登録は runtime の生成より前に必要です'
    );
    assert.match(assets.runtimeJavaScript,
        /const scope = window\.akari\.fragmentCssScope\?\.scopeFragmentCss;/u);
});

test('アプリの runtime mount は衝突 2 断片の後だけを書き換え、衝突なしは無変更にする', async () => {
    const service = new AkariPreviewServiceImpl();
    const assets = await service.getOverlayRuntimeAssets();
    const host = runAppRuntime(assets.runtimeJavaScript);
    const a = fixture('a.html');
    const b = fixture('b.html');
    const plain = fixture('plain.html');

    await host.window.akari.runtime.mount({ overlays: [
        { id: 'a', start: 0, duration: 1, html: a },
        { id: 'b', start: 0, duration: 1, html: b }
    ] });
    const [first, second] = host.stage.children;
    assert.equal(first.html, a, '先の断片は 1 バイトも変わらない');
    assert.match(second.html, /class="card lbl-hashimoto__f2"/u);
    assert.match(second.html, /\.lbl-hashimoto__f2 \{ left: 60%/u);
    assert.match(second.html, /@keyframes drift__f2/u);
    assert.doesNotMatch(second.html, /animation: drift 2s/u);

    // 衝突の無い 2 断片はどちらも入力とバイト同一。
    await host.window.akari.runtime.mount({ overlays: [
        { id: 'a', start: 0, duration: 1, html: a },
        { id: 'plain', start: 0, duration: 1, html: plain }
    ] });
    assert.deepEqual(host.stage.children.map((element) => element.html), [a, plain]);

    // 1 断片だけでも無変更。
    await host.window.akari.runtime.mount({ overlays: [{ id: 'plain', start: 0, duration: 1, html: plain }] });
    assert.equal(host.stage.children[0].html, plain);
});
