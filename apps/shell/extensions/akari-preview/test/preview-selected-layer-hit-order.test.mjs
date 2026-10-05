import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const handlesCss = readFileSync(new URL('../src/browser/preview-selection-handles-style.ts', import.meta.url), 'utf8');
const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const helperStart = bootstrap.indexOf('            const shouldRegrabSelectedLayerFrame =');
const helperEnd = bootstrap.indexOf('            // The interaction layer asks once at pointerdown.', helperStart);

class HitElement {
    constructor(matches = {}) { this.matches = matches; }
    closest(selector) {
        return Object.entries(this.matches).find(([name]) => selector.includes(name))?.[1] || null;
    }
}

function regrabHarness() {
    assert.ok(helperStart >= 0 && helperEnd > helperStart, 'selected frame hit decision exists');
    const selected = { style: { zIndex: '20' } };
    const entry = { video: selected };
    const state = {
        Element: HitElement, window: { akari: { interaction: {} } },
        penModeActive: false, rectModeActive: false, cropModeActive: false,
        perspectivePanelOpen: false, selectionDragActive: false, activeCaptionEdit: false,
        photoSelect: null, photoBrush: null, selectedLayerId: 'photo',
        layerSelectBox: {
            classList: { contains: name => name === 'is-active' },
            getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
        },
        previewPane: { contains: () => true },
        findLayerEntry: id => id === 'photo' ? entry : null,
        findVisualMediaHitAt: () => null,
        captionLayer: { style: { zIndex: '30' } }
    };
    const context = vm.createContext(state);
    vm.runInContext(`${bootstrap.slice(helperStart, helperEnd)}\nglobalThis.regrab = selectedLayerFrameRegrabAt;\nglobalThis.decide = shouldRegrabSelectedLayerFrame;`, context);
    const event = (target = new HitElement(), x = 50, y = 50) => ({
        button: 0, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false,
        target, clientX: x, clientY: y
    });
    return { state, entry, selected, event, regrab: (pointer, hit) => context.regrab(pointer, hit),
        decide: values => context.decide(values) };
}

test('pure hit-order decision gives the selected frame only points without an upper hit', () => {
    const h = regrabHarness();
    const base = { x: 50, y: 50, bounds: { left: 0, top: 0, right: 100, bottom: 100 },
        selectedZ: 20, hitZ: null, hitIsSelected: false, hasHit: false, domZ: null };
    assert.equal(h.decide(base), true);
    assert.equal(h.decide({ ...base, x: 101 }), false);
    assert.equal(h.decide({ ...base, hasHit: true, hitZ: 30 }), false);
    assert.equal(h.decide({ ...base, hasHit: true, hitZ: 20, hitIsSelected: true }), true);
    assert.equal(h.decide({ ...base, hasHit: true, hitZ: 10 }), true);
    assert.equal(h.decide({ ...base, hasHit: true, hitZ: 20, domZ: 30 }), false);
});

test('selected photo frame yields to shape, text, HTML and caption above it', () => {
    const h = regrabHarness();
    const above = { style: { zIndex: '30' } };
    assert.equal(h.regrab(h.event(), above), null, 'another visual layer above the photo wins');
    for (const kind of ['shape', 'text', 'html', 'caption']) {
        const selector = kind === 'caption' ? '#caption-plate' : '[data-overlay-id]';
        const dom = { style: { zIndex: '30' } };
        const target = new HitElement({ [selector]: dom });
        assert.equal(h.regrab(h.event(target), h.selected), null, `${kind} above the photo wins`);
    }
    const interaction = new HitElement({ '[data-akari-interaction]': {} });
    assert.equal(h.regrab(h.event(interaction), h.selected), null, 'overlay controls keep their pointer');
});

test('empty and transparent parts of the selected photo frame remain draggable', () => {
    const h = regrabHarness();
    assert.equal(h.regrab(h.event(), null), h.entry, 'empty frame area regrabs');
    assert.equal(h.regrab(h.event(), h.selected), h.entry, 'photo itself regrabs');
    assert.equal(h.regrab(h.event(), { style: { zIndex: '10' } }), h.entry,
        'an alpha hole exposing lower media still regrabs');
    assert.equal(h.regrab(h.event(), { style: { zIndex: '30' } }), null,
        'a different photo above the selected one wins');
    assert.equal(h.regrab(h.event(), null), h.entry);
    assert.equal(h.regrab(h.event(new HitElement(), 101), null), null, 'outside the frame does not regrab');
    h.state.cropModeActive = true;
    assert.equal(h.regrab(h.event(), null), null, 'crop mode retains its own pointer path');
    h.state.cropModeActive = false;
    h.state.photoBrush = { itemId: 'photo' };
    assert.equal(h.regrab(h.event(), null), null, 'photo brush retains its own pointer path');
});

test('frame regrab runs before empty-hit return and suppresses background marquee', () => {
    assert.match(bootstrap, /const frameRegrab = typeof selectedLayerFrameRegrabAt === 'function'\s*&& selectedLayerFrameRegrabAt\(event, mediaHit\);\s*const allow = !blocked && !frameRegrab/);
    assert.match(bootstrap, /const regrabEntry = typeof selectedLayerFrameRegrabAt === 'function'\s*\? selectedLayerFrameRegrabAt\(event, hit\) : null;\s*if \(regrabEntry\) \{\s*beginLayerMoveDrag\(regrabEntry, event\);\s*return;\s*\}\s*if \(!hit\) return;/);
    assert.doesNotMatch(bootstrap.slice(helperStart, helperEnd), /findVisualMediaHitAt\(event\)/,
        'the caller supplies the existing one-pass media hit');
    assert.match(bootstrap, /typeof previewStage !== 'undefined' && typeof selectedLayerId !== 'undefined'\s*&& target === previewStage && !!selectedLayerId/);
});

test('selected frame body is transparent to the pointer while handles stay active', () => {
    assert.match(handler, /#layer-select-box\.is-active \{[^}]*pointer-events: auto;[^}]*cursor: move/);
    assert.match(handler, /#preview-chrome-layer\[data-frame-engine-active="true"\] #layer-select-box\.is-active \{ pointer-events: auto; \}/);
    assert.match(handlesCss, /#layer-select-box\.is-active:not\(\.akari-photo-pointer-mode\) \{ pointer-events: none !important; \}/);
    assert.match(handlesCss, /#layer-select-box\.is-active :is\(\.akari-layer-handle, \.akari-crop-edge\) \{ pointer-events: auto; \}/);
    assert.match(handlesCss, /#layer-select-box\.is-active\.akari-photo-pointer-mode, #cut-select-box\.is-active\.akari-photo-pointer-mode \{ pointer-events: auto; \}/);
    assert.match(handlesCss, /#layer-select-box\.akari-selected-invisible \{[^}]*pointer-events: none !important;/);
});
