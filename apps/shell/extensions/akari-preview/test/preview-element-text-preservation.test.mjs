import assert from 'node:assert/strict';
import test from 'node:test';
import { patchFragmentSourceText } from '../lib/browser/fragment-source-write.js';
import { resolvePreviewItemWrite } from '../../../../../packages/edit-store/lib/edit-v2-item-write.js';

test('text edit copies only text and keeps the element override in edit.json', () => {
  const source = '<div><span class="text">Old</span></div>\n';
  const live = '<div><span class="text" style="translate: 20px 5px">New</span></div>';
  assert.equal(patchFragmentSourceText(source, live), '<div><span class="text">New</span></div>\n');
  const doc = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'visual', lane: 'visual', items: [{ id: 'telop', at: 0, duration: 60,
      source: { kind: 'html', path: 'overlays/telop.html',
        elements: { '.text[0]': { style: { translate: '20px 5px' } } } } }] }] };
  const resolved = resolvePreviewItemWrite(JSON.stringify(doc),
    { kind: 'overlay', itemId: 'telop', patch: { html: live } });
  assert.equal(resolved.htmlPath, 'overlays/telop.html');
  assert.equal(resolved.candidateText, undefined);
  assert.equal(doc.tracks[0].items[0].source.elements['.text[0]'].style.translate, '20px 5px');
});
