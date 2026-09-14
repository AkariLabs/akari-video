import assert from 'node:assert/strict';
import test from 'node:test';
import { KIT_ENABLE_HINT } from '../../lib/common/kit-enable-hint.js';
import { enableHint } from '../../../../../../packages/akari-launcher/src/kits.mjs';

test('KIT_ENABLE_HINT は launcher の enableHint() と一致する', () => {
    assert.equal(KIT_ENABLE_HINT, enableHint());
});
