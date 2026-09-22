import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../src/browser/akari-home-tab-anchor.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS }
}).outputText;
const load = (environment = {}) => {
    const exports = {};
    const require = name => {
        assert.equal(name, '@theia/core/lib/common');
        return { Disposable: { create: dispose => ({ dispose }) } };
    };
    new Function('exports', 'require', ...Object.keys(environment), code)(exports, require, ...Object.values(environment));
    return exports;
};
const { shouldShowHomeTabAnchor } = load();
const bounds = { left: 100, right: 400 };

for (const side of ['left', 'right']) {
    const tab = clippedBy => side === 'left'
        ? { left: 100 - clippedBy, right: 180 - clippedBy }
        : { left: 320 + clippedBy, right: 400 + clippedBy };
    for (const [clippedBy, hiddenResult, visibleResult] of [
        [-6, false, false], [0, false, false], [0.5, false, false],
        [0.5001, false, true], [1, false, true], [2, false, true],
        [2.0001, true, true], [36, true, true], [400, true, true]
    ]) {
        test(`${side}: 見切れ ${clippedBy}px の表示判定`, () => {
            assert.equal(shouldShowHomeTabAnchor(false, bounds, tab(clippedBy)), hiddenResult);
            assert.equal(shouldShowHomeTabAnchor(true, bounds, tab(clippedBy)), visibleResult);
        });
    }
    test(`${side}: 旧1px境界の揺れ・繰り返し計測では往復せず、スクロールで復帰する`, () => {
        let visible = false;
        const samples = [0, 0.9, 1.1, 0.99, 1.01, 2, 3, 2, 1.1, 0.9, 1.01, 0.99, 0.5, 1, 2];
        const expected = [false, false, false, false, false, false, true, true, true, true, true, true, false, false, false];
        samples.forEach((value, index) => {
            visible = shouldShowHomeTabAnchor(visible, bounds, tab(value));
            assert.equal(visible, expected[index]);
            for (let frame = 0; frame < 180; frame++) {
                assert.equal(shouldShowHomeTabAnchor(visible, bounds, tab(value)), visible);
            }
        });
    });
}

test('タブ消失・幅ゼロ・非有限値では退避ボタンを隠す', () => {
    for (const [viewport, tab] of [
        [bounds, undefined], [bounds, { left: 0, right: 0 }],
        [{ left: 100, right: 100 }, { left: 0, right: 80 }],
        [bounds, { left: NaN, right: 80 }], [bounds, { left: 0, right: Infinity }],
        [{ left: -Infinity, right: 400 }, { left: 0, right: 80 }]
    ]) {
        for (const visible of [false, true]) assert.equal(shouldShowHomeTabAnchor(visible, viewport, tab), false);
    }
});

test('退避ボタンはフロー外でタブより上に表示し、クリック・再判定・破棄を維持する', () => {
    const frames = new Map(), observers = [], listeners = new Map();
    let nextFrame = 0, button, layoutChanged, activated;
    let tabBounds = { left: 106, right: 180 };
    const row = { style: { position: '' } };
    const scroller = {
        style: { zIndex: 'auto' },
        parentElement: row, getBoundingClientRect: () => bounds,
        before: node => { button = node; },
        addEventListener: (type, callback) => listeners.set(type, callback),
        removeEventListener: type => listeners.delete(type)
    };
    const home = { id: 'home', title: {} };
    const bar = { node: {}, titles: [home.title], currentTitle: home.title,
        contentNode: { parentElement: scroller, children: [{ getBoundingClientRect: () => tabBounds }] } };
    const shell = { mainAreaTabBars: [bar], activateWidget: id => { activated = id; },
        mainPanel: { layoutModified: { connect: callback => { layoutChanged = callback; }, disconnect: () => { layoutChanged = undefined; } } } };
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    }
    const environment = {
        document: { createElement: () => ({ style: {}, attributes: {},
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(type, callback) { this[type] = callback; },
            remove() { this.removed = true; }
        }) },
        ResizeObserver: Observer, MutationObserver: Observer,
        requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
        cancelAnimationFrame: id => frames.delete(id)
    };
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
    const binding = load(environment).installHomeTabAnchor(shell, home);
    flush();
    assert.equal(button.hidden, true);
    assert.equal(button.style.position, 'absolute', '表示しても flex の幅を消費しない');
    assert.equal(button.style.flex, undefined);
    assert.equal(row.style.position, 'relative');
    assert.equal(scroller.style.zIndex, '0', 'タブとPSレールの z-index をスクローラー内に閉じ込める');
    assert.equal(button.style.zIndex, '1', 'スクローラーより上、既存ツールバーの1001より下');
    const show = clippedBy => {
        tabBounds = { left: 100 - clippedBy, right: 180 - clippedBy };
        listeners.get('scroll')();
        observers.forEach(observer => observer.callback());
        assert.equal(frames.size, 1, '更新は1フレームにまとめる');
        flush();
    };
    show(40);
    assert.equal(button.hidden, false);
    assert.equal(button.style.display, 'inline-flex');
    assert.equal(scroller.style.zIndex, '0', '表示切替でも重なり順を維持する');
    assert.equal(button.attributes['aria-pressed'], 'true');
    button.click();
    assert.equal(activated, 'home');
    for (const amount of [1.1, 0.9, 1.01, 0.99]) {
        show(amount);
        assert.equal(button.hidden, false, '前回の表示状態が判定に渡る');
    }
    show(0);
    assert.equal(button.hidden, true);
    assert.equal(button.style.display, 'none');
    assert.equal(scroller.style.zIndex, '0', '非表示でもスクローラーの配置を変えない');
    listeners.get('scroll')();
    shell.mainAreaTabBars = [];
    layoutChanged();
    assert.equal(button.removed, true);
    assert.equal(row.style.position, '');
    assert.equal(scroller.style.zIndex, 'auto', '破棄時は元のインライン指定を復元する');
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
    assert.ok(observers.every(observer => observer.disconnected));
    binding.dispose();
    assert.equal(layoutChanged, undefined);
});
