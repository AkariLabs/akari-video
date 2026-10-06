import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { cropRectAfterEdgeDrag } from '../lib/common/crop-edge-drag.js';
import { cropAnchorCorrectedTransform } from '../lib/common/layer-crop-anchor.js';
import { previewMotionGeometryTransform } from '../lib/common/preview-motion-geometry.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `${start} / ${end}`);
    return source.slice(first, last);
};
const near = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} != ${expected}`);

// Run the actual PSB setters and screen geometry in isolation, including the live-position
// override left by a move drag. The motion evaluator returns its live base pose here.
const layerHarness = () => {
    const code = [
        between('const layerTransformNow = entry => {', '// RAF スロットリング（2026-08-09 raf-throttle'),
        between('const applyLayerTransformNow = (entry, transform,', '// ㉔ layers[].crop'),
        between('const applyLayerCropAndTransformNow = (entry, crop, transform) => {', '// 裁定 0（cut と layer'),
        between('const layerVisualTransformNow = entry =>', 'const layerDragTarget = entry =>'),
        between('const layerScreenRectForVideoRect = (transform, videoRect, pivotPx) => {', 'const layerAlphaAtPoint ='),
        between('const correctedTransformFor = nextCrop => {', 'const onMove = moveEvent =>')
    ].join('\n');
    const context = {
        layerTransformVisualThrottle: { call() {} }, layerCropVisualThrottle: { call() {} },
        clampCrop: (x, y, w, h) => ({ x, y, w, h }),
        previewMotionGeometryTransformFn: previewMotionGeometryTransform,
        cropAnchorCorrectedTransformFn: cropAnchorCorrectedTransform,
        motionAtForSpec: (_spec, _t, _duration, live) => ({ visible: live }),
        window: { akari: { reportLiveValues() {}, computeOutputFrameRect: () => ({ x: 0, y: 0 }),
            stageScale: () => 1 } },
        summary: { output: { width: 1280, height: 720 } }, outputTime: 0
    };
    return { context, functions: vm.runInNewContext(`${code}; ({ layerTransformNow, applyLayerTransformNow,
        applyLayerCropAndTransformNow, layerVisualTransformNow, layerScreenRectForVideoRect,
        correctedTransformFor })`, context) };
};

const frame = (harness, crop, transform, width, height) => {
    const pivot = { x: (crop.x + crop.w / 2) * width, y: (crop.y + crop.h / 2) * height };
    const selection = harness.layerScreenRectForVideoRect(transform,
        { x: crop.x * width, y: crop.y * height, w: crop.w * width, h: crop.h * height }, pivot);
    const ghost = harness.layerScreenRectForVideoRect(transform,
        { x: 0, y: 0, w: width, h: height }, pivot);
    const angle = transform.rotate * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const centerX = selection.left + selection.width / 2;
    const centerY = selection.top + selection.height / 2;
    return { selection, ghost, axes: {
        left: centerX * cos + centerY * sin - selection.width / 2,
        right: centerX * cos + centerY * sin + selection.width / 2,
        top: -centerX * sin + centerY * cos - selection.height / 2,
        bottom: -centerX * sin + centerY * cos + selection.height / 2
    } };
};

const cases = [
    { name: '等方', crop: { x: 0, y: 0, w: 1, h: 1 }, scale: 0.3845 },
    { name: '非等方で既に crop 済み', crop: { x: 0, y: 0, w: 0.4, h: 1 },
        scale: 0.3845, scaleX: 0.3877, scaleY: 0.3813 },
    { name: '回転', crop: { x: 0.08, y: 0.12, w: 0.8, h: 0.7 }, scale: 0.7, rotate: 27,
        directions: ['e'] },
    { name: '反転', crop: { x: 0.08, y: 0.12, w: 0.8, h: 0.7 }, scale: 0.7,
        flip: { h: true }, directions: ['n'] },
    { name: '拡大', crop: { x: 0.08, y: 0.12, w: 0.8, h: 0.7 }, scale: 1.6,
        directions: ['w'] }
];

for (const scenario of cases) {
    for (const direction of scenario.directions ?? ['n', 'e', 's', 'w']) {
        test(`移動後の ${scenario.name} 写真: ${direction} 辺だけ動き、選択枠と点線が一致する`, () => {
            const { context, functions: harness } = layerHarness();
            const width = 1200, height = 800;
            const entry = { spec: { id: 'photo', t: 0, duration: 5, flip: scenario.flip },
                video: { dataset: {} } };
            if (scenario.flip) {
                // Flip changes the picture inside the box; PSB still passes it to the crop ghost.
                assert.match(source, /flip: target\.entry\?\.spec\.flip/u);
            }
            const transform = { x: 124, y: -67, scale: scenario.scale,
                ...(scenario.scaleX ? { scaleX: scenario.scaleX, scaleY: scenario.scaleY } : {}),
                rotate: scenario.rotate ?? 0 };
            // The move drag leaves both caches populated, as it does with item motion.
            harness.applyLayerTransformNow(entry, transform, { x: transform.x, y: transform.y },
                { x: transform.x, y: transform.y });
            const original = scenario.crop;
            const before = frame(harness, original, harness.layerVisualTransformNow(entry), width, height);
            const point = { x: original.x + original.w * (direction === 'w' ? 0.18 : 0.82),
                y: original.y + original.h * (direction === 'n' ? 0.18 : 0.82) };
            const next = cropRectAfterEdgeDrag(original, direction, point, 0.02);
            // The closure from beginMediaCropDrag uses these captured values.
            Object.assign(context, { original, startTransform: transform, natural: { width, height } });
            const nextTransform = harness.correctedTransformFor(next);
            harness.applyLayerCropAndTransformNow(entry, next, nextTransform);
            const live = harness.layerVisualTransformNow(entry);
            const after = frame(harness, next, live, width, height);
            const expected = frame(harness, next, harness.layerTransformNow(entry), width, height);
            assert.equal(entry.previewVisiblePosition, null);
            assert.equal(entry.previewPositionPatch, null);
            const draggedEdge = ({ n: 'top', e: 'right', s: 'bottom', w: 'left' })[direction];
            assert.ok(Math.abs(after.axes[draggedEdge] - before.axes[draggedEdge]) > 1,
                `${direction}: 掴んだ辺は動く`);
            for (const edge of ['left', 'right', 'top', 'bottom']) {
                near(after.axes[edge], expected.axes[edge], `${direction}: 選択枠の ${edge} と写真`);
                if (edge !== draggedEdge) {
                    near(after.axes[edge], before.axes[edge], `${direction}: 動かしていない ${edge}`);
                }
            }
            for (const key of ['left', 'top', 'width', 'height']) {
                near(after.ghost[key], before.ghost[key], `${direction}: 点線 ${key}`);
            }
            // Saved transform is what a project reload will read; it must have the same geometry.
            for (const edge of ['left', 'right', 'top', 'bottom']) {
                near(after.axes[edge], expected.axes[edge], `${direction}: 再読込後 ${edge}`);
            }
        });
    }
}

test('cut の crop 適用と復元も移動の可視位置キャッシュを解除する', () => {
    const apply = between('const applyCutCropAndTransformNow = (crop, transform) => {', '// Esc / 書き込み失敗の巻き戻し');
    const restore = between('const restoreCutVisual = snapshot => {', '// 裁定 0: layerDragTarget と同型の cut 版');
    assert.match(apply, /cutPreviewPositionPatch = null;\s*cutPreviewVisiblePosition = null;/u);
    assert.match(restore, /cutPreviewPositionPatch = null;\s*cutPreviewVisiblePosition = null;/u);
    assert.match(source, /restoreCrop: point => applyLayerCropAndTransformNow\(entry, point\.crop, point\.transform\)/u);
    assert.match(source, /const transform = target\.visualNow \? target\.visualNow\(\) : target\.transformNow\(\);/u);
    assert.match(source, /const box = layerScreenRectForVideoRect\(transform, cb, pivotPx\);/u);
});
