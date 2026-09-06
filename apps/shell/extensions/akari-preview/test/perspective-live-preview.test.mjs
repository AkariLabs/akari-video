import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('const summaryWithLivePreview =');
const end = source.indexOf('const applyEngineSummary =', start);
assert.ok(start >= 0 && end > start);
const summaryWithLivePreview = new Function(`${source.slice(start, end)}; return summaryWithLivePreview;`)();

test('perspective live preview updates every corner/axis without mutating existing arrays', () => {
    for (const [index, corner] of ['tl', 'tr', 'bl', 'br'].entries()) {
        for (const [coordinate, axis] of ['x', 'y'].entries()) {
            const corners = [[0.1, 0.2], [0.9, 0.1], [0.2, 0.8], [0.8, 0.9]];
            const current = { layers: [{ id: 'layer-1', perspective: { corners } }, { id: 'other' }] };
            const before = structuredClone(current);
            const next = summaryWithLivePreview(current, {
                target: { kind: 'item', id: 'layer-1' }, field: `perspective.${corner}.${axis}`, value: 0.4
            });
            const expected = structuredClone(corners);
            expected[index][coordinate] = 0.4;
            assert.deepEqual(next.layers[0].perspective.corners, expected);
            assert.deepEqual(current, before);
            assert.equal(next.layers[1], current.layers[1]);
            next.layers[0].perspective.corners.forEach((pair, i) => assert.notEqual(pair, corners[i]));
        }
    }
});

test('missing perspective uses identity, invalid fields and targets leave the summary alone', () => {
    const current = { layers: [{ id: 'layer-1' }] };
    const message = { target: { kind: 'layer', id: 'layer-1' }, field: 'perspective.tl.x', value: 0.25 };
    assert.deepEqual(summaryWithLivePreview(current, message).layers[0].perspective,
        { corners: [[0.25, 0], [1, 0], [0, 1], [1, 1]] });
    for (const patch of [{ field: 'perspective.unknown.x' }, { field: 'perspective.tl.z' },
        { field: 'perspective.tl.x.extra' }, { value: NaN }, { target: { kind: 'layer', id: 'missing' } }]) {
        assert.equal(summaryWithLivePreview(current, { ...message, ...patch }), current);
    }
});
