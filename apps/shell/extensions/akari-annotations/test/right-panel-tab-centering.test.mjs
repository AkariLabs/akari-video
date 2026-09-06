import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";

const require = createRequire(import.meta.url);
const {
  computeReviewTabMarginTop,
  FALLBACK_TAB_HEIGHT_PX,
  MIN_GAP_ABOVE_PX,
  RESERVED_BELOW_PX,
} = require("../lib/common/right-panel-tab-centering.js");

test("computeReviewTabMarginTop は既定サイズのウィンドウでタブをバー高の中央付近へ置く（実測 barHeight=646）", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 646, heightAbove: 48, tabHeight: 48 });
  const center = 48 + margin + 24;
  assert.ok(Math.abs(center / 646 - 0.5) < 0.02, `center ratio should be near 50%, got ${center / 646}`);
});

test("computeReviewTabMarginTop は最大化相当の大きいウィンドウでも中央付近を保つ（実測 barHeight=978）", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 978, heightAbove: 48, tabHeight: 48 });
  const center = 48 + margin + 24;
  assert.ok(Math.abs(center / 978 - 0.5) < 0.02, `center ratio should be near 50%, got ${center / 978}`);
});

test("computeReviewTabMarginTop は後続タブ（インスペクター）1 枚分を必ず下に残す", () => {
  const barHeight = 646;
  const heightAbove = 48;
  const tabHeight = 48;
  const margin = computeReviewTabMarginTop({ barHeight, heightAbove, tabHeight });
  const reviewBottom = heightAbove + margin + tabHeight;
  const nextTabBottom = reviewBottom + FALLBACK_TAB_HEIGHT_PX;
  assert.ok(nextTabBottom <= barHeight, `inspector tab must fit without overflow: ${nextTabBottom} <= ${barHeight}`);
});

test("computeReviewTabMarginTop は極小ウィンドウでも既存アイコン群からの最低ギャップを維持する", () => {
  const margin = computeReviewTabMarginTop({ barHeight: 150, heightAbove: 48, tabHeight: 48 });
  assert.equal(margin, MIN_GAP_ABOVE_PX);
});

test("computeReviewTabMarginTop はレイアウト前（barHeight<=0）に 0 を返す", () => {
  assert.equal(computeReviewTabMarginTop({ barHeight: 0, heightAbove: 48, tabHeight: 48 }), 0);
  assert.equal(computeReviewTabMarginTop({ barHeight: -10, heightAbove: 48, tabHeight: 48 }), 0);
});

test("computeReviewTabMarginTop: 大画面から極小画面へ縮めた直後でも新しい margin だけで後続タブが収まる (regression: L1 実測で lm-mod-invisible の張り付きを検出)", () => {
  // 実機 L1 検証で発見した回帰: barHeight=1178（最大化相当）から barHeight=358（極小）へ
  // 一気に縮めると、Lumino 側の SideTabBar.onResize() が margin 再計算前の古い値で
  // hideOverflowingTabs() を走らせ、インスペクタータブに lm-mod-invisible が張り付いたまま
  // 残ることを確認した（right-panel-tab-style.ts の tabBar.update() 強制再判定で解消）。
  // ここでは新しい barHeight に対する margin 自体が独立に正しく収まることを保証する。
  const tinyMargin = computeReviewTabMarginTop({ barHeight: 358, heightAbove: 48, tabHeight: 48 });
  const reviewBottom = 48 + tinyMargin + 48;
  const inspectorBottom = reviewBottom + RESERVED_BELOW_PX; // インスペクターは 48px, gap 無し
  assert.ok(inspectorBottom <= 358, `inspector must fit at tiny barHeight: ${inspectorBottom} <= 358`);
});

test('three following tabs retain their full 144px plus the overflow gap', () => {
  const input = { barHeight: 300, heightAbove: 48, tabHeight: 48 };
  const margin = computeReviewTabMarginTop({ ...input, reservedBelow: 144 });
  assert.equal(margin, 52);
  assert.ok(margin < computeReviewTabMarginTop(input));
  assert.equal(input.heightAbove + margin + input.tabHeight + 144, input.barHeight - 8);
});

test('omitted reservedBelow preserves the previous one-tab-plus-8px clamp', () => {
  // This size reaches the upper clamp, so adding the gap twice would change the result.
  const input = { barHeight: 150, heightAbove: 0, tabHeight: 48 };
  assert.equal(computeReviewTabMarginTop(input), 46);
  assert.equal(computeReviewTabMarginTop(input), computeReviewTabMarginTop({ ...input, reservedBelow: RESERVED_BELOW_PX }));
});

const styleSource = ts.createSourceFile('right-panel-tab-style.ts', readFileSync(
  new URL('../src/browser/right-panel-tab-style.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true);
const applyFunction = styleSource.statements.find(node => ts.isFunctionDeclaration(node)
  && node.name?.text === 'applyReviewTabMarginTop');
assert.ok(applyFunction);
const applyCode = ts.transpileModule(applyFunction.getText(styleSource), {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;

test('DOM centering measures every following tab and falls back only when none follow', () => {
  for (const heights of [[48, 48, 48], [32, 60, 52], [0, 48], []]) {
    class Element {
      constructor(height) { this.height = height; }
      getBoundingClientRect() { return { height: this.height }; }
    }
    const tab = new Element(48);
    tab.closest = () => new Element(300);
    tab.previousElementSibling = new Element(48);
    let previous = tab;
    for (const height of heights) {
      previous.nextElementSibling = new Element(height);
      previous = previous.nextElementSibling;
    }
    const properties = new Map();
    const document = {
      getElementById: () => tab,
      documentElement: { style: {
        getPropertyValue: name => properties.get(name),
        setProperty: (name, value) => properties.set(name, value),
      } },
    };
    const calls = [];
    const apply = new Function('document', 'HTMLElement', 'computeReviewTabMarginTop', 'FALLBACK_TAB_HEIGHT_PX', `
      const REVIEW_TAB_DOM_ID = 'review';
      const MARGIN_TOP_VAR = 'margin';
      ${applyCode}
      return applyReviewTabMarginTop;
    `)(document, Element, input => { calls.push(input); return computeReviewTabMarginTop(input); }, FALLBACK_TAB_HEIGHT_PX);
    assert.equal(apply(), true);
    assert.deepEqual(calls[0], {
      barHeight: 300, heightAbove: 48, tabHeight: 48,
      reservedBelow: heights.length ? heights.reduce((sum, height) => sum + height, 0) : FALLBACK_TAB_HEIGHT_PX,
    });
    assert.equal(properties.get('margin'), `${computeReviewTabMarginTop(calls[0])}px`);
    assert.equal(apply(), false);
  }
});
