import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../src/interaction.js'), 'utf8');
const body = source.match(/  function libraryApplyHitTest\(x, y, fallbackCut, requestedKind\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(body);

test('3D の全画面 canvas は内容枠で拾い、枠の外には素材を置ける', () => {
    const full = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
    const content = { left: 60, top: 10, right: 140, bottom: 90, width: 80, height: 80 };
    const canvas = { getBoundingClientRect: () => full };
    const scene = { dataset: { overlayId: 'model-1' }, style: { zIndex: '3' },
        querySelector: selector => selector.startsWith('script') ? {} : selector === 'canvas' ? canvas : null };
    const document = { querySelectorAll: selector => selector === '[data-overlay-id]' ? [scene] : [] };
    const window = { akari: { threeRuntime: { contentBounds: () => content } } };
    const getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    const hit = new Function('document', 'window', 'getComputedStyle', `${body}; return libraryApplyHitTest;`)(
        document, window, getComputedStyle);
    assert.deepEqual(hit(100, 50, undefined, 'video'), { kind: 'item', id: 'model-1', rect: content });
    assert.equal(hit(20, 50, undefined, 'video'), null);
});
