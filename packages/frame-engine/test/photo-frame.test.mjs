import test from 'node:test';
import assert from 'node:assert/strict';
import { photoFrameUniforms } from '../dist/compositor/photo-frame.js';
import { buildResolvedTimelinePlan, evaluationPlanFromResolvedTimeline } from '../dist/index.js';

test('photo corners stay circular after anisotropic stretch', () => {
    const narrow = photoFrameUniforms({ cornerRadius: 100, stroke: { color: '#FF8040', width: 8 } }, 400, 400, 1920);
    const stretched = photoFrameUniforms({ cornerRadius: 100, stroke: { color: '#FF8040', width: 8 } }, 800, 400, 1920);
    assert.equal(narrow.radius, 200);
    assert.equal(stretched.radius, 200);
    assert.equal(stretched.strokeWidth, 8);
    assert.deepEqual(stretched.color, [1, 128 / 255, 64 / 255]);
});

test('photo rotation and frame reach the single evaluator used by preview and exports', () => {
    const source = { load: async () => { throw new Error('unused'); } };
    const crop = { x: .1, y: .1, w: .8, h: .8, rotate: 5 };
    const frame = { stroke: { color: '#ff8040', width: 8 }, cornerRadius: 40 };
    const timeline = buildResolvedTimelinePlan([{ src: 'photo.png', in: 0, out: 1 }], { layers: [
        { id: 'photo', kind: 'video', t: 0, duration: 1, src: 'photo.png', crop, frame }
    ] });
    const plan = evaluationPlanFromResolvedTimeline(timeline, 500_000,
        new Map([['photo.png', source]]), { width: 1920, height: 1080, colorSpace: 'bt709-limited' });
    assert.equal(plan.layers[0].visual.cropRotate, 5);
    assert.deepEqual(plan.layers[0].frame, frame);
});

test('a photo cut can show rotation while its edit is still a draft', () => {
    const source = { load: async () => { throw new Error('unused'); } };
    const timeline = buildResolvedTimelinePlan([{ src: 'photo.png', in: 0, out: 1,
        crop: { x: .1, y: .1, w: .8, h: .8, rotate: 5 } }]);
    const plan = evaluationPlanFromResolvedTimeline(timeline, 500_000,
        new Map([['photo.png', source]]), { width: 1920, height: 1080, colorSpace: 'bt709-limited' });
    assert.equal(plan.base[0].visual.layerStyle.cropRotate, 5);
});
