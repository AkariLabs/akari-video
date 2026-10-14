import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/browser/home/visible-card-grid.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('visible-card-grid.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const rangeNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'visibleCardRange');
const heightsNode = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CardSlotHeights');
const gridNode = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'VisibleCardGrid');
const compile = node => ts.transpileModule(node.getText(ast).replace(/^export /u, ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const visibleCardRange = new Function(`${compile(rangeNode)}\nreturn visibleCardRange;`)();
const CardSlotHeights = new Function(`${compile(heightsNode)}\nreturn CardSlotHeights;`)();

test('格子の列数と行の余裕から描画する範囲を決める', () => {
    assert.deepEqual(visibleCardRange(605, 5, 0, 1), [0, 20]);
    assert.deepEqual(visibleCardRange(605, 5, 40, 42), [190, 225]);
    assert.deepEqual(visibleCardRange(605, 5, 120, 120), [590, 605]);
});

test('描いたカードの高さを覚え、未計測の枠には同じ幅の実測値を使う', () => {
    const heights = new CardSlotHeights();
    assert.equal(heights.heightFor('one', 69), 69);
    assert.equal(heights.setWidth(211.5), true);
    heights.record('one', 69);
    heights.record('two', 69);
    heights.record('three', 70.75);
    assert.equal(heights.heightFor('one', 66), 69);
    assert.equal(heights.heightFor('three', 66), Math.round(70.75 * 64) / 64);
    assert.equal(heights.heightFor('unseen', 66), 69);
    heights.record('one', 71);
    assert.equal(heights.heightFor('one', 66), 71);
});

test('幅が変わると古い高さを捨て、新しい幅で測った高さへ更新する', () => {
    const heights = new CardSlotHeights();
    heights.setWidth(122);
    heights.record('wrapped', 70.7);
    assert.equal(heights.heightFor('wrapped', 71), Math.round(70.7 * 64) / 64);
    assert.equal(heights.setWidth(122), false);
    assert.equal(heights.setWidth(180), true);
    assert.equal(heights.heightFor('wrapped', 48), 48);
    heights.record('wide', 49);
    assert.equal(heights.heightFor('wrapped', 48), 49);
});

test('高さが混ざる格子は最頻値を見積もりにし、各カードの実測を保つ', () => {
    const heights = new CardSlotHeights();
    heights.setWidth(180);
    heights.record('plain', 168);
    heights.record('badged-one', 183.3);
    assert.equal(heights.heightFor('unseen', 180), 168);
    heights.record('badged-two', 183.3);
    assert.equal(heights.heightFor('unseen', 180), Math.round(183.3 * 64) / 64);
    assert.equal(heights.heightFor('plain', 180), 168);
});

test('札が出そろう前の高さを覚えず、枠には確定後の見積もりを使う', () => {
    const heights = new CardSlotHeights();
    heights.setWidth(208);
    heights.record('early', 46, false);
    assert.equal(heights.heightFor('early', 69), 69);
    heights.record('ready', 69, true);
    heights.record('early', 50, false);
    assert.equal(heights.heightFor('early', 69), 69);
    heights.record('early', 69, true);
    assert.equal(heights.heightFor('early', 46), 69);
});

test('背の低い確定済みカードは自分の高さを保つ', () => {
    const heights = new CardSlotHeights();
    heights.setWidth(122);
    heights.record('short', 48, true);
    heights.record('tall-one', 70.7, true);
    heights.record('tall-two', 70.7, true);
    assert.equal(heights.heightFor('short', 71), 48);
    assert.equal(heights.heightFor('unseen', 71), Math.round(70.7 * 64) / 64);
});

test('枠の CSS は描いたカードの自然な高さを押し付けない', () => {
    const list = readFileSync(new URL('../src/browser/home/project-list-view.tsx', import.meta.url), 'utf8');
    const home = readFileSync(new URL('../src/browser/home/project-home-style.ts', import.meta.url), 'utf8');
    const channel = readFileSync(new URL('../src/browser/channel/akari-channel-widget.tsx', import.meta.url), 'utf8');
    assert.match(source, /visibleCardGridCss = '[^']*grid-template-columns:minmax\(0,1fr\)/u);
    assert.match(list, /\$\{visibleCardGridCss\}/u);
    assert.match(channel, /\$\{visibleCardGridCss\}/u);
    const resizeBlock = source.slice(source.indexOf('new ResizeObserver'), source.indexOf('if (changed) setHeightVersion'));
    assert.equal((resizeBlock.match(/setWidth\(/gu) ?? []).length, 1);
    assert.doesNotMatch([list, home, channel].join('\n'), /\.akari-card-slot[^\n]*height:(?:66|48|100%)/u);
});

test('画面外の枠はカードを作らず、近づいた枠だけ作る', () => {
    const states = [new Set(), undefined, 0];
    let cursor = 0;
    const React = {
        createElement: (tag, props, ...children) => ({ tag, props, children }),
        useState: () => {
            const index = cursor++;
            return [states[index], value => { states[index] = value; }];
        },
        useRef: value => ({ current: value }),
        useEffect: () => {},
        useLayoutEffect: () => {}
    };
    const VisibleCardGrid = new Function('React', 'visibleCardRange', 'CardSlotHeights', `${compile(gridNode)}\nreturn VisibleCardGrid;`)(React, visibleCardRange, CardSlotHeights);
    const rows = Array.from({ length: 605 }, (_, index) => ({ key: String(index) }));
    const calls = [];
    const props = { rows, rowKey: row => row.key, rowLabel: row => row.key,
        className: 'grid', initialHeight: 69, renderCard: row => { calls.push(row.key); return row.key; } };
    const render = () => { cursor = 0; return VisibleCardGrid(props); };
    const first = render();
    assert.deepEqual(calls, []);
    assert.equal(first.children[0][10].props.tabIndex, 0);
    states[0] = new Set(['10', '11']);
    render();
    assert.deepEqual(calls, ['10', '11']);
    states[0] = new Set();
    const slot = render().children[0][10];
    slot.props.onFocus({ target: slot, currentTarget: slot });
    render();
    assert.deepEqual(calls, ['10', '11', '10']);
});
