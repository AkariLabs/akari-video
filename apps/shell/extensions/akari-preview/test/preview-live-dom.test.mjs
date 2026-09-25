import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPreviewLiveDomController } from '../lib/common/preview-live-dom.js';
import { nextPreviewLiveOverride } from '../lib/common/preview-live-override.js';

const element = dataset => {
    const styles = new Map();
    const attrs = new Map();
    return { dataset, styles, attrs,
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
