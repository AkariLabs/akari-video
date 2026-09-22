import assert from 'node:assert/strict';
import test from 'node:test';
import { modePopupPosition } from '../../lib/browser/mode-switch/mode-switch-popup.js';
import { INTAKE_AUTONOMY_DESCRIPTIONS } from '../../lib/common/intake-labels.js';

test('popup follows the actual bottom rail button at its left and bottom', () => {
    const anchor = { left: 950, bottom: 780 };
    assert.deepEqual(modePopupPosition(anchor, { width: 340, height: 300 }, 1000, 800), { left: 602, top: 480 });
});

test('popup stays within a narrow or short viewport', () => {
    const anchor = { left: 10, bottom: 25 };
    assert.deepEqual(modePopupPosition(anchor, { width: 340, height: 300 }, 360, 320), { left: 8, top: 8 });
});

test('checkpoint copy asks for confirmation', () => {
    assert.match(INTAKE_AUTONOMY_DESCRIPTIONS.checkpoint, /確認は書き出しの 1 回/);
    assert.doesNotMatch(INTAKE_AUTONOMY_DESCRIPTIONS.checkpoint, /判子/);
});
