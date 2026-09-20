import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const uri_1 = require('@theia/core/lib/common/uri');
const preview_playback_rate_1 = require('../lib/common/preview-playback-rate.js');
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const compiled = readFileSync(new URL('../lib/browser/akari-preview-open-handler.js', import.meta.url), 'utf8');
const CAPTION_ZONES = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
const editUri = 'file:///project/edit.json';
function extractMethod(name) {
    const match = new RegExp(`^    (?:async )?${name}\\(`, 'm').exec(compiled);
    assert.ok(match, name);
    const end = compiled.indexOf('\n    }', match.index) + 6;
    assert.ok(end > match.index);
    return compiled.slice(match.index, end).trim();
}
function method(name) {
    return vm.runInNewContext(`({ ${extractMethod(name)} }).${name}`, { uri_1, preview_playback_rate_1, CAPTION_ZONES });
}
const cases = [
    ['SetPreviewFullscreen', 'setFullscreen', 'setPreviewFullscreen', {}, null],
    ['SetPreviewViewZoom', 'setViewZoom', 'setPreviewViewZoom', { scale: 2 }, { type: 'akari-preview-set-zoom', scale: 2 }],
    ['SetPreviewPlaybackRate', 'setPlaybackRate', 'setPreviewPlaybackRateExternal', { rate: 1.7 }, { type: 'akari-preview-set-rate', rate: 1.5 }],
    ['SetPreviewLoopRange', 'setLoopRange', 'setPreviewLoopRange', { startSeconds: 2, endSeconds: 5 }, { type: 'akari-preview-loop-range', range: { start: 2, end: 5 } }],
    ['PreviewPlay', 'play', 'playOutputPreview', {}, { type: 'akari-preview-set-playback', playing: true }],
    ['PreviewPause', 'pause', 'pauseOutputPreview', {}, { type: 'akari-preview-set-playback', playing: false }],
    ['PreviewCropMode', 'enterCropMode', 'enterPreviewCropMode', { itemId: 'layer', on: true }, { type: 'akari-preview-set-crop-mode', itemId: 'layer', on: true }],
    ['PreviewPerspectivePanel', 'openPerspectivePanel', 'openPreviewPerspectivePanel', { itemId: 'layer', on: false }, { type: 'akari-preview-set-perspective-panel', itemId: 'layer', on: false }],
    ['PulsePreviewItem', 'pulseItem', 'pulsePreviewItem', { itemId: 'overlay' }, { type: 'akari-preview-pulse-item', itemId: 'overlay' }],
    ['ShowPreviewZoneHint', 'showZoneHint', 'showPreviewZoneHint', { zones: ['top', 'invalid', 'bottom'] }, { type: 'akari-preview-zone-hint', zones: ['top', 'bottom'], durationMs: 2000 }]
];
function setup(patch = {}) {
    const sent = [];
    const widget = { akariPreviewConfigured: true, isAttached: true, isDisposed: false,
        akariPreviewSummary: { layers: [{ id: 'layer' }], overlays: [{ id: 'overlay' }], cuts: [{ id: 'cut' }] },
        sendMessage: value => sent.push(JSON.parse(JSON.stringify(value))), ...patch };
    const host = { openOutputPreviews: new Map([[editUri, widget]]),
        getExternalPreviewWidget: method('getExternalPreviewWidget'),
        nearestPreviewRatePreset: method('nearestPreviewRatePreset'),
        togglePreviewFullscreen: method('togglePreviewFullscreen'), transitions: [],
        enterPreviewFullscreen(value) { this.transitions.push('enter'); this.fullscreenPreviewWidget = value; },
        exitPreviewFullscreen() { this.transitions.push('exit'); this.fullscreenPreviewWidget = undefined; } };
    return { host, widget, sent };
}
for (const [, id, name, args, expected] of cases) {
    test(`${id}: applies to the normalized target`, async () => {
        const { host, sent, widget } = setup();
        assert.equal(await method(name).call(host, { editUri: 'file:///project/sub/../edit.json', ...args }), true);
        assert.deepEqual(sent, expected ? [expected] : []);
        if (!expected) assert.equal(host.fullscreenPreviewWidget, widget);
    });
    test(`${id}: unavailable targets and missing requests are inert`, async () => {
        for (const patch of [{ isAttached: false }, { isDisposed: true }, { akariPreviewConfigured: false }, {}]) {
            const { host, sent } = setup(patch);
            if (!Object.keys(patch).length) host.openOutputPreviews.clear();
            assert.equal(await method(name).call(host, { editUri, ...args }), false);
            assert.deepEqual(sent, []);
            assert.deepEqual(host.transitions, []);
        }
        const { host, sent } = setup();
        for (const request of [undefined, null, {}, { editUri: 123 }, { editUri: '' }]) {
            assert.equal(await method(name).call(host, request), false);
        }
        assert.deepEqual(sent, []);
    });
}
test('fullscreen: explicit states are idempotent and exit preserves another target', async () => {
    const { host, widget } = setup();
    const apply = on => method('setPreviewFullscreen').call(host, { editUri, on });
    await apply(true); await apply(true);
    assert.deepEqual(host.transitions, ['exit', 'enter']);
    assert.equal(host.fullscreenPreviewWidget, widget);
    await apply(false); await apply(false);
    assert.deepEqual(host.transitions, ['exit', 'enter', 'exit']);
    const other = {};
    host.fullscreenPreviewWidget = other;
    await apply(false);
    assert.equal(host.fullscreenPreviewWidget, other);
    await apply(true);
    assert.equal(host.fullscreenPreviewWidget, widget);
    await apply(undefined);
    assert.equal(host.fullscreenPreviewWidget, undefined);
});
test('rate: all preset boundaries and ties choose the nearest lower preset', () => {
    const nearest = method('nearestPreviewRatePreset');
    const presets = preview_playback_rate_1.PREVIEW_RATE_PRESETS;
    assert.equal(nearest(0.6), 0.5);
    assert.equal(nearest(0.01), 0.5);
    assert.equal(nearest(100), 3);
    for (const preset of presets) assert.equal(nearest(preset), preset);
    for (let i = 1; i < presets.length; i++) {
        const mid = (presets[i - 1] + presets[i]) / 2;
        assert.equal(nearest(mid - 0.001), presets[i - 1]);
        assert.equal(nearest(mid), presets[i - 1]);
        assert.equal(nearest(mid + 0.001), presets[i]);
    }
});
test('invalid inputs are inert and never clear an existing range', async () => {
    for (const [name, requests] of [
        ['setPreviewViewZoom', [{}, ...[0, -1, NaN, Infinity, '2'].map(scale => ({ scale }))]],
        ['setPreviewPlaybackRateExternal', [{}, ...[0, -1, NaN, Infinity, '2'].map(rate => ({ rate }))]],
        ['setPreviewLoopRange', [{}, { clear: false }, { startSeconds: 3, endSeconds: 3 }, { startSeconds: 4, endSeconds: 2 }, { startSeconds: NaN, endSeconds: 2 }, { startSeconds: 0, endSeconds: Infinity }]],
        ['showPreviewZoneHint', [{}, { zones: 'top' }, { zones: [] }, { zones: ['invalid', 2, null] }]]
    ]) {
        const { host, sent } = setup();
        for (const request of requests) assert.equal(await method(name).call(host, { editUri, ...request }), false);
        assert.deepEqual(sent, []);
    }
});
test('zoom fallback, explicit range clearing and zone durations follow the contract', async () => {
    const { host, sent } = setup();
    await method('setPreviewViewZoom').call(host, { editUri, fit: true, scale: 3 });
    await method('setPreviewViewZoom').call(host, { editUri, fit: true, scale: NaN });
    await method('setPreviewLoopRange').call(host, { editUri, clear: true });
    assert.deepEqual(sent.splice(0), [{ type: 'akari-preview-set-zoom', scale: 3 }, { type: 'akari-preview-set-zoom', fit: true }, { type: 'akari-preview-loop-range', range: null }]);
    for (const [durationMs, expected] of [[-1, 300], [9000, 8000], [1234, 1234], [NaN, 2000], [Infinity, 2000]]) {
        await method('showPreviewZoneHint').call(host, { editUri, zones: CAPTION_ZONES, durationMs });
        assert.deepEqual(sent.pop(), { type: 'akari-preview-zone-hint', zones: CAPTION_ZONES, durationMs: expected });
    }
});
for (const name of ['enterPreviewCropMode', 'openPreviewPerspectivePanel', 'pulsePreviewItem']) {
    test(`${name}: rejects unsupported item IDs`, async () => {
        const { host, sent } = setup();
        for (const itemId of ['missing', 'cut', 'caption', '', 3, null, ...(name === 'pulsePreviewItem' ? [] : ['overlay'])]) {
            assert.equal(await method(name).call(host, { editUri, itemId }), false);
        }
        assert.deepEqual(sent, []);
        assert.equal(await method(name).call(host, { editUri, itemId: 'layer' }), true);
        if (name !== 'pulsePreviewItem') assert.equal(await method(name).call(host, { editUri }), true);
    });
}
test('all ten unlabeled commands register from onStart and delegate requests', () => {
    const onStart = extractMethod('onStart');
    for (const [registration, id, name] of cases) {
        assert.match(onStart, new RegExp(`this\\.register${registration}Command\\(\\)`));
        assert.ok(source.includes(`{ id: 'akari.preview.${id}' };`));
        assert.match(extractMethod(`register${registration}Command`), new RegExp(`this\\.${name}\\(request\\)`));
    }
});
