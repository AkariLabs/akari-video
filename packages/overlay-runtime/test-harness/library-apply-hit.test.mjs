import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(resolve(import.meta.dirname, '../src/interaction.js'), 'utf8');
const body = source.match(/  function libraryApplyHitTest\(x, y, fallbackCut, requestedKind\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(body);
const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
const element = (dataset, face = rect) => ({ dataset, style: { zIndex: '1' },
    getBoundingClientRect: () => face, querySelector: () => null });

test('文字を映像 item より先に拾い、空なら相手なし', () => {
    const caption = element({ captionKey: 'caption-1' });
    const layer = element({ akariLayerId: 'layer-1' });
    const document = { querySelectorAll: selector => selector.startsWith('.caption') ? [caption]
        : selector.startsWith('[data-akari-layer') ? [layer] : [] };
    const getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
    const hit = new Function('document', 'getComputedStyle', `${body}; return libraryApplyHitTest;`)(document, getComputedStyle);
    assert.equal(hit(50, 50, { kind: 'cut', id: 'cut-1', rect }).id, 'caption-1');
    assert.equal(hit(50, 50, { kind: 'cut', id: 'cut-1', rect }, 'lut').id, 'layer-1');
    document.querySelectorAll = selector => selector.startsWith('[data-akari-layer') ? [layer] : [];
    assert.equal(hit(50, 50).id, 'layer-1');
    document.querySelectorAll = () => [];
    assert.equal(hit(50, 50, { kind: 'cut', id: 'cut-1', rect }).id, 'cut-1');
    assert.equal(hit(150, 150, { kind: 'cut', id: 'cut-1', rect }), null);
});
