import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePartnerWebTheme } from '../lib/common/partner-web-theme.js';

for (const [currentThemeType, expected] of [
    ['light', 'light'],
    ['dark', 'dark'],
    ['hc', 'dark'],
    ['hcLight', 'light'],
    [undefined, 'dark'],
    ['invalid', 'dark']
]) {
    test(`web theme resolves active ${String(currentThemeType)}`, () => {
        assert.equal(resolvePartnerWebTheme(currentThemeType), expected);
    });
}
