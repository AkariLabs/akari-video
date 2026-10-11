import assert from 'node:assert/strict';
import test, { after as afterI18nTest } from 'node:test';
import { enableHint } from '../../../../../../packages/akari-launcher/src/kits.mjs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));
const { KIT_ENABLE_HINT } = await import("../../lib/common/kit-enable-hint.js");


test('KIT_ENABLE_HINT は launcher の enableHint() と一致する', () => {
    assert.equal(KIT_ENABLE_HINT, enableHint());
});
