import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewLiveDomController } from '../lib/common/preview-live-dom.js';
import { nextPreviewLiveOverride } from '../lib/common/preview-live-override.js';

const element = dataset => {
    const styles = new Map();
    const attrs = new Map();
    return { dataset, styles, attrs, innerHTML: '',
        style: { setProperty: (name, value) => styles.set(name, value),
            getPropertyValue: name => styles.get(name) ?? '', getPropertyPriority: () => '' },
        setAttribute: (name, value) => attrs.set(name, value),
        removeAttribute: name => attrs.delete(name) };
};
const controller = ({ overlay, layer, caption } = {}) => createPreviewLiveDomController({
    stage: { querySelectorAll: () => overlay ? [overlay] : [] },
    layersStage: { querySelectorAll: () => layer ? [layer] : [] },
    captionRows: new Map(caption ? [['caption', { caption: { id: 'caption' }, plate: caption }]] : []),
    layerEntries: layer ? [{ spec: { id: layer.dataset.akariLayerId, adjust: { basic: { exposure: 0 } } } }] : [],
    computeAdjustCssVisual: adjust => ({ filter: `brightness(${2 ** adjust.basic.exposure})` }),
    video: element({}), next: nextPreviewLiveOverride
});

test('shape override changes the mounted CSS pose and marks the element', () => {
    const shape = element({ overlayId: 'box-a' });
    const live = controller({ overlay: shape });
    live.update('item:box-a', 'x', 480);
    shape.style.setProperty('--x', '480px');
    live.captureOverlayCss(shape);
    shape.style.setProperty('--x', '300px');
    live.paint();
    assert.equal(shape.styles.get('--x'), '480px');
    assert.equal(shape.attrs.get('data-akari-live-override'), '1');
});

test('photo exposure and caption size reach visible DOM targets', () => {
    const photo = element({ akariLayerId: 'photo-a' });
    const photoLive = controller({ layer: photo });
    photoLive.update('item:photo-a', 'adjust.basic.exposure', 1);
    photoLive.paint();
    assert.equal(photo.style.filter, 'brightness(2)');
    assert.equal(photo.attrs.get('data-akari-live-override'), '1');
    const caption = element({});
    const captionLive = controller({ caption });
    captionLive.update('caption:caption', 'caption.size', 60);
    captionLive.paint();
    assert.equal(caption.styles.get('--caption-font-size'), '60px');
    assert.equal(caption.styles.get('font-size'), '60px');
    assert.equal(caption.attrs.get('data-akari-live-override'), '1');
});

test('cancel removes the marker and restores the caption size', () => {
    const caption = element({});
    caption.style.setProperty('--caption-font-size', '38px');
    const live = controller({ caption });
    live.update('caption:caption', 'caption.size', 60);
    live.paint();
    live.clear();
    assert.equal(caption.attrs.has('data-akari-live-override'), false);
    assert.equal(caption.styles.get('--caption-font-size'), '38px');
});

test('caption line height, letter spacing and stroke width reach the plate and restore', () => {
    const caption = element({});
    caption.style.setProperty('--caption-line-height', '1.42');
    caption.style.setProperty('--caption-webkit-text-stroke', '3px #112233');
    const live = controller({ caption });
    live.update('caption:caption', 'caption.lineHeight', 1.8);
    live.update('caption:caption', 'caption.letterSpacing', 0.12);
    live.update('caption:caption', 'caption.strokeWidth', 6);
    live.paint();
    assert.equal(caption.styles.get('--caption-line-height'), '1.8');
    assert.equal(caption.styles.get('--caption-letter-spacing'), '0.12em');
    assert.equal(caption.styles.get('--caption-webkit-text-stroke'), '12px rgba(0,0,0,.9)');
    assert.equal(caption.attrs.get('data-akari-live-override'), '1');
    live.clear();
    assert.equal(caption.styles.get('--caption-line-height'), '1.42');
    assert.equal(caption.styles.get('--caption-webkit-text-stroke'), '3px #112233');
    assert.equal(caption.styles.get('--caption-letter-spacing'), '');
});

test('shape markup override swaps the overlay SVG and clear restores it', () => {
    const shape = element({ overlayId: 'box-a' });
    shape.innerHTML = '<svg data-original="1"></svg>';
    const live = controller({ overlay: shape });
    live.updateShape('item:box-a', '<svg data-live="1"></svg>');
    assert.equal(shape.innerHTML, '<svg data-live="1"></svg>');
    assert.equal(shape.attrs.get('data-akari-live-override'), '1');
    live.updateShape('item:box-a', '<svg data-live="2"></svg>');
    assert.equal(shape.innerHTML, '<svg data-live="2"></svg>');
    live.clear();
    assert.equal(shape.innerHTML, '<svg data-original="1"></svg>');
    assert.equal(shape.attrs.has('data-akari-live-override'), false);
});

test('photo adjust sliders merge into one visual with the committed basic values', () => {
    const photo = element({ akariLayerId: 'photo-a' });
    const seen = [];
    const live = createPreviewLiveDomController({
        stage: { querySelectorAll: () => [] },
        layersStage: { querySelectorAll: () => [photo] },
        captionRows: new Map(),
        layerEntries: [{ spec: { id: 'photo-a', adjust: { basic: { exposure: 0.5, saturation: 0.2 } } } }],
        computeAdjustCssVisual: adjust => { seen.push(adjust); return { filter: 'x' }; },
        video: element({}), next: nextPreviewLiveOverride
    });
    live.update('item:photo-a', 'adjust.basic.contrast', 0.4);
    live.update('item:photo-a', 'adjust.basic.saturation', -0.3);
    live.paint();
    assert.deepEqual(seen.at(-1), { basic: { exposure: 0.5, saturation: -0.3, contrast: 0.4 } });
    assert.equal(photo.style.filter, 'x');
    assert.equal(photo.attrs.get('data-akari-live-override'), '1');
});
