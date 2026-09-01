// Exercises the pure right-panel-order helper (apps/shell/extensions/akari-annotations/src/browser/
// right-panel-order.ts) against its compiled output, independent of the Theia/lumino runtime.
// Run: `npm run build` (or `tsc -b`) in this extension first, then `node --test test/*.test.mjs`
// from apps/shell/extensions/akari-annotations/ — see package.json's "test" script for the combined
// command. createRequire is used (not a static ESM import) so this doesn't depend on Node's
// cjs-module-lexer correctly inferring named exports from the tsc-emitted CommonJS output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeRightPanelOrder } = require('../lib/browser/right-panel-order.js');

const FIXED_ORDER = ['partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector'];

test('computeRightPanelOrder: already-correct order is a no-op', () => {
    const current = ['agent-1', 'agent-2', 'partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector'];
    assert.deepEqual(computeRightPanelOrder(current, FIXED_ORDER), current);
});

test('computeRightPanelOrder: repro of the reported bug — fixed 3 pinned ahead of an existing agent tab', () => {
    // reconcileRightPanelOrder() 旧実装（tabBar.insertTab(0..2, …) で固定 3 枚を絶対位置へ強奪）
    // が発生させていた壊れた並び。エージェント端末タブが固定 3 枚の下へ押し出されている。
    const broken = ['partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector', 'agent-1'];
    assert.deepEqual(
        computeRightPanelOrder(broken, FIXED_ORDER),
        ['agent-1', 'partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector']
    );
});

test('computeRightPanelOrder: multiple agent tabs keep their existing relative order', () => {
    const current = ['partner-onboarding', 'agent-2', 'review-panel', 'agent-1', 'akari-daihon-widget', 'inspector'];
    assert.deepEqual(
        computeRightPanelOrder(current, FIXED_ORDER),
        ['agent-2', 'agent-1', 'partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector']
    );
});

test('computeRightPanelOrder: newly-added agent tab lands ahead of the fixed 3 (acceptance (b))', () => {
    // rank 挿入で既に先頭寄りに入った状態からの再調整（reconcile は冪等であるべき）。
    const current = ['agent-1', 'agent-2', 'partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector'];
    assert.deepEqual(
        computeRightPanelOrder(current, FIXED_ORDER),
        ['agent-1', 'agent-2', 'partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector']
    );
});

test('computeRightPanelOrder: missing fixed tabs (not yet lazily attached) are simply absent', () => {
    const current = ['agent-1', 'partner-onboarding'];
    assert.deepEqual(computeRightPanelOrder(current, FIXED_ORDER), ['agent-1', 'partner-onboarding']);
});

test('computeRightPanelOrder: no agent tabs — fixed 3 keep fixedOrder\'s relative order', () => {
    const current = ['inspector', 'akari-daihon-widget', 'partner-onboarding', 'review-panel'];
    assert.deepEqual(
        computeRightPanelOrder(current, FIXED_ORDER),
        ['partner-onboarding', 'review-panel', 'akari-daihon-widget', 'inspector']
    );
});

test('computeRightPanelOrder: empty input', () => {
    assert.deepEqual(computeRightPanelOrder([], FIXED_ORDER), []);
});
