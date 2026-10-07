import assert from 'node:assert/strict';
import test from 'node:test';
import { hostAdapterScript } from '../lib/browser/preview-script-host-adapter.js';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';

test('host adapter posts owner selection with ref and label only', async t => {
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div></div>');
  await page.evaluate(() => { window.akari = {}; window.messages = []; });
  const script = hostAdapterScript();
  const start = script.indexOf('window.akari.reportOverlaySelection =');
  const end = script.indexOf('window.akari.reportLayerSelection =', start);
  assert.ok(start >= 0 && end > start);
  await page.addScriptTag({ content: `let selectedPrimary = null;
    const vscode = { postMessage: message => window.messages.push(message) };
    ${script.slice(start, end)}` });
  const posted = await page.evaluate(() => {
    window.akari.reportOverlaySelection('bars', null, ['bars'],
      { overlayId: 'bars', ref: '.bar[2]', tag: 'div', label: 'bar 3' });
    window.akari.reportOverlaySelection('bars');
    return window.messages;
  });
  assert.deepEqual(posted, [
    { type: 'akari-preview-overlay-selected', overlayId: 'bars', scopeId: null,
      overlayIds: ['bars'], element: { ref: '.bar[2]', label: 'bar 3' } },
    { type: 'akari-preview-overlay-selected', overlayId: 'bars', element: null }
  ]);
});
