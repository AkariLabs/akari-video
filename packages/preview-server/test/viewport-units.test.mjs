import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

// packages/overlay-runtime/src/viewport-units.js（ブラウザでは window.akari.viewportUnits、
// Node では CommonJS）。プレビュー（app.js / shell の overlay-runtime.js）が mount 時に断片へ
// 適用する「vw/vh 系単位をステージ（出力サイズ）基準へ書き換える」純関数の単体テスト。
// 書き出し（render-cut）は出力サイズちょうどの viewport で描くので無改造 —
// docs/contract-2026-08-02-preview-parity.md §2.3。DOM を要する applyAll の実測は
// packages/overlay-runtime/test-harness（run-tests.js 7)）が担う。
const require = createRequire(import.meta.url);
const { rewriteCssText, applyAll, stageVariables, VARIABLES } = require('../../overlay-runtime/src/viewport-units.js');

const V = (n, axis, unit = axis) => `calc(${n} * var(--akari-${axis}, 1${unit}))`;

test('基本 4 単位を calc(N * var(--akari-<軸>, 1<単位>)) へ書き換える', () => {
  assert.equal(rewriteCssText('font-size: 10vw'), `font-size: ${V(10, 'vw')}`);
  assert.equal(rewriteCssText('height: 25vh'), `height: ${V(25, 'vh')}`);
  assert.equal(rewriteCssText('padding: 2vmin 1vmax'), `padding: ${V(2, 'vmin')} ${V(1, 'vmax')}`);
});

test('数値の形（小数・先頭ピリオド・負数・指数・大文字単位）を保つ', () => {
  assert.equal(rewriteCssText('a: 1.5vw'), `a: ${V('1.5', 'vw')}`);
  assert.equal(rewriteCssText('a: .5vw'), `a: ${V('.5', 'vw')}`);
  assert.equal(rewriteCssText('transform: translate(-10vw, 0)'), `transform: translate(${V('-10', 'vw')}, 0)`);
  assert.equal(rewriteCssText('a: 1e1vh'), `a: ${V('1e1', 'vh')}`);
  assert.equal(rewriteCssText('a: 10VW'), `a: calc(10 * var(--akari-vw, 1VW))`);
});

test('d/s/l 接頭辞は同じ軸へ、vi/vb は vw/vh へ寄せる（フォールバックは元の単位）', () => {
  assert.equal(rewriteCssText('a: 10dvw'), `a: calc(10 * var(--akari-vw, 1dvw))`);
  assert.equal(rewriteCssText('a: 10svh'), `a: calc(10 * var(--akari-vh, 1svh))`);
  assert.equal(rewriteCssText('a: 10lvmin'), `a: calc(10 * var(--akari-vmin, 1lvmin))`);
  assert.equal(rewriteCssText('a: 10dvmax'), `a: calc(10 * var(--akari-vmax, 1dvmax))`);
  assert.equal(rewriteCssText('a: 10vi'), `a: calc(10 * var(--akari-vw, 1vi))`);
  assert.equal(rewriteCssText('a: 10vb'), `a: calc(10 * var(--akari-vh, 1vb))`);
});

test('calc() / clamp() / min() の中でも書き換わる（入れ子の calc は CSS として有効）', () => {
  assert.equal(rewriteCssText('width: calc(100vw - 20px)'), `width: calc(${V(100, 'vw')} - 20px)`);
  assert.equal(
    rewriteCssText('font-size: clamp(1rem, 3vw, 2rem)'),
    `font-size: clamp(1rem, ${V(3, 'vw')}, 2rem)`,
  );
  assert.equal(rewriteCssText('w: min(50vw, 400px)'), `w: min(${V(50, 'vw')}, 400px)`);
});

test('識別子・他の単位・パーセントは触らない', () => {
  for (const untouched of [
    '.hero-10vw { x: 1 }',
    'foo-1vw',
    'a: 10vwx',
    'a: 10px; b: 10%; c: 10em; d: 10',
    '--vw: 3; a: var(--vw)',
    'a: 10 vw',
  ]) {
    assert.equal(rewriteCssText(untouched), untouched, untouched);
  }
});

test('at-rule プレリュードは書き換えず、そのブロックの中身は書き換える', () => {
  const css = '@media (min-width: 50vw) and (max-height: 20vh) { .a { font-size: 4vw } }';
  assert.equal(
    rewriteCssText(css),
    `@media (min-width: 50vw) and (max-height: 20vh) { .a { font-size: ${V(4, 'vw')} } }`,
  );
  const container = '@container card (width > 30vw) { .b { padding: 1vh } }';
  assert.equal(rewriteCssText(container), `@container card (width > 30vw) { .b { padding: ${V(1, 'vh')} } }`);
  const supports = '@supports (font-size: 1vw) { .c { font-size: 1vw } }';
  assert.equal(rewriteCssText(supports), `@supports (font-size: 1vw) { .c { font-size: ${V(1, 'vw')} } }`);
  const keyframes = '@keyframes slide { from { transform: translateX(100vw) } to { transform: none } }';
  assert.equal(
    rewriteCssText(keyframes),
    `@keyframes slide { from { transform: translateX(${V(100, 'vw')}) } to { transform: none } }`,
  );
});

test('文字列・url()・コメントの中は書き換えない', () => {
  const css = [
    '.a::before { content: "10vw"; }',
    ".b::after { content: '2vh'; }",
    '.c { background: url(img-9vw.png); }',
    '.d { background: url("data:image/png;base64,/9vw+3vh"); }',
    '/* 5vmin */ .e { width: 1vmin }',
  ].join('\n');
  assert.equal(
    rewriteCssText(css),
    [
      '.a::before { content: "10vw"; }',
      ".b::after { content: '2vh'; }",
      '.c { background: url(img-9vw.png); }',
      '.d { background: url("data:image/png;base64,/9vw+3vh"); }',
      `/* 5vmin */ .e { width: ${V(1, 'vmin')} }`,
    ].join('\n'),
  );
});

test('冪等: 書き換え済みテキストをもう一度通しても変わらない', () => {
  const once = rewriteCssText('.a { font-size: 10vw; padding: 2vh; margin: clamp(0px, 3vmax, 9px) }');
  assert.equal(rewriteCssText(once), once);
});

test('単位が無い入力は同じ参照を返す（走査コストの前置き判定）', () => {
  const plain = '.a { font-size: 40px; color: var(--color) }';
  assert.equal(rewriteCssText(plain), plain);
  assert.equal(rewriteCssText(''), '');
  assert.equal(rewriteCssText(undefined), undefined);
});

test('stageVariables: 出力サイズ / 100 px（横長・縦長・欠落時の既定 1280x720）', () => {
  assert.deepEqual(stageVariables({ width: 1280, height: 720 }), {
    '--akari-vw': '12.8px',
    '--akari-vh': '7.2px',
    '--akari-vmin': '7.2px',
    '--akari-vmax': '12.8px',
  });
  assert.deepEqual(stageVariables({ width: 1080, height: 1920 }), {
    '--akari-vw': '10.8px',
    '--akari-vh': '19.2px',
    '--akari-vmin': '10.8px',
    '--akari-vmax': '19.2px',
  });
  assert.deepEqual(stageVariables(undefined), stageVariables({ width: 1280, height: 720 }));
  assert.deepEqual(stageVariables({ width: 0, height: -1 }), stageVariables({ width: 1280, height: 720 }));
  assert.deepEqual(Object.keys(stageVariables({})), VARIABLES);
});

test('applyAll: <style> の textContent と style 属性を書き換え、変更した節点数を返す', () => {
  const style = { textContent: '.a { font-size: 10vw }' };
  const plainStyle = { textContent: '.b { font-size: 10px }' };
  const attrs = { style: 'width: 50vw; height: 10px' };
  const styled = {
    getAttribute: (name) => attrs[name],
    setAttribute: (name, value) => { attrs[name] = value; },
  };
  const plainAttrs = { style: 'width: 10px' };
  const plainStyled = {
    getAttribute: (name) => plainAttrs[name],
    setAttribute: () => { throw new Error('触らないはず'); },
  };
  const root = {
    querySelectorAll: (selector) => (selector === 'style' ? [style, plainStyle] : [styled, plainStyled]),
  };
  assert.equal(applyAll(root), 2);
  assert.equal(style.textContent, `.a { font-size: ${V(10, 'vw')} }`);
  assert.equal(plainStyle.textContent, '.b { font-size: 10px }');
  assert.equal(attrs.style, `width: ${V(50, 'vw')}; height: 10px`);
  assert.equal(applyAll(null), 0);
});
