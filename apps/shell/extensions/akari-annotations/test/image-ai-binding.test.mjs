import test from 'node:test';
import assert from 'node:assert/strict';
import { imageAiEditVersion, imageAiBindingMatches } from '../lib/common/image-ai-binding.js';

const fixture = () => ({
    version: 2,
    output: { fps: 30 },
    sources: [
        { id: 'source-1', path: 'assets/still/one.png' },
        { id: 'source-2', path: 'assets/still/two.png' }
    ],
    tracks: [{ id: 'visual', lane: 'visual', items: [
        { id: 'item-1', at: 0, duration: 90, source: { kind: 'media', src: 'source-1', in: 0, out: 3 } },
        { id: 'item-2', at: 90, duration: 90, source: { kind: 'media', src: 'source-2', in: 0, out: 3 } }
    ] }]
});

test('version ignores other clips and unrelated document fields', () => {
    const original = fixture();
    const changed = structuredClone(original);
    changed.tracks[0].items[1].at = 120;
    changed.sources[1].path = 'assets/still/other.png';
    changed.output.fps = 24;
    assert.equal(imageAiEditVersion(changed, 'item-1'), imageAiEditVersion(original, 'item-1'));
    const binding = { itemId: 'item-1', sourcePath: original.sources[0].path,
        inputSha256: 'input-hash', editVersion: imageAiEditVersion(original, 'item-1') };
    assert.equal(imageAiBindingMatches(changed, binding, 'input-hash'), true);
});

test('version rejects changes to the selected item or referenced source', () => {
    const original = fixture();
    const binding = { itemId: 'item-1', sourcePath: original.sources[0].path,
        inputSha256: 'input-hash', editVersion: imageAiEditVersion(original, 'item-1') };
    const sourceChanged = structuredClone(original);
    sourceChanged.sources[0].path = 'assets/still/replaced.png';
    assert.equal(imageAiBindingMatches(sourceChanged, binding, 'input-hash'), false);
    const itemChanged = structuredClone(original);
    itemChanged.tracks[0].items[0].source.src = 'source-2';
    assert.equal(imageAiBindingMatches(itemChanged, binding, 'input-hash'), false);
    const deleted = structuredClone(original);
    deleted.tracks[0].items.shift();
    assert.equal(imageAiBindingMatches(deleted, binding, 'input-hash'), false);
    assert.equal(imageAiBindingMatches(original, binding, 'different-hash'), false);
});
