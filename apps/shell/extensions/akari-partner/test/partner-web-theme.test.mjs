import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePartnerWebTheme } from '../lib/common/partner-web-theme.js';

for (const [preference, currentThemeType, expected] of [
    ['system', 'light', 'system'],
    ['system', undefined, 'system'],
    ['light', 'light', 'light'],
    ['light', 'dark', 'dark'],
    ['dark', 'light', 'light'],
    ['dark', 'dark', 'dark'],
    ['dark', 'hc', 'dark'],
    ['dark', 'hcLight', 'light'],
    ['invalid', 'light', 'light'],
    ['invalid', undefined, 'dark']
]) {
    test(`web theme resolves ${String(preference)} with active ${String(currentThemeType)}`, () => {
        assert.equal(resolvePartnerWebTheme(preference, currentThemeType), expected);
    });
}
