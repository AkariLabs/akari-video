import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = source.indexOf("                if (message?.type === 'akari-preview-set-zoom')");
const end = source.indexOf("                if (message?.type === 'akari-preview-select-primary')", start);
assert.ok(start > 0 && end > start);
const dispatch = source.slice(start, end);
function run(message, context) {
    return vm.runInNewContext(`(function () { ${dispatch} })()`, { message, ...context });
}
test('focus pulse color is defined for both themes and used by pulse and zone hints', () => {
    assert.equal(source.match(/--akari-focus-pulse: #f97316/g)?.length, 2);
    assert.match(source, /\.akari-focus-pulse[\s\S]*?var\(--akari-focus-pulse/);
    assert.match(source, /\.zone-hint-box[\s\S]*?var\(--akari-focus-pulse/);
});
test('webview playback requests toggle only when the requested state differs', () => {
    for (const isPlaying of [true, false]) {
        for (const playing of [true, false, undefined, 'true']) {
            let calls = 0;
            run({ type: 'akari-preview-set-playback', playing }, { isPlaying, togglePlayback: () => calls++ });
            assert.equal(calls, typeof playing === 'boolean' && playing !== isPlaying ? 1 : 0);
        }
    }
});
test('webview zoom and rate requests use existing setters', () => {
    const calls = [];
    const context = { setZoom: value => calls.push(value), setPreviewPlaybackRate: value => calls.push(value) };
    run({ type: 'akari-preview-set-zoom', scale: 2 }, context);
    run({ type: 'akari-preview-set-zoom', fit: true }, context);
    run({ type: 'akari-preview-set-rate', rate: 1.5 }, context);
    assert.deepEqual(calls, [2, 1, 1.5]);
});
test('webview panel requests select a requested layer before setting or toggling the panel', () => {
    for (const kind of ['crop-mode', 'perspective-panel']) {
        for (const on of [true, false, undefined]) {
            const calls = [];
            const context = { selectLayer: id => calls.push(id), cropModeActive: true, perspectivePanelOpen: true,
                setCropMode: state => calls.push(state), setPerspectivePanelOpen: state => calls.push(state) };
            run({ type: `akari-preview-set-${kind}`, itemId: 'layer', on }, context);
            assert.deepEqual(calls, ['layer', on ?? false]);
        }
    }
});
test('pulse matches literal IDs, restarts animation and leaves selection alone', () => {
    const id = 'a"[b]';
    const calls = [];
    const element = { getAttribute: key => key === 'data-overlay-id' ? id : null,
        classList: { remove: name => calls.push(['remove', name]), add: name => calls.push(['add', name]) },
        get offsetWidth() { calls.push(['reflow']); return 10; } };
    const layersStage = { querySelectorAll: selector => {
        assert.equal(selector, '[data-overlay-id], [data-akari-layer-id]'); return [element];
    } };
    for (let i = 0; i < 2; i++) run({ type: 'akari-preview-pulse-item', itemId: id }, { layersStage });
    assert.deepEqual(calls, Array(2).fill([['remove', 'akari-focus-pulse'], ['reflow'], ['add', 'akari-focus-pulse']]).flat());
    calls.length = 0;
    run({ type: 'akari-preview-pulse-item', itemId: 'missing' }, { layersStage });
    assert.deepEqual(calls, []);
    const listenerStart = source.indexOf("            layersStage.addEventListener('animationend'");
    const listenerEnd = source.indexOf('            const captionOutputFrame', listenerStart);
    let listener;
    vm.runInNewContext(source.slice(listenerStart, listenerEnd), { layersStage: { addEventListener: (_, fn) => { listener = fn; } } });
    listener({ animationName: 'unrelated', target: element });
    assert.deepEqual(calls, []);
    listener({ animationName: 'akari-focus-pulse-anim', target: element });
    assert.deepEqual(calls, [['remove', 'akari-focus-pulse']]);
});
test('pulse reaches a layer outside overlay-stage and removes its class on animation end', () => {
    const id = 'layer"[1]';
    const classes = new Set();
    const element = {
        getAttribute: key => key === 'data-akari-layer-id' ? id : null,
        classList: { remove: name => classes.delete(name), add: name => classes.add(name) },
        offsetWidth: 10
    };
    const stage = { querySelectorAll: () => [] };
    let listener;
    const layersStage = {
        querySelectorAll: selector => {
            assert.equal(selector, '[data-overlay-id], [data-akari-layer-id]');
            return [element, ...stage.querySelectorAll(selector)];
        },
        addEventListener: (type, fn) => {
            assert.equal(type, 'animationend');
            listener = fn;
        }
    };
    run({ type: 'akari-preview-pulse-item', itemId: id }, { stage, layersStage });
    assert.ok(classes.has('akari-focus-pulse'));
    const listenerStart = source.indexOf("            layersStage.addEventListener('animationend'");
    const listenerEnd = source.indexOf('            const captionOutputFrame', listenerStart);
    assert.ok(listenerStart >= 0 && listenerEnd > listenerStart);
    vm.runInNewContext(source.slice(listenerStart, listenerEnd), { stage, layersStage });
    listener({ animationName: 'akari-focus-pulse-anim', target: element });
    assert.equal(classes.size, 0);
});
test('zone hints share frame coordinates and replace the prior timer and boxes', () => {
    const start = source.indexOf('            const ZONE_ROW_RANGES');
    const end = source.indexOf("            layersStage.addEventListener('animationend'", start);
    const boxes = [];
    const cancelled = [];
    const timers = [];
    const layer = { replaceChildren: () => { boxes.length = 0; }, appendChild: box => boxes.push(box) };
    const show = vm.runInNewContext(`(function () { ${source.slice(start, end)} return showZoneHints; })()`, {
        document: { getElementById: () => layer, createElement: () => ({ style: {} }) },
        window: { akari: { computeOutputFrameRect: () => ({ x: 10, y: 20, width: 900, height: 600 }) } },
        clearTimeout: id => cancelled.push(id), setTimeout: (callback, duration) => { timers.push({ callback, duration }); return timers.length; }
    });
    show(['top-left', 'bottom-right'], 500);
    assert.equal(boxes.length, 2);
    assert.deepEqual({ ...boxes[0].style }, { left: '10px', top: '20px', width: '300px', height: '200px' });
    assert.equal(boxes[1].style.left, '610px');
    assert.equal(boxes[1].style.top, '420px');
    show(['center'], 700);
    assert.equal(boxes.length, 1);
    assert.equal(cancelled.at(-1), 1);
    assert.equal(timers.at(-1).duration, 700);
    timers.at(-1).callback();
    assert.equal(boxes.length, 0);
});
