import assert from 'node:assert/strict';
import test from 'node:test';
import { renderTimelineRangeOverlay } from '../lib/browser/timeline/timeline-range-overlay.js';

class Element {
    dataset = {};
    style = {};
    children = [];
    textContent = '';
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
}

const render = (host, state, labels = true) => renderTimelineRangeOverlay(host, state, 30,
    seconds => seconds * 5, seconds => `00:${String(seconds).padStart(2, '0')}`, labels);
const nodes = (host, name) => host.children.filter(node => node.dataset[name] !== undefined);

test('I/O lines span ruler height at exact frame positions independently of translated labels', () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => new Element() };
    try {
        const ruler = new Element();
        render(ruler, { inFrame: 240, outFrame: 360 });
        const [band] = nodes(ruler, 'akariTimelineRangeBand');
        assert.deepEqual([band.style.left, band.style.width], ['40%', '20%']);
        const lines = nodes(ruler, 'akariTimelineRangeLine');
        assert.deepEqual(lines.map(line => [line.dataset.akariTimelineRangeLine, line.style.left]),
            [['I', '40%'], ['O', '60%']]);
        for (const line of lines) assert.deepEqual(
            [line.style.top, line.style.bottom, line.style.width, line.style.background],
            ['0', '0', '1px', 'var(--theia-focusBorder)']);
        const labels = nodes(ruler, 'akariTimelineRangeEdge');
        assert.deepEqual(labels.map(label => label.textContent), ['I 00:08', 'O 00:12']);
        assert.equal(labels[1].style.transform, 'translateX(-100%)');
        assert.equal(lines[1].style.transform, undefined);
        assert.equal(labels[1].style.borderInlineStart, undefined);
    } finally { globalThis.document = previous; }
});

test('track overlay draws only the band and full-height I/O lines', () => {
    const previous = globalThis.document;
    globalThis.document = { createElement: () => new Element() };
    try {
        const strip = new Element();
        render(strip, { inFrame: 240, outFrame: 360 }, false);
        assert.equal(nodes(strip, 'akariTimelineRangeBand').length, 1);
        assert.deepEqual(nodes(strip, 'akariTimelineRangeLine').map(line => line.style.left), ['40%', '60%']);
        assert.equal(nodes(strip, 'akariTimelineRangeEdge').length, 0);
        render(strip, { inFrame: 240 }, false);
        assert.equal(nodes(strip, 'akariTimelineRangeBand').length, 0);
        assert.deepEqual(nodes(strip, 'akariTimelineRangeLine').map(line => line.dataset.akariTimelineRangeLine), ['I']);
    } finally { globalThis.document = previous; }
});
