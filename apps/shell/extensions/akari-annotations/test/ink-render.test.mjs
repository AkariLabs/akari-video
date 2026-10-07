import test from 'node:test';
import assert from 'node:assert/strict';
import { inkToSvg } from '../lib/browser/ink-render.js';

const doc = { schema: 'akari.ink.v0', space: 'canvas-rect', aspect: { w: 1920, h: 1080 }, objects: [
    { id: 'ink-1', type: 'pen', color: '#f97316', x: 0.1, y: 0.1, points: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]], strokeWidth: 0.008 },
    { id: 'ink-2', type: 'arrow', color: '#2563eb', x: 0.3, y: 0.3, from: [0.3, 0.3], to: [0.5, 0.5], strokeWidth: 0.008 },
    { id: 'ink-3', type: 'text', color: '#111827', x: 0.6, y: 0.6, at: [0.6, 0.6], text: '文字', textHeight: 0.05 }
] };
const opts = { width: 1920, height: 1080 };

function assertBalanced(xml) {
    const stack = [];
    for (const tag of xml.match(/<\/?[A-Za-z][^>]*>/g) ?? []) {
        const name = /^<\/?([\w:-]+)/.exec(tag)?.[1];
        if (tag.startsWith('</')) assert.equal(stack.pop(), name);
        else if (!tag.endsWith('/>')) stack.push(name);
    }
    assert.deepEqual(stack, []);
}

test('SVG は整形式で各道具と選択枠を含む', () => {
    const svg = inkToSvg(doc, { ...opts, selectedIds: ['ink-1'] });
    assertBalanced(svg);
    assert.match(svg, /<path data-ink-id="ink-1"/);
    assert.match(svg, /<path data-ink-id="ink-2"/);
    assert.match(svg, /<text data-ink-id="ink-3"/);
    assert.match(svg, /data-ink-selection="ink-1"/);
});

test('文字と色の XML 特殊文字をすべて escape する', () => {
    const unsafe = { ...doc, objects: [{ ...doc.objects[2], text: `<&"'`, color: `red" onload="bad<&'` }] };
    const svg = inkToSvg(unsafe, opts);
    assert.match(svg, /&lt;&amp;&quot;&apos;/);
    assert.match(svg, /fill="red&quot; onload=&quot;bad&lt;&amp;&apos;"/);
    assert.ok(!svg.includes('onload="bad'));
    assertBalanced(svg);
});

test('同じ入力から同じ SVG を作る', () => {
    assert.equal(inkToSvg(doc, opts), inkToSvg(doc, opts));
});
