import assert from 'node:assert/strict';
import test from 'node:test';
import { topVisualTarget } from '../lib/browser/preview-material-placement.js';

test('最上段が空いていればそこへ、重なれば直上へ', () => {
    const tracks = [
        { id: 'v1', lane: 'visual', items: [] },
        { id: 'v2', lane: 'visual', items: [{ at: 30, duration: 150 }] },
        { id: 'a1', lane: 'audio', items: [] }
    ];
    assert.deepEqual(topVisualTarget(tracks, { at: 0, duration: 30 }), { targetTrackId: 'v2' });
    assert.deepEqual(topVisualTarget(tracks, { at: 30, duration: 150 }), { insertIndex: 2 });
    assert.deepEqual(topVisualTarget([], { at: 0, duration: 30 }), { insertIndex: 0 });
});

test('最上段が字幕と置いた文字でも、映像の直上かつ文字の下へ置く', () => {
    const tracks = [
        { id: 'v-base', lane: 'visual', items: [{ at: 0, duration: 150, source: { kind: 'media', src: 'base' } }] },
        { id: 't-placed', lane: 'visual', items: [{ at: 0, duration: 150, source: { kind: 'text', text: '文字' } }] },
        { id: 't-caption', lane: 'visual', items: [{ at: 0, duration: 150, source: { kind: 'caption', id: 'c-1' } }] },
        { id: 'v-captions', lane: 'visual', items: [{ at: 0, duration: 150, source: { kind: 'captions' } }] }
    ];
    assert.deepEqual(topVisualTarget(tracks, { at: 30, duration: 30 }), { insertIndex: 1 });
    assert.deepEqual(topVisualTarget(tracks, { at: 150, duration: 30 }), { targetTrackId: 'v-base' });
    assert.deepEqual(topVisualTarget(tracks.slice(1), { at: 30, duration: 30 }), { insertIndex: 3 });
});

test('captions.json の表示トラックは空でも映像候補にしない', () => {
    const tracks = [
        { id: 'v-base', lane: 'visual', items: [] },
        { id: 'v-captions', lane: 'visual', content: { from: 'captions.json' }, items: [] }
    ];
    assert.deepEqual(topVisualTarget(tracks, { at: 0, duration: 30 }), { targetTrackId: 'v-base' });
});
