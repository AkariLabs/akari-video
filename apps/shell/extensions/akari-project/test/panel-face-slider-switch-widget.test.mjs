import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('widget.tsx', readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
const member = name => widget.members.find(node => node.name?.getText(source) === name);
const controls = member('renderTopControls');
const elements = [];
function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) elements.push(node);
    ts.forEachChild(node, visit);
}
visit(controls);
const attribute = (node, name) => node.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === name)?.initializer;
const value = (node, name) => attribute(node, name)?.getText(source);
const track = elements.find(node => value(node, 'role') === "'tablist'");
const thumb = elements.filter(node => attribute(node, 'data-akari-panel-segment-thumb'));
const tab = elements.find(node => value(node, 'role') === "'tab'");
function style(node, name) {
    const object = attribute(node, 'style').expression;
    return object.properties.find(prop => prop.name?.getText(source) === name)?.initializer.getText(source);
}

test('つながったトラックに、transform だけで移動するつまみを1個置く', () => {
    assert.equal(style(track, 'position'), "'relative'");
    assert.equal(style(track, 'gap'), '0');
    assert.equal(style(track, 'padding'), "'2px'");
    assert.equal(style(track, 'background'), 'AKARI_SURFACE.raised');
    assert.equal(style(track, 'border'), 'AKARI_BORDER.ghost');
    assert.equal(thumb.length, 1);
    assert.equal(value(thumb[0], 'aria-hidden'), "'true'");
    assert.equal(style(thumb[0], 'position'), "'absolute'");
    assert.equal(style(thumb[0], 'width'), "'calc((100% - 4px) / 2)'");
    assert.equal(style(thumb[0], 'boxSizing'), "'border-box'");
    assert.equal(style(thumb[0], 'background'), 'AKARI_SURFACE.elevated');
    assert.equal(style(thumb[0], 'border'), 'AKARI_BORDER.accent');
    assert.equal(style(thumb[0], 'transform'), "this.topView === 'materials' ? 'translateX(0)' : 'translateX(100%)'");
    assert.equal(style(thumb[0], 'transition'), "'var(--akari-panel-segment-transition, none)'");
});

test('既存属性・クリック・ラベルを保持し、透明ボタンとフォーカスリングを使う', () => {
    assert.equal(value(tab, 'aria-selected'), '{active}');
    assert.equal(value(tab, 'data-akari-panel-segment'), '{item.view}');
    assert.equal(value(tab, 'data-akari-open-catalog'), "{item.view === 'catalog' ? 'true' : undefined}");
    assert.equal(value(tab, 'data-akari-back-to-materials'), "{item.view === 'materials' ? 'true' : undefined}");
    assert.equal(value(tab, 'onClick'), '{() => this.selectTopView(item.view)}');
    assert.equal(value(tab, 'className'), undefined);
    assert.equal(style(tab, 'background'), "'transparent'");
    assert.equal(style(tab, 'border'), "'none'");
    assert.equal(style(tab, 'zIndex'), '1');
    assert.equal(style(tab, 'whiteSpace'), "'nowrap'");
    assert.equal(style(tab, 'fontWeight'), 'active ? 700 : 400');
    assert.equal(style(tab, 'opacity'), 'active ? 1 : 0.66');
    assert.equal(value(tab, 'tabIndex'), '{active ? 0 : -1}');
    assert.match(value(tab, 'onFocus'), /matches\(':focus-visible'\)/);
    assert.match(value(tab, 'onFocus'), /2px solid.*AKARI_LINE.accent/);
    assert.match(controls.getText(source), /label: 'プロジェクト'/);
    assert.match(controls.getText(source), /label: 'ライブラリ'/);
});

test('左右キーは隣の面を選び、対応するボタンへフォーカスを移す', () => {
    const expression = attribute(track, 'onKeyDown').expression.getText(source);
    const code = ts.transpileModule(`const handler = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    for (const key of ['ArrowLeft', 'ArrowRight']) {
        for (const topView of ['materials', 'catalog']) {
            const calls = [];
            const context = { topView, selectTopView: view => calls.push(view) };
            const handler = new Function(`${code}\nreturn handler;`).call(context);
            handler({ key, preventDefault: () => calls.push('prevent'), currentTarget: {
                querySelector: selector => { calls.push(selector); return { focus: () => calls.push('focus') }; }
            } });
            const next = topView === 'materials' ? 'catalog' : 'materials';
            assert.deepEqual(calls, ['prevent', next, `[data-akari-panel-segment="${next}"]`, 'focus']);
        }
    }
    const handler = new Function(`${code}\nreturn handler;`).call({});
    handler({ key: 'Tab', preventDefault: () => assert.fail('Tab は標準動作を保持する') });
});

test('初回・再生成は遷移なし、描画後のみ280ms、reduced-motion は即時反映', () => {
    assert.equal(value(track, 'ref'), '{this.mountPanelSegmentTrack}');
    const frames = new Map(), listeners = new Set();
    let sequence = 0;
    const media = {
        matches: false,
        addEventListener: (type, fn) => { assert.equal(type, 'change'); listeners.add(fn); },
        removeEventListener: (type, fn) => { assert.equal(type, 'change'); listeners.delete(fn); }
    };
    const window = {
        matchMedia: query => { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
        requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
        cancelAnimationFrame: id => frames.delete(id)
    };
    const code = ts.transpileModule(`class Handler { ${['disposePanelSegmentMotion', 'mountPanelSegmentTrack'].map(name => member(name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Handler = new Function('window', `${code}\nreturn Handler;`)(window);
    const handler = new Handler();
    const properties = new Map();
    const node = { style: { setProperty: (name, value) => properties.set(name, value) } };
    const transition = () => properties.get('--akari-panel-segment-transition');
    const step = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(fn => fn());
    };
    handler.mountPanelSegmentTrack(node);
    assert.equal(transition(), 'none');
    step();
    assert.equal(transition(), 'none');
    step();
    assert.equal(transition(), 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)');
    assert.equal(properties.get('--akari-panel-label-transition'), 'color 160ms ease, font-weight 160ms ease, opacity 160ms ease');
    media.matches = true;
    listeners.forEach(fn => fn());
    assert.equal(transition(), 'none');
    assert.equal(properties.get('--akari-panel-label-transition'), 'none');
    handler.mountPanelSegmentTrack(null);
    assert.equal(listeners.size, 0);
    handler.mountPanelSegmentTrack(node);
    step(); step();
    assert.equal(transition(), 'none', 'reduced-motion は初期設定でも尊重する');
    handler.mountPanelSegmentTrack(null);
    media.matches = false;
    handler.mountPanelSegmentTrack(node);
    assert.equal(transition(), 'none', '再生成でも初回フレームは遷移なし');
    step();
    handler.mountPanelSegmentTrack(null);
    assert.equal(frames.size, 0, '描画待ちのまま破棄してもコールバックを残さない');
    assert.equal(listeners.size, 0);
});

test('寸法変化では遷移を止めて2フレーム後に戻し、dispose で observer と待機を解除する', () => {
    const frames = new Map();
    const observers = [];
    let sequence = 0;
    const media = { matches: false, addEventListener() {}, removeEventListener() {} };
    const window = {
        matchMedia: () => media,
        requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        ResizeObserver: class {
            constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
            observe(node) { this.node = node; }
            disconnect() { this.disconnected = true; }
        }
    };
    const code = ts.transpileModule(`class Handler { ${['disposePanelSegmentMotion', 'mountPanelSegmentTrack'].map(name => member(name).getText(source)).join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Handler = new Function('window', `${code}\nreturn Handler;`)(window);
    const handler = new Handler();
    const properties = new Map();
    const node = { style: { setProperty: (name, value) => properties.set(name, value) } };
    const transition = () => properties.get('--akari-panel-segment-transition');
    const motion = 'transform 280ms cubic-bezier(0.32, 0.72, 0, 1)';
    const step = () => {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(fn => fn());
    };
    handler.mountPanelSegmentTrack(node);
    assert.equal(observers.length, 1);
    const observer = observers[0];
    assert.equal(observer.node, node);
    step(); step();
    assert.equal(transition(), motion);
    const resize = width => observer.callback([{ target: node, contentRect: { width, height: width ? 28 : 0 } }]);
    for (const width of [0, 164, 260]) {
        resize(width);
        assert.equal(transition(), 'none', `幅 ${width} への変更は即座に停止`);
        assert.equal(properties.get('--akari-panel-label-transition'), 'none');
        step();
        assert.equal(transition(), 'none', '1フレーム後はまだ停止');
        step();
        assert.equal(transition(), motion, '2フレーム後に復帰');
    }
    resize(280);
    step();
    resize(300);
    assert.equal(frames.size, 1, '連続リサイズは古い復帰待ちを取り消す');
    step();
    assert.equal(transition(), 'none', '最後の寸法変化から2フレーム待つ');
    step();
    assert.equal(transition(), motion);
    media.matches = true;
    resize(320);
    step(); step();
    assert.equal(transition(), 'none', 'reduced-motion なら寸法変更後も遷移しない');
    media.matches = false;
    resize(340);
    step();
    handler.mountPanelSegmentTrack(null);
    assert.equal(observer.disconnected, true);
    assert.equal(frames.size, 0, 'dispose で2フレーム目の待機も取り消す');
    step();
    assert.equal(transition(), 'none', '破棄後に遷移を再開しない');
});
