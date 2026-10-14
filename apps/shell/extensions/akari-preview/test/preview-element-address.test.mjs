import { setLanguage } from '@akari-video/i18n';
import { after } from 'node:test';
setLanguage('ja');
after(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPreviewElementAddress } from '../lib/common/preview-element-address.js';

test('host rejects missing and mismatched element references', () => {
  const html = '<div class="chart"><span class="bar">A</span><span class="bar">B</span></div>';
  assert.doesNotThrow(() => assertPreviewElementAddress(html, '.bar[1]', 'span'));
  assert.throws(() => assertPreviewElementAddress(html, '.bar[2]', 'span'), /解決できません/);
  assert.throws(() => assertPreviewElementAddress(html, '.bar[1]', 'div'), /一致しません/);
});
