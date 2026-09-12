import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePersistentStrokeItems } from '../lib/index.js';

test('normalizes persistent pen and rect geometry without changing normalized coordinates', () => {
    const input = [
        { id: 'st-0001', tool: 'pen', recTStart: 1, points: [[0.1, 0.2], [0.8, 0.9]] },
        { id: 'st-0002', tool: 'rect', recTStart: 2, box: [0.2, 0.3, 0.4, 0.5] }
    ];
    assert.deepEqual(normalizePersistentStrokeItems(input), input);
});

test('tolerantly skips unknown and invalid legacy entries', () => {
    assert.deepEqual(normalizePersistentStrokeItems(undefined), []);
    assert.deepEqual(normalizePersistentStrokeItems([
        { tool: 'pen', points: [[0, 0], [1.2, 1]] },
        { tool: 'rect', box: [0.8, 0.1, 0.4, 0.2] },
        { tool: 'future', points: [[0, 0], [1, 1]] }
    ]), []);
});

test('accepts the old point-only annotation replay shape as pen', () => {
    assert.deepEqual(normalizePersistentStrokeItems([{ points: [[0, 0], [1, 1]] }]), [
        { tool: 'pen', points: [[0, 0], [1, 1]] }
    ]);
});

test('preserves a finite frame timeline and drops invalid frame metadata', () => {
    assert.deepEqual(normalizePersistentStrokeItems([
        { tool: 'pen', points: [[0, 0], [1, 1]], frame: { timelineT: 4.25, sourceT: 9 } },
        { tool: 'rect', box: [0.1, 0.2, 0.3, 0.4], frame: { timelineT: Number.NaN } },
        { tool: 'pen', points: [[0.2, 0.3], [0.4, 0.5]], frame: 'invalid' }
    ]), [
        { tool: 'pen', points: [[0, 0], [1, 1]], frame: { timelineT: 4.25 } },
        { tool: 'rect', box: [0.1, 0.2, 0.3, 0.4] },
        { tool: 'pen', points: [[0.2, 0.3], [0.4, 0.5]] }
    ]);
});
