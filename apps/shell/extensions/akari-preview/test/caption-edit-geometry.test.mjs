import assert from 'node:assert/strict';
import test from 'node:test';
import { captionOrientedFrame, captionSideMidpoint, captionWrapAnchorDelta, captionWrapResize,
    captionEditorWrapWidth, captionLineCountFromMetrics, captionEditorFitWidth,
    captionEditorLines, captionEditorValue, captionEditKeyAction, captionEditingNavigationKey
} from '../lib/common/caption-edit-geometry.js';

test('the frame corners follow a 30 degree caption', () => {
    const frame = captionOrientedFrame({ left: 0, right: 100, top: 0, bottom: 40 }, 1, 30);
    const halfWidth = 50 * Math.cos(Math.PI / 6), halfHeight = 20 * Math.sin(Math.PI / 6);
    assert.ok(Math.abs(frame.corners[0].x - (50 - halfWidth + halfHeight)) < 1e-9);
    assert.ok(Math.abs(frame.corners[0].y - (20 - 25 - 20 * Math.cos(Math.PI / 6))) < 1e-9);
    assert.equal(frame.corners.length, 4);
    assert.ok(frame.corners[0].y < frame.corners[1].y);
    const offset = captionOrientedFrame({ left: 0, right: 100, top: 0, bottom: 40,
        pivot: { x: 0, y: 0 } }, 1, 90);
    assert.ok(Math.abs(offset.center.x + 20) < 1e-9);
    assert.ok(Math.abs(offset.center.y - 50) < 1e-9);
});

test('both side grips preserve the opposite edge, including when rotated', () => {
    const start = { left: 120, right: 520, top: 200, bottom: 280 };
    const original = captionOrientedFrame(start, 1.5, 30);
    for (const side of ['e', 'w']) {
        const delta = { x: 90 * Math.cos(Math.PI / 6), y: 90 * Math.sin(Math.PI / 6) };
        const resized = captionWrapResize(side, start, delta, 30, 1.5, 1920);
        assert.equal(side === 'e' ? resized.left : resized.right, side === 'e' ? start.left : start.right);
        const next = captionOrientedFrame({ ...start, ...resized }, 1.5, 30);
        const fixedSide = side === 'e' ? 'w' : 'e';
        const fixed = captionSideMidpoint(original.corners, fixedSide);
        const uncorrected = captionSideMidpoint(next.corners, fixedSide);
        const dx = fixed.x - uncorrected.x, dy = fixed.y - uncorrected.y;
        const indexes = side === 'e' ? [0, 3] : [1, 2];
        for (const index of indexes) {
            assert.ok(Math.hypot(next.corners[index].x + dx - original.corners[index].x,
                next.corners[index].y + dy - original.corners[index].y) < 1e-9);
        }
    }
});

test('scaled reflow keeps the opposite x edge and the visible top', () => {
    const start = captionOrientedFrame({ left: 100, right: 500, top: 200, bottom: 280 }, 1.6, 0);
    const narrowed = captionOrientedFrame({ left: 100, right: 360, top: 200, bottom: 360 }, 1.6, 0);
    const delta = captionWrapAnchorDelta(start.corners, narrowed.corners, 'w');
    const movedWest = captionSideMidpoint(narrowed.corners, 'w');
    const fixedWest = captionSideMidpoint(start.corners, 'w');
    assert.ok(Math.abs(movedWest.x + delta.x - fixedWest.x) < 1e-9);
    assert.ok(Math.abs(Math.min(...narrowed.corners.map(p => p.y)) + delta.y
        - Math.min(...start.corners.map(p => p.y))) < 1e-9);
    const rotatedStart = captionOrientedFrame({ left: 100, right: 500, top: 200, bottom: 280 }, 1, 30);
    const rotatedNarrow = captionOrientedFrame({ left: 100, right: 300, top: 200, bottom: 360 }, 1, 30);
    const rotatedDelta = captionWrapAnchorDelta(rotatedStart.corners, rotatedNarrow.corners, 'w');
    assert.ok(Math.abs(Math.min(...rotatedNarrow.corners.map(p => p.y)) + rotatedDelta.y
        - Math.min(...rotatedStart.corners.map(p => p.y))) < 1e-9);
});

test('resizing a rotated caption pins the opposite top corner and its edge line', () => {
    for (const angle of [0, 30, -45]) {
        for (const side of ['e', 'w']) {
            const start = captionOrientedFrame({ left: 120, right: 520, top: 200, bottom: 280 }, 1.6, angle);
            const narrowed = captionOrientedFrame(side === 'e'
                ? { left: 120, right: 300, top: 200, bottom: 360 }
                : { left: 340, right: 520, top: 200, bottom: 360 }, 1.6, angle);
            const indexes = side === 'e' ? [0, 3] : [1, 2];
            const delta = captionWrapAnchorDelta(start.corners, narrowed.corners, side === 'e' ? 'w' : 'e');
            const anchored = narrowed.corners.map(point => ({ x: point.x + delta.x, y: point.y + delta.y }));
            assert.ok(Math.hypot(anchored[indexes[0]].x - start.corners[indexes[0]].x,
                anchored[indexes[0]].y - start.corners[indexes[0]].y) < 1e-9);
            const a = start.corners[indexes[0]], b = start.corners[indexes[1]];
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            for (const index of indexes) {
                const point = anchored[index];
                const distance = Math.abs((b.x - a.x) * (point.y - a.y)
                    - (b.y - a.y) * (point.x - a.x)) / length;
                assert.ok(distance < 1e-9, `${angle}° ${side}: ${distance}`);
            }
        }
    }
});

test('the editor retains saved and newly inserted line breaks', () => {
    assert.deepEqual(captionEditorLines('一行目\r\n二行目\n三行目'), ['一行目', '二行目', '三行目']);
    assert.equal(captionEditorValue('一行目\n二行目'), '一行目\n二行目');
    assert.equal(captionEditorValue('一行目\n'), '一行目\n');
    assert.equal(captionEditorValue('一行目\n\n', true), '一行目\n');
    assert.equal(captionEditorValue('一行目\n\n\n', true), '一行目\n\n');
    assert.equal(captionEditorValue('一行目\n\n', false), '一行目\n\n');
    assert.equal(captionEditorWrapWidth([120, 180, 90]), 180);
    assert.equal(captionEditorWrapWidth([0, Number.NaN]), undefined);
    assert.equal(captionLineCountFromMetrics(108, 50, 4, 4), 2);
    const fitted = captionEditorFitWidth(200, 2, width => Math.ceil(160 / width));
    assert.ok(fitted < 160 && fitted > 150);
});

test('caption edit keys follow the platform and leave IME Enter alone', () => {
    const key = (key, flags = {}) => ({ key, metaKey: false, ctrlKey: false, ...flags });
    for (const mac of [true, false]) {
        assert.equal(captionEditKeyAction(key('Enter'), mac), 'line-break');
        assert.equal(captionEditKeyAction(key('Enter', { shiftKey: true }), mac), 'line-break');
        assert.equal(captionEditKeyAction(key('Escape'), mac), 'cancel');
        assert.equal(captionEditKeyAction(key('Enter', { isComposing: true }), mac), 'none');
        assert.equal(captionEditKeyAction(key('Enter', { keyCode: 229 }), mac), 'none');
    }
    assert.equal(captionEditKeyAction(key('Enter', { metaKey: true }), true), 'commit');
    assert.equal(captionEditKeyAction(key('Enter', { ctrlKey: true }), false), 'commit');
    assert.equal(captionEditKeyAction(key('Enter', { ctrlKey: true }), true), 'line-break');
    assert.equal(captionEditKeyAction(key('Enter', { metaKey: true }), false), 'line-break');
});

test('editing blocks navigation keys while ordinary timeline focus keeps them', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        assert.equal(captionEditingNavigationKey(true, key), true);
        assert.equal(captionEditingNavigationKey(false, key), false);
    }
    assert.equal(captionEditingNavigationKey(true, 'Escape'), false);
});
