import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { placePreviewLayerActions } from '../lib/common/preview-layer-action-placement.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const here = dirname(fileURLToPath(import.meta.url));
const style = readFileSync(join(here, '..', 'src', 'browser', 'preview-selection-handles-style.ts'), 'utf8');
const between = (start, end) => {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `${start} / ${end}`);
    return source.slice(first, last);
};

test('非等方スケールのクロップでも残った画素の画面位置が動かない', () => {
    const expression = between('const correctedTransformFor = nextCrop => {', 'const onMove = moveEvent =>')
        .trim().replace(/^const correctedTransformFor = /u, '').replace(/;$/u, '');
    const original = { x: 0.1, y: 0.2, w: 0.8, h: 0.7 };
    const nextCrop = { x: 0.1, y: 0.2, w: 0.55, h: 0.7 };
    const natural = { width: 1200, height: 800 };
    const startTransform = { x: 17, y: -29, scale: 1, scaleX: 1.7, scaleY: 0.6, rotate: 28 };
    const cropAnchorCorrectedTransformFn = (before, after, transform, width, height) => {
        const dx = ((after.x + after.w / 2) - (before.x + before.w / 2)) * width * transform.scale;
        const dy = ((after.y + after.h / 2) - (before.y + before.h / 2)) * height * transform.scale;
        const radians = transform.rotate * Math.PI / 180;
        return { x: transform.x + dx * Math.cos(radians) - dy * Math.sin(radians),
            y: transform.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
    };
    const corrected = vm.runInNewContext(`(${expression})(nextCrop)`, {
        original, nextCrop, natural, startTransform, cropAnchorCorrectedTransformFn
    });
    const screen = (crop, transform, pixel) => {
        const dx = (pixel.x - (crop.x + crop.w / 2) * natural.width) * transform.scaleX;
        const dy = (pixel.y - (crop.y + crop.h / 2) * natural.height) * transform.scaleY;
        const radians = transform.rotate * Math.PI / 180;
        return { x: transform.x + dx * Math.cos(radians) - dy * Math.sin(radians),
            y: transform.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
    };
    const retainedPixel = { x: 0.1 * natural.width, y: 0.55 * natural.height };
    const before = screen(original, startTransform, retainedPixel);
    const after = screen(nextCrop, corrected, retainedPixel);
    assert.ok(Math.abs(after.x - before.x) < 1e-9);
    assert.ok(Math.abs(after.y - before.y) < 1e-9);
    assert.equal(corrected.scaleX, startTransform.scaleX);
    assert.equal(corrected.scaleY, startTransform.scaleY);
});

test('写真と動画の layer 四辺は種類によらず cut と同じクロップ操作へ入る', () => {
    const wiring = between('const cropEdgeHandleElements = [', '// 通常ドラッグは cue 固有位置');
    const edge = dir => ({
        getAttribute: () => dir,
        addEventListener(_name, callback) { this.pointerdown = callback; }
    });
    const layerEdges = ['n', 'e', 's', 'w'].map(edge);
    const cutEdges = ['n', 'e', 's', 'w'].map(edge);
    const entries = [{ spec: { id: 'photo', isImage: true } },
        { spec: { id: 'movie', isImage: false } }];
    const calls = [];
    const context = {
        layerSelectBox: { querySelectorAll: () => layerEdges,
            classList: { contains: () => false } },
        cutSelectBox: { querySelectorAll: () => cutEdges },
        selectedLayerId: 'photo', cropModeActive: false, cutSelected: true,
        cutCropEditable: () => true, cutDragTarget: () => ({ kind: 'cut' }),
        findLayerEntry: id => entries.find(entry => entry.spec.id === id),
        layerDragTarget: entry => ({ kind: 'layer', id: entry.spec.id }),
        beginMediaCropDrag: (target, dir) => calls.push({ target, dir })
    };
    vm.runInNewContext(wiring, context);
    for (const id of ['photo', 'movie']) {
        context.selectedLayerId = id;
        for (const handle of layerEdges) handle.pointerdown({ button: 0 });
    }
    for (const handle of cutEdges) handle.pointerdown({ button: 0 });
    assert.equal(calls.length, 12);
    assert.deepEqual(calls.slice(0, 8).map(call => [call.target.kind, call.target.id, call.dir]),
        ['photo', 'movie'].flatMap(id => ['n', 'e', 's', 'w'].map(dir => ['layer', id, dir])));
    assert.deepEqual(calls.slice(8).map(call => [call.target.kind, call.dir]),
        ['n', 'e', 's', 'w'].map(dir => ['cut', dir]));
});

const hitAt = (entries, segment) => {
    const body = between('const findVisualMediaHitAt = event => {', 'libraryMediaHitAt = findVisualMediaHitAt;')
        .replaceAll('(${resolveLayerDeclaredSize.toString()})',
            '((w, h, output) => w > 0 && h > 0 ? { width: w, height: h } : output)');
    const video = { dataset: { akariCutIndex: '' }, style: { zIndex: '0' } };
    const context = {
        frameEngineMediaIdle: true, window: { akari: { interaction: { stageLocalPoint: () => ({ x: 100, y: 100 }) } } },
        layerEntries: entries, summary: { output: { width: 1280, height: 720 } }, outputTime: 1,
        allTracksHiddenByScope: { layers: false, cuts: false },
        hiddenTracksByScope: { layers: new Set(), cuts: new Set() },
        motionAtForSpec: () => null, layerGeometryHitAt: () => true,
        layerVisualTransformNow: () => ({ x: 0, y: 0, scale: 1, rotate: 0 }),
        layerCropNow: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        segments: [segment], activeSegmentIndex: 0, video,
        cutSelectBoxGeometry: () => ({ width: 1280, height: 720, centerX: 640, centerY: 360, rotate: 0 }),
        previewMotionBoxHitAtFn: () => true,
        frontmostPreviewHitFn: hits => hits.sort((a, b) => b.z - a.z || b.order - a.order)[0]?.element || null
    };
    const find = vm.runInNewContext(`${body}; findVisualMediaHitAt`, context);
    return { hit: find({ clientX: 100, clientY: 100 }), video };
};

test('metadata 未読込で display:none の動画 layer が当たり判定に入る', () => {
    const layer = { video: { style: { display: 'none', visibility: '', zIndex: '3' },
        videoWidth: 0, videoHeight: 0, naturalWidth: 0, naturalHeight: 0 },
    spec: { t: 0, duration: 5, track: 0, opacity: 1 } };
    assert.equal(hitAt([layer], { kind: 'gap' }).hit, layer.video);
});

test('全面の写真 cut は動画要素の一時的な cut index 空欄でも src セグメントで判定する', () => {
    const result = hitAt([], { kind: 'src', cutIndex: 0, track: 0 });
    assert.equal(result.hit, result.video);
    assert.equal(result.video.dataset.akariCutIndex, '0');
});

test('区間外の選択枠は破線で、四辺と丸いつまみを持たない', () => {
    const update = between('const updateLayerSelectBox = () => {', "window.addEventListener('message', event => {");
    assert.match(update, /const invisible = !inWindow \|\|/u);
    assert.match(update, /const declaredTransform = entry\.spec\.transform \|\| \{\};/u);
    assert.match(update, /const transform = invisible \? plainTransform/u);
    assert.match(update, /classList\.toggle\('akari-selected-invisible', invisible\)/u);
    assert.match(style, /#layer-select-box\.akari-selected-invisible \{ border-style: dashed; pointer-events: none !important;/u);
    assert.match(style, /#layer-select-box\.akari-selected-invisible \.akari-crop-edge \{ display: none !important; \}/u);
    const classes = new Set();
    const box = { style: {}, dataset: {}, classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    } };
    const layer = { spec: { id: 'photo', t: 2, duration: 3,
        transform: { x: 12, y: -4, scale: 1, scaleX: 1.4, scaleY: 0.8, rotate: 0 } },
    video: { videoWidth: 0, videoHeight: 0, readyState: 0, addEventListener() {} } };
    let measuredTransform;
    const hiddenControls = [];
    const context = {
        selectedLayerId: 'photo', findLayerEntry: () => layer,
        frameEngineMediaIdle: true, window: { akari: {} },
        summary: { output: { width: 1280, height: 720 } }, outputTime: 1,
        layerSelectBox: box, positionLayerCropToggle: value => hiddenControls.push(value),
        positionLayerPerspectiveToggle: value => hiddenControls.push(value),
        motionAtForSpec: () => ({ visible: { opacity: 1 } }),
        layerTransformNow: () => ({ x: 999, y: 999, scale: 2, rotate: 0 }),
        layerCropNow: () => ({ x: 0, y: 0, w: 1, h: 1 }),
        layerScreenRectForVideoRect: (transform, rect) => {
            measuredTransform = transform;
            return { left: 10, top: 20, width: rect.w, height: rect.h, rotOffX: 0, rotOffY: 0 };
        }
    };
    const executable = update.replaceAll('(${resolveLayerDeclaredSize.toString()})',
        '((w, h, output) => w > 0 && h > 0 ? { width: w, height: h } : output)');
    const draw = vm.runInNewContext(`${executable}; updateLayerSelectBox`, context);
    draw();
    assert.equal(classes.has('is-active'), true);
    assert.equal(classes.has('akari-selected-invisible'), true);
    assert.equal(box.style.width, '1280px');
    assert.equal(measuredTransform.x, 12);
    assert.equal(measuredTransform.scaleX, 1.4);
    assert.deepEqual(hiddenControls, [null, null]);
    context.outputTime = 2;
    context.motionAtForSpec = () => ({ visible: { opacity: 0 } });
    draw();
    assert.equal(classes.has('akari-selected-invisible'), true);
});

test('上端バーと選択メニューの両方の矩形を丸いつまみの配置に渡す', () => {
    assert.match(source, /floatingBarRect = event\.data\.rect;\s*updateFloatingMenuRect\(\)/u);
    assert.match(source, /hostMenuRect = event\.data\.rect;\s*updateFloatingMenuRect\(\)/u);
    assert.match(source, /layerSelectBox\.getBoundingClientRect\(\), floatingMenuRect, zoomScale/u);
    assert.match(source, /selectionRect, floatingMenuRect, stageScale/u);
    const unionCode = between('const updateFloatingMenuRect = () => {', 'const previewMotionGeometryTransformFn');
    const bar = { left: 100, top: 4, width: 500, height: 40 };
    const menu = { left: 350, top: 50, width: 300, height: 40 };
    const avoid = vm.runInNewContext(`${unionCode}; updateFloatingMenuRect(); floatingMenuRect`, {
        hostMenuRect: menu, floatingBarRect: bar, floatingMenuRect: null
    });
    const place = placePreviewLayerActions(
        { left: 0, top: 0, width: 1100, height: 620 },
        { left: 10, top: 10, width: 1080, height: 600 }, avoid);
    const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left
        && a.top < b.top + b.height && a.top + a.height > b.top;
    for (const control of [place.rotate, place.move]) {
        assert.equal(overlaps(control, bar), false);
        assert.equal(overlaps(control, menu), false);
    }
});
