import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCutRanges, cutMotionReferencePaths, hydrateCutMotionReferences,
    restoreUncutMotionReferences, splitAtFrame } from '../lib/index.js';

const times = [0, 398, 400, 401, 402, 403, 441, 450, 936];
const points = times.map((t, index) => ({ t, transform: { scale: index === 0 || index === 8 ? 1 : 1.1 } }));
const fixture = () => ({ version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'video', path: 'video.mp4' }, { id: 'other', path: 'other.mp4' }],
    tracks: [{ id: 'main', lane: 'visual', items: [
        { id: 'sample', at: 152, duration: 936, source: { kind: 'media', src: 'video', in: 0, out: 936 / 30 },
            keyframes: { path: 'motion/sample-split.json', count: 9 } },
        { id: 'other', at: 1200, duration: 100, source: { kind: 'media', src: 'other', in: 0, out: 100 / 30 },
            keyframes: { path: 'motion/other.json', count: 2 } }
    ] }] });
const bags = () => new Map([
    ['motion/sample-split.json', { version: 0, group: 'sample-split', items: { sample: structuredClone(points) } }],
    ['motion/other.json', { version: 0, group: 'other', items: { other: [
        { t: 0, transform: { scale: 1 } }, { t: 100, transform: { scale: 1 } }
    ] } }]
]);
const scaleAt = (keyframes, t) => {
    const right = keyframes.find(point => point.t >= t);
    const left = [...keyframes].reverse().find(point => point.t <= t);
    if (!left) return right.transform.scale;
    if (!right || left.t === right.t) return left.transform.scale;
    return left.transform.scale + (right.transform.scale - left.transform.scale) * (t - left.t) / (right.t - left.t);
};
const checkPiece = item => {
    assert.ok(item.keyframes.length >= 2);
    assert.ok(item.keyframes.every((point, index) => Number.isInteger(point.t) && point.t >= 0
        && point.t <= item.duration && (index === 0 || point.t > item.keyframes[index - 1].t)));
};

test('袋から戻した点で区間カットと分割を行い、残る全フレームの動きを保つ', () => {
    const original = fixture();
    const motion = bags();
    assert.deepEqual(cutMotionReferencePaths(original), ['motion/sample-split.json', 'motion/other.json']);
    const hydrated = hydrateCutMotionReferences(original, motion);
    const cut = applyCutRanges(JSON.stringify(hydrated), [{ in: 41 / 30, out: 63 / 30, kind: 'row', captionId: 'video' }]);
    const cutEdit = restoreUncutMotionReferences(original, JSON.parse(cut.source), motion);
    const cutItems = cutEdit.tracks[0].items.filter(item => item.source.src === 'video');
    assert.equal(cutItems.length, 2);
    for (const item of cutItems) checkPiece(item);
    for (let t = 0; t <= 936; t++) {
        if (t >= 41 && t < 63) continue;
        const piece = t < 41 ? cutItems[0] : cutItems[1];
        assert.ok(Math.abs(scaleAt(points, t) - scaleAt(piece.keyframes, t < 41 ? t : t - 63)) < 1e-12);
    }
    assert.deepEqual(cutEdit.tracks[0].items.find(item => item.id === 'other').keyframes,
        original.tracks[0].items[1].keyframes);
    assert.deepEqual(motion.get('motion/other.json'), bags().get('motion/other.json'));

    const split = splitAtFrame(hydrated, 300, { itemIds: ['sample'] });
    const splitEdit = restoreUncutMotionReferences(original, split.edit, motion);
    const splitItems = splitEdit.tracks[0].items.filter(item => item.source.src === 'video');
    assert.equal(splitItems.length, 2);
    for (const item of splitItems) checkPiece(item);
    for (let t = 0; t <= 936; t++) {
        const piece = t <= 148 ? splitItems[0] : splitItems[1];
        assert.ok(Math.abs(scaleAt(points, t) - scaleAt(piece.keyframes, t <= 148 ? t : t - 148)) < 1e-12);
    }
    assert.deepEqual(original, fixture());
    assert.deepEqual(motion, bags());
});

test('袋の点数と項目が合わない場合は参照を残し、カット前に失敗する', () => {
    const edit = fixture();
    const motion = bags();
    motion.get('motion/sample-split.json').items.sample.pop();
    const hydrated = hydrateCutMotionReferences(edit, motion);
    assert.deepEqual(hydrated.tracks[0].items[0].keyframes, edit.tracks[0].items[0].keyframes);
    assert.throws(() => splitAtFrame(hydrated, 300, { itemIds: ['sample'] }), /袋を読み込めない/);
    assert.deepEqual(edit, fixture());
});
