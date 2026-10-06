import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bootstrap = readFileSync(process.env.AKARI_PREVIEW_TEST_BOOTSTRAP
    ?? new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');

function section(start, end) {
    const first = bootstrap.indexOf(start);
    const last = bootstrap.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `preview pointer route: ${start}`);
    return bootstrap.slice(first, last);
}

class HitElement {
    constructor({ parent = null, overlayId = null, layerId = null, z = '' } = {}) {
        this.parentElement = parent;
        this.dataset = { ...(overlayId ? { overlayId } : {}),
            ...(layerId ? { akariLayerId: layerId } : {}) };
        this.style = { zIndex: z };
    }

    closest(selector) {
        for (let node = this; node; node = node.parentElement) {
            if (selector.includes('[data-overlay-id]') && node.dataset.overlayId) return node;
        }
        return null;
    }
}

function selectedPhotoHarness() {
    const photo = new HitElement({ layerId: 'photo', z: '20' });
    const frame = new HitElement({ overlayId: 'neon', z: '30' });
    const svg = new HitElement({ parent: frame });
    const wall = new HitElement({ parent: svg }); // painted SVG path/use descendant
    const moves = [];
    const state = {
        Element: HitElement,
        window: { akari: { interaction: { activeEdit: false } } },
        selectedLayerId: 'photo',
        layerSelectBox: { classList: { contains: name => name === 'is-active' },
            getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }) },
        previewPane: { contains: () => true },
        findLayerEntry: id => id === 'photo' ? { video: photo } : null,
        findVisualMediaHitAt: () => photo,
        captionLayer: { style: { zIndex: '30' } },
        penModeActive: false, rectModeActive: false, cropModeActive: false,
        perspectivePanelOpen: false, selectionDragActive: false, activeCaptionEdit: false,
        photoSelect: null, photoBrush: null, zoom: 1, motionDraw: false,
        frameEngineMediaIdle: true,
        video: new HitElement(), stillImage: new HitElement(),
        previewStage: new HitElement(), layersStage: new HitElement(), stage: new HitElement(),
        beginLayerMoveDrag: entry => moves.push(entry),
    };
    const context = vm.createContext(state);
    const helpers = section('            const shouldRegrabSelectedLayerFrame =',
        '            // The interaction layer asks once at pointerdown.');
    const marquee = section('            const marqueeStartDecisions = new WeakMap();',
        '            // cuts / layers / overlays / captions');
    const mediaRoute = section('            const handledVisualPointerDownEvents = new WeakSet();',
        '                if (!hit) return;');
    vm.runInContext(`${helpers}\n${marquee}\n${mediaRoute}                };\n`
        + 'globalThis.regrab = selectedLayerFrameRegrabAt;\n'
        + 'globalThis.decide = shouldRegrabSelectedLayerFrame;\n'
        + 'globalThis.mediaPointerDown = handleVisualMediaPointerDown;', context);
    const event = target => ({ button: 0, altKey: false, shiftKey: false,
        ctrlKey: false, metaKey: false, clientX: 50, clientY: 50, target,
        stopped: false, stopPropagation() { this.stopped = true; } });
    return { context, photo, frame, wall, moves, event };
}

test('selected photo yields to the painted wall of a higher SVG frame', () => {
    const h = selectedPhotoHarness();
    const pointer = h.event(h.wall);
    assert.equal(h.wall.closest('[data-overlay-id], #caption-plate'), h.frame);
    assert.equal(h.context.decide({ x: 50, y: 50,
        bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        selectedZ: 20, hitZ: 20, hitIsSelected: true, hasHit: true, domZ: 30 }), false);
    assert.equal(h.context.regrab(pointer, h.photo), null);
    assert.equal(h.context.window.akari.shouldStartPreviewMarquee(pointer), false);
    h.context.mediaPointerDown(pointer);
    assert.equal(pointer.stopped, false, 'the overlay runtime receives the wall pointer');
    assert.equal(h.moves.length, 0, 'the selected photo does not take the wall drag');
});

test('transparent SVG opening keeps the selected photo pointer route', () => {
    const h = selectedPhotoHarness();
    const pointer = h.event(h.photo); // elementFromPoint has passed through the SVG opening
    assert.equal(pointer.target.closest('[data-overlay-id], #caption-plate'), null);
    assert.equal(h.context.regrab(pointer, h.photo)?.video, h.photo);
    assert.equal(h.context.window.akari.shouldStartPreviewMarquee(pointer), false);
    h.context.mediaPointerDown(pointer);
    assert.equal(h.moves.length, 1);
    assert.equal(h.moves[0].video, h.photo);
});
