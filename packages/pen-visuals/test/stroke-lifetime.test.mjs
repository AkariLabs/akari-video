import assert from 'node:assert/strict';
import test from 'node:test';

import {
    PEN_TUNING,
    resolveStrokeLifetimeAlpha,
    selectVisibleStrokeItems
} from '../lib/index.js';

const tuning = { visibleWindowSec: 8, fadeOutMs: 1500 };
const pen = metadata => ({ tool: 'pen', points: [[0, 0], [1, 1]], ...metadata });

test('recording lifetime uses recTEnd across the window and fade boundaries', () => {
    const item = pen({ recTStart: 1, recTEnd: 2 });
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: true, visible: true, recT: 9 }, tuning), 1);
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: true, visible: true, recT: 10 }, tuning), 1);
    assert.ok(Math.abs(resolveStrokeLifetimeAlpha(
        item, { recording: true, visible: true, recT: 10.75 }, tuning
    ) - 0.5) <= 1e-9);
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: true, visible: true, recT: 11.51 }, tuning), 0);
});

test('recording falls back to recTStart and keeps untimed legacy items visible', () => {
    assert.equal(resolveStrokeLifetimeAlpha(
        pen({ recTStart: 2 }), { recording: true, visible: true, recT: 10.75 }, tuning
    ), 0.5);
    assert.equal(resolveStrokeLifetimeAlpha(
        pen({}), { recording: true, visible: true, recT: 100 }, tuning
    ), 1);
});

test('replay lifetime is symmetric around frame.timelineT', () => {
    const item = pen({ frame: { timelineT: 20 } });
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: false, visible: true, playheadT: 12 }, tuning), 1);
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: false, visible: true, playheadT: 28 }, tuning), 1);
    assert.ok(Math.abs(resolveStrokeLifetimeAlpha(
        item, { recording: false, visible: true, playheadT: 11.25 }, tuning
    ) - 0.5) <= 1e-9);
    assert.ok(Math.abs(resolveStrokeLifetimeAlpha(
        item, { recording: false, visible: true, playheadT: 28.75 }, tuning
    ) - 0.5) <= 1e-9);
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: false, visible: true, playheadT: 30 }, tuning), 0);
    assert.equal(resolveStrokeLifetimeAlpha(
        pen({}), { recording: false, visible: true, playheadT: 100 }, tuning
    ), 1);
});

test('visibility toggle hides every item in recording and replay contexts', () => {
    const item = pen({ recTEnd: 2, frame: { timelineT: 3 } });
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: true, visible: false, recT: 2 }, tuning), 0);
    assert.equal(resolveStrokeLifetimeAlpha(item, { recording: false, visible: false, playheadT: 3 }, tuning), 0);
});

test('selection drops zero alpha and preserves input order', () => {
    const first = pen({ id: 'first', frame: { timelineT: 2 } });
    const hidden = pen({ id: 'hidden', frame: { timelineT: 30 } });
    const third = pen({ id: 'third' });
    assert.deepEqual(
        selectVisibleStrokeItems(
            [first, hidden, third],
            { recording: false, visible: true, playheadT: 2 },
            tuning
        ).map(({ item, alpha }) => [item.id, alpha]),
        [['first', 1], ['third', 1]]
    );
});

test('PEN_TUNING keeps lifetime and drawing-effect durations distinct', () => {
    assert.equal(PEN_TUNING.visibleWindowSec, 8);
    assert.equal(PEN_TUNING.fadeOutMs, 1500);
    assert.equal(PEN_TUNING.fadeDurationMs, 600);
});
