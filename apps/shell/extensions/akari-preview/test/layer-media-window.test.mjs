import assert from 'node:assert/strict';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const source = readHandlerSource();
const predicate = source.match(/const layerNeedsMetadataAt = ([\s\S]*?);\s*const syncLayerMediaWindow =/u)?.[1];
const synchronizer = source.match(/const syncLayerMediaWindow = ([\s\S]*?\n            \});/u)?.[1];
assert.ok(predicate, 'layer metadata window predicate');
assert.ok(synchronizer, 'layer metadata window synchronizer');

function entries() {
    return Array.from({ length: 95 }, (_unused, index) => {
        const attributes = new Map();
        let loads = 0;
        const video = {
            tagName: 'VIDEO',
            getAttribute: name => attributes.get(name) ?? null,
            hasAttribute: name => attributes.has(name),
            removeAttribute: name => attributes.delete(name),
            load: () => { loads++; },
            set src(value) { attributes.set('src', value); }
        };
        return { spec: { id: String(index), t: index * 10, duration: 20,
            src: 'stream-' + index }, video, loads: () => loads };
    });
}

function windowFor(layerEntries, frameEngineMediaIdle) {
    const layerNeedsMetadataAt = new Function('LAYER_METADATA_WINDOW_SECONDS',
        `return (${predicate});`)(10);
    return new Function('frameEngineMediaIdle', 'layerEntries', 'optimisticallyRemovedIds',
        'layerNeedsMetadataAt', `return (${synchronizer});`)(frameEngineMediaIdle,
        layerEntries, new Set(), layerNeedsMetadataAt);
}

test('95 engine layers at 600 seconds attach src only inside the ten-second window and release on seek', () => {
    const layerEntries = entries();
    const sync = windowFor(layerEntries, true);
    sync(600);
    assert.deepEqual(layerEntries.map((entry, index) => entry.video.hasAttribute('src') ? index : null)
        .filter(index => index !== null), [58, 59, 60]);
    sync(300);
    assert.deepEqual(layerEntries.map((entry, index) => entry.video.hasAttribute('src') ? index : null)
        .filter(index => index !== null), [28, 29, 30]);
    assert.equal(layerEntries[60].loads(), 1);
});

test('legacy media window leaves every existing src attached', () => {
    const layerEntries = entries();
    for (const entry of layerEntries) entry.video.src = entry.spec.src;
    windowFor(layerEntries, false)(600);
    assert.equal(layerEntries.filter(entry => entry.video.hasAttribute('src')).length, 95);
});
