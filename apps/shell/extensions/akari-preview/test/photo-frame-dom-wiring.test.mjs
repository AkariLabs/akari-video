import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { photoFrameVisual } from '../lib/common/photo-frame-visual.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf('            const applyLayerStyleMediaLayout = (media, outputWidth, outputHeight, cut = false) => {');
const end = source.indexOf('            const applyCutLayerStyleLayout = media => {', start);
assert.ok(start >= 0 && end > start);
const body = source.slice(start, end);

test('DOM photo uses output-pixel round clip and inner frame after stretch', () => {
    const children = [];
    const document = { createElement: () => ({ style: {}, className: '' }),
        getElementById: () => ({ appendChild: child => children.push(child) }) };
    let maskRequested = false;
    const render = new Function('mediaNaturalSize', 'photoFrameVisualFn', 'photoCropClipPolygonFn', 'resolveLayerHitRegionClipFn',
        'preparePhotoMask', 'document', 'perspectiveVisualWarned',
        `${body}\nreturn applyLayerStyleMediaLayout;`)(media => ({ width: media.naturalWidth, height: media.naturalHeight }), photoFrameVisual,
        () => 'polygon(0% 0%)', () => 'inset(0)', () => { maskRequested = true; }, document, false);
    const media = { tagName: 'IMG', naturalWidth: 1920, naturalHeight: 1080, style: { display: 'block', zIndex: '10' },
        dataset: { akariTransformX: '0', akariTransformY: '0', akariTransformScale: '1',
            akariTransformScaleX: '1.215', akariTransformScaleY: '0.72', akariTransformRotate: '0',
            akariCropX: '.3418', akariCropY: '.012', akariCropW: '.1678', akariCropH: '.5302', akariCropRotate: '5',
            akariPhotoFrame: JSON.stringify({ stroke: { color: '#ffffff', width: 8 }, cornerRadius: 40 }),
            akariPhotoMaskUrl: '', akariPhotoErase: '[]', akariFlipH: 'false', akariFlipV: 'false' } };
    assert.equal(render(media, 1080, 1920), true);
    assert.equal(maskRequested, true);
    assert.ok(media.style.clipPath.startsWith('polygon('));
    assert.equal([...media.style.clipPath.matchAll(/%/g)].length, 136);
    assert.match(media.style.transform, /matrix\(/);
    assert.equal(children.length, 1);
    assert.equal(children[0].style.border, '4.5px solid #ffffff');
    assert.ok(Math.abs(parseFloat(children[0].style.borderRadius) - 78.288768) < 1e-7);
    assert.equal(children[0].style.display, 'block');
});

test('crop mode ghost rotates around the same source crop centre', () => {
    const start = source.indexOf('            const updateLayerCropBox = () => {');
    const end = source.indexOf('            const setCropMode = active => {', start);
    assert.ok(start >= 0 && end > start);
    const crop = { x: .3418, y: .012, w: .1678, h: .5302, rotate: 5 };
    const transform = { x: 0, y: 0, scale: 1, scaleX: 1.215, scaleY: .72, rotate: 0 };
    const target = { kind: 'layer', entry: { spec: { flip: { h: true } } },
        naturalSize: () => ({ width: 1920, height: 1080 }), visible: () => true,
        transformNow: () => transform, cropNow: () => crop };
    const ghost = { style: {} }, layerCropBox = { style: {}, classList: { add() {} } };
    const run = new Function('cropGhostTarget', 'cropModeActive', 'edgeCropDragActive',
        'layerScreenRectForVideoRect', 'layerCropBox', 'layerCropRect', 'photoCropTarget',
        'photoCropPanel', 'previewStage', 'summary', 'document', 'photoFrameVisualFn', 'positionLayerCropToggle',
        `${source.slice(start, end)}\nreturn updateLayerCropBox;`)(() => target, true, false,
        (_transform, rect) => ({ left: rect.x, top: rect.y, width: rect.w, height: rect.h }),
        layerCropBox, { style: {} }, target, { style: {}, offsetWidth: 200, offsetHeight: 40 },
        { clientWidth: 400, clientHeight: 600 }, { output: { width: 1080, height: 1920 } },
        { getElementById: () => ghost }, photoFrameVisual, () => {});
    run();
    const expected = photoFrameVisual({ crop, sourceWidth: 1920, sourceHeight: 1080,
        scaleX: 1.215, scaleY: .72, outputWidth: 1080, outputHeight: 1920,
        x: 0, y: 0, rotate: 0, flip: { h: true } });
    assert.equal(ghost.style.transform, expected.ghostMatrix);
    const [originX, originY] = ghost.style.transformOrigin.split(' ').map(Number.parseFloat);
    assert.ok(Math.abs(originX - 42.57) < 1e-8);
    assert.ok(Math.abs(originY - 27.71) < 1e-8);
});
