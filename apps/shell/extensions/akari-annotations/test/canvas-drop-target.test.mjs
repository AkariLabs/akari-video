import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasAtFrame, canvasDropDuration, canvasDropLabel, canvasDropTargets } from '../lib/browser/canvas-drop-target.js';

const tracks = [
    { id: 'v1', lane: 'visual', items: [{ id: 'lower', at: 300, duration: 150,
        source: { kind: 'group', canvas: { durationMode: 'fixed' } }, items: [] }] },
    { id: 'v2', lane: 'visual', items: [{ id: 'upper', name: '上の絵', at: 330, duration: 90,
        source: { kind: 'group', canvas: { durationMode: 'fixed' } }, items: [] }] },
    { id: 'a1', lane: 'audio', items: [] }
];

test('開始を含み終了を含まず、重なる区間では上のキャンバスを選ぶ', () => {
    const targets = canvasDropTargets(tracks);
    assert.equal(canvasAtFrame(targets, 299), undefined);
    assert.equal(canvasAtFrame(targets, 300)?.id, 'lower');
    assert.equal(canvasAtFrame(targets, 360)?.id, 'upper');
    assert.equal(canvasAtFrame(targets, 360, true), undefined);
    assert.equal(canvasAtFrame(targets, 420)?.id, 'lower');
    assert.equal(canvasAtFrame(targets, 450), undefined);
    assert.equal(canvasDropLabel(targets, targets[0]), 'キャンバス 1');
    assert.equal(canvasDropLabel(targets, targets[1]), '上の絵');
});

test('子の尺はキャンバスの終端で切る', () => {
    const target = canvasDropTargets(tracks)[0];
    assert.equal(canvasDropDuration(420, 150, target), 30);
    assert.equal(canvasDropDuration(300, 30, target), 30);
});

test('入れ子では親の itemIndex が大きくても内側を選ぶ', () => {
    const target = canvasAtFrame(canvasDropTargets([{ lane: 'visual', items: [
        { id: 'outer', at: 300, duration: 150, source: { kind: 'group', canvas: {} }, items: [
            { id: 'inner', at: 30, duration: 60, source: { kind: 'group', canvas: {} }, items: [] }
        ] },
        { id: 'sibling', at: 300, duration: 150, source: { kind: 'group', canvas: {} }, items: [] }
    ] }]), 360);
    assert.equal(target?.id, 'inner');
    assert.equal(target?.depth, 1);
});
