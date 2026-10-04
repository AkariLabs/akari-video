import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `${start} / ${end}`);
    return source.slice(first, last);
};
const hitSource = between('const findVisualMediaHitAt = event => {', 'libraryMediaHitAt = findVisualMediaHitAt;')
    .replaceAll('(${resolveLayerDeclaredSize.toString()})',
        '((w, h, output) => w > 0 && h > 0 ? { width: w, height: h } : output)');
const pointerSource = between('const handleVisualMediaPointerDown = event => {',
    "layersStage.addEventListener('pointerdown', handleVisualMediaPointerDown, true);");
const segmentSource = between('const cutSegmentAtOutputTime = () =>',
    'const findVisualMediaHitAt = event => {');
const interactionSource = between('const cutInteractionSegment = () => {',
    'const cutSelectionVideo = () => {');

function fixture() {
    const video = { dataset: {}, style: { zIndex: '0' } };
    const stage = { id: 'frame-engine-canvas', closest: () => null };
    const segments = [
        { kind: 'gap', outStart: 0, outEnd: 1.6 },
        { kind: 'src', outStart: 1.6, outEnd: 5, cutIndex: 0, id: 'image-1-split',
            src: 'image-1', track: 0, trackId: 'visual', transform: { x: -420.6, y: 0 } },
    ];
    const clock = { seek: time => time };
    const context = {
        frameEngineMediaIdle: true,
        window: { akari: { frameEngineClock: clock, interaction: {
            stageLocalPoint: () => ({ x: 100, y: 100 }),
        } } },
        layerEntries: [], summary: { output: { width: 1280, height: 720 } },
        outputTime: 0, activeSegmentIndex: 0, segments, video, stillImage: {},
        allTracksHiddenByScope: { layers: false, cuts: false },
        hiddenTracksByScope: { layers: new Set(), cuts: new Set() },
        cutSelectBoxGeometry: () => ({ width: 1280, height: 720,
            centerX: 640 + Number(video.dataset.akariTransformX || 0), centerY: 360, rotate: 0 }),
        previewMotionBoxHitAtFn: box => Math.abs(box.centerX - 219.4) < 0.001,
        frontmostPreviewHitFn: hits => hits.sort((a, b) => b.z - a.z || b.order - a.order)[0]?.element || null,
        zForTrack: () => 0, zForItem: (_id, z) => z,
        previewStage: stage, layersStage: {}, stage: {},
        handledVisualPointerDownEvents: new WeakSet(), lastPhotoPointerDown: null,
        penModeActive: false, rectModeActive: false, cropModeActive: false,
        activeCaptionEdit: false, selectedCaptionId: false, cutSelected: false,
        initial: { imageSources: {} },
        selectCut: () => { context.cutSelected = true; },
        requestedCutId: undefined,
        pointerTranslationFrom: () => () => ({ x: 0, y: 0 }),
        cutDragTarget: () => ({ kind: 'cut' }), beginMediaTransformDrag: () => {},
    };
    vm.runInNewContext(`${segmentSource}${hitSource}${interactionSource}${pointerSource};
        this.click = event => handleVisualMediaPointerDown(event);
        this.currentCut = () => cutInteractionSegment();`, context);
    return {
        context, video, clock,
        click: () => context.click({ button: 0, target: stage, clientX: 100, clientY: 100 }),
        seek: time => { context.outputTime = clock.seek(time); },
    };
}

test('frame engine seek from leading gap makes still cut clickable without a model update', () => {
    const preview = fixture();
    preview.seek(2.2);
    assert.equal(preview.context.activeSegmentIndex, 0);
    assert.equal(preview.context.currentCut().id, 'image-1-split');
    preview.click();
    assert.equal(preview.context.cutSelected, true);
    assert.equal(preview.video.dataset.akariCutIndex, '0');
    assert.equal(preview.video.dataset.akariCutId, 'image-1-split');
    assert.equal(preview.video.dataset.akariTransformX, '-420.6');
});

test('the leading gap has no cut hit', () => {
    const preview = fixture();
    preview.seek(0.8);
    assert.equal(preview.context.currentCut(), null);
    preview.click();
    assert.equal(preview.context.cutSelected, false);
    assert.equal(preview.video.dataset.akariCutIndex, undefined);
});
