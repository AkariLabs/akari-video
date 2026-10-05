import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { barItems, windowValues } from '../lib/common/context-bar-view.js';
import { readHandlerSource } from './helpers/handler-source.mjs';

const require = createRequire(import.meta.url);
const { PreviewContextBar } = require('../lib/browser/preview-context-bar.js');
const state = { selectedId: 'photo-1', kind: 'photo', item: { source: { kind: 'media', src: 'photo' },
    frame: { stroke: { width: 7, color: '#123456' }, cornerRadius: 35 } },
    output: { width: 1920, height: 1080 } };

test('photo tools are icon buttons with tooltips; border and radius open windows', () => {
    const items = barItems(state);
    const view = Object.create(PreviewContextBar.prototype);
    view.openWindow = null;
    for (const key of ['edit', 'replace', 'cutout', 'eraser', 'photoColor', 'border', 'photoRadius', 'crop', 'flip']) {
        const item = items.find(row => row.key === key);
        assert.equal(item?.text, undefined, key);
        const html = view.barItemHtml(item, 0);
        assert.match(html, /<svg /u, key);
        assert.match(html, new RegExp(`aria-label="${item.label}" title="${item.label}"`), key);
    }
    assert.equal(items.find(row => row.key === 'border').kind, 'window');
    assert.equal(items.find(row => row.key === 'photoRadius').kind, 'window');
    assert.equal(items.find(row => row.key === 'eraser').kind, 'inspector');
    assert.equal(items.find(row => row.key === 'crop').kind, 'inspector');
    assert.equal(windowValues(state).weight, 7);
    assert.equal(windowValues(state).radius, 35);
    assert.match(view.popHtml('border', state), /data-field="photoWeight"/u);
    assert.match(view.popHtml('border', state), /data-photo-frame-color/u);
    assert.match(view.popHtml('photoRadius', state), /data-field="photoRadius"/u);
});

test('photo frame sliders commit one inspector write and send live preview while dragging', () => {
    const messages = [], writes = [];
    const view = Object.create(PreviewContextBar.prototype);
    Object.assign(view, { state, pop: { querySelector: () => ({ value: '' }), querySelectorAll: () => [] },
        host: { sendMessage: message => messages.push(message) }, run: request => { writes.push(request); return Promise.resolve(); } });
    view.onPopInput({ target: { dataset: { field: 'photoWeight' }, type: 'range', value: '25' } });
    assert.deepEqual(messages[0].photoFrame, { stroke: { width: 25, color: '#123456' }, cornerRadius: 35 });
    view.onPopInput({ target: { dataset: { field: 'photoRadius' }, type: 'range', value: '50' } });
    assert.equal(messages[1].photoFrame.cornerRadius, 50);
    view.onPopInput({ target: { dataset: { photoFrameColor: '' }, type: 'color', value: '#abcdef' } });
    assert.equal(messages[2].photoFrame.stroke.color, '#abcdef');
    view.onPopChange({ target: { dataset: { field: 'photoWeight' }, value: '25', min: '0', max: '100' } });
    view.onPopChange({ target: { dataset: { field: 'photoRadius' }, value: '50', min: '0', max: '100' } });
    view.onPopChange({ target: { dataset: { photoFrameColor: '' }, value: '#abcdef' } });
    assert.deepEqual(writes, [
        { action: 'write', path: 'frame.stroke.width', value: 25 },
        { action: 'write', path: 'frame.cornerRadius', value: 50 },
        { action: 'write', path: 'frame.stroke.color', value: '#abcdef' }
    ]);
});

test('border and radius clicks open popovers without opening the inspector; eraser still opens it', () => {
    const original = globalThis.HTMLButtonElement;
    globalThis.HTMLButtonElement = class {};
    try {
        const calls = [];
        const view = Object.create(PreviewContextBar.prototype);
        Object.assign(view, { state, openWindow: null, barOverflowOpen: false, moreOpen: false,
            commands: { executeCommand: (...args) => calls.push(args) }, render: () => undefined });
        const click = key => view.onBarClick({ target: { closest: () => ({ dataset: { akariBarItem: key }, disabled: false }) } });
        click('border');
        assert.equal(view.openWindow, 'border');
        click('photoRadius');
        assert.equal(view.openWindow, 'photoRadius');
        assert.deepEqual(calls, []);
        click('eraser');
        assert.equal(view.openWindow, null);
        assert.equal(calls[0][0], 'akari.inspector.open');
        assert.equal(calls[0][1].fieldName, 'photo-brush-start');
    } finally {
        if (original === undefined) delete globalThis.HTMLButtonElement;
        else globalThis.HTMLButtonElement = original;
    }
});

test('photo frame live message updates both a still cut and a photo layer', () => {
    const source = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
    const start = source.indexOf("if (message.field === 'photoFrame'");
    const end = source.indexOf('for (const [field, value] of values) liveDom.update', start);
    assert.ok(start > 0 && end > start);
    const apply = new Function('message', 'video', 'stillImage', 'layersStage', 'window', source.slice(start, end));
    const frame = { cornerRadius: 45, stroke: { width: 9, color: '#123456' } };
    const still = { tagName: 'IMG', style: { display: 'block' }, dataset: {} };
    const cutCalls = [], engineMessages = [];
    const window = { akari: { applyCutLayerStyleLayout: media => cutCalls.push(media), updateLayerLayout: () => cutCalls.push('layer'),
        frameEngineClock: { applyLivePreview: message => engineMessages.push(message) } } };
    apply({ field: 'photoFrame', photoFrame: frame, target: { kind: 'item', id: 'cut-1' } },
        { dataset: { akariCutId: 'cut-1' } }, still, {}, window);
    assert.deepEqual(JSON.parse(still.dataset.akariPhotoFrame), frame);
    assert.equal(still.dataset.akariCutLayerStyleActive, 'true');
    assert.deepEqual(cutCalls, [still]);
    assert.equal(engineMessages.length, 1);
    const layer = { tagName: 'IMG', dataset: { akariLayerId: 'photo-1' } };
    apply({ field: 'photoFrame', photoFrame: frame, target: { kind: 'item', id: 'photo-1' } },
        { dataset: {} }, still, { querySelectorAll: () => [layer] }, window);
    assert.deepEqual(JSON.parse(layer.dataset.akariPhotoFrame), frame);
    assert.equal(cutCalls.at(-1), 'layer');
    assert.equal(engineMessages.length, 2);
});

test('frame engine receives live photo frame values for cuts and layers without changing the saved summary', () => {
    const source = readHandlerSource();
    const start = source.indexOf('const summaryWithLivePreview =');
    const end = source.indexOf('const applyEngineSummary =', start);
    assert.ok(start >= 0 && end > start);
    const update = new Function(`${source.slice(start, end)}; return summaryWithLivePreview;`)();
    const frame = { cornerRadius: 40, stroke: { color: '#abcdef', width: 8 } };
    const current = { cuts: [{ id: 'cut-1' }], layers: [{ id: 'photo-1' }] };
    for (const id of ['cut-1', 'photo-1']) {
        const next = update(current, { target: { kind: 'item', id }, field: 'photoFrame', value: 0, photoFrame: frame });
        assert.deepEqual((id === 'cut-1' ? next.cuts[0] : next.layers[0]).frame, frame);
        assert.equal((id === 'cut-1' ? current.cuts[0] : current.layers[0]).frame, undefined);
    }
});
