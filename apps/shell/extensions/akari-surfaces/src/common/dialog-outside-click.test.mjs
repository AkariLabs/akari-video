import assert from 'node:assert/strict';
import test from 'node:test';
import { dialogOutsideClick } from '../../lib/common/dialog-outside-click.js';
import { AKARI_SETTINGS_DIALOG_CSS } from '../../lib/browser/style/akari-settings-dialog-style.js';

const overlay = {};
const block = {};

for (const [name, down, click, button, expected] of [
    ['外側の主ボタンクリックで閉じる', overlay, overlay, 0, true],
    ['本体から外側へのドラッグ終端では閉じない', block, overlay, 0, false],
    ['外側から本体へのクリックでは閉じない', overlay, block, 0, false],
    ['本体内のクリックでは閉じない', block, block, 0, false],
    ['右ボタンでは武装しない', overlay, overlay, 2, false],
    ['中ボタンでは武装しない', overlay, overlay, 1, false]
]) {
    test(name, () => {
        const pressed = dialogOutsideClick(false, 'mousedown', down, overlay, button);
        assert.deepEqual(pressed, { armed: down === overlay && button === 0, close: false });
        const clicked = dialogOutsideClick(pressed.armed, 'click', click, overlay, 0);
        assert.deepEqual(clicked, { armed: false, close: expected });
        assert.deepEqual(dialogOutsideClick(clicked.armed, 'click', overlay, overlay, 0), { armed: false, close: false });
    });
}

test('mousedown のない単独 click では閉じない', () => {
    assert.deepEqual(dialogOutsideClick(false, 'click', overlay, overlay, 0), { armed: false, close: false });
});

test('後続の mousedown で武装を更新し、主ボタン以外の click でも解除する', () => {
    assert.deepEqual(dialogOutsideClick(true, 'mousedown', block, overlay, 0), { armed: false, close: false });
    assert.deepEqual(dialogOutsideClick(true, 'mousedown', overlay, overlay, 2), { armed: false, close: false });
    assert.deepEqual(dialogOutsideClick(true, 'click', overlay, overlay, 2), { armed: false, close: false });
});

test('ブラーと薄暗背景は設定オーバーレイだけに適用し、ページ切替も同じ範囲に閉じる', () => {
    const css = AKARI_SETTINGS_DIALOG_CSS;
    assert.match(css, /backdrop-filter:\s*blur\(6px\)/);
    assert.match(css, /-webkit-backdrop-filter:\s*blur\(6px\)/);
    assert.match(css, /background:\s*rgba\(0, 0, 0, \.45\)/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition: none;/);
    const transitions = [...css.matchAll(/transition:\s*([^;]+);/g)].map(match => match[1]);
    assert.deepEqual(transitions, ['opacity 120ms ease', 'none']);
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim()).filter(selector => !selector.startsWith('@media'));
    assert.deepEqual(selectors, [
        '[data-akari-settings-dialog] [data-akari-settings-section][hidden]',
        '.lm-Widget.dialogOverlay[data-akari-settings-dialog]',
        '.lm-Widget.dialogOverlay[data-akari-settings-dialog]'
    ]);
    for (const selector of selectors) {
        assert.ok(selector.includes('[data-akari-settings-dialog]'), selector);
    }
});
