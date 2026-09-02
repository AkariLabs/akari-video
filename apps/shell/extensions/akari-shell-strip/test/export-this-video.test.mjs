import test from 'node:test';
import assert from 'node:assert/strict';
import { describeThisVideo } from '../lib/common/export-this-video.js';

const cuts = [{ src: 'a.mp4', in: 0, out: 3 }, { src: 'b.mp4', in: 1, out: 5 }];

test('describeThisVideo: 横長の寸法・尺・構成を読む', () => {
    assert.deepEqual(describeThisVideo(
        { output: { width: 1920, height: 1080, fps: 30 }, cuts },
        { captions: [{ id: 'c1' }] }
    ), {
        orientation: 'landscape', width: 1920, height: 1080, fps: 30,
        durationSeconds: 7, cutCount: 2, captionCount: 1
    });
});

test('describeThisVideo: 縦長と正方形を判別する', () => {
    assert.equal(describeThisVideo({ output: { width: 1080, height: 1920 } }).orientation, 'portrait');
    assert.equal(describeThisVideo({ output: { width: 1080, height: 1080 } }).orientation, 'square');
});

test('describeThisVideo: v2 tracks/items から尺と media カット数を読む', () => {
    const edit = {
        version: 2,
        output: { width: 1920, height: 1080, fps: 30 },
        sources: [
            { id: 'srcA', path: 'media/srcA.mp4', proxy: null },
            { id: 'srcB', path: 'media/srcB.mp4', proxy: null }
        ],
        tracks: [
            {
                id: 'main-video', lane: 'visual', items: [
                    { id: 'cut-1', at: 0, duration: 450, source: { kind: 'media', src: 'srcA', in: 0, out: 15 } },
                    { id: 'cut-2', at: 450, duration: 300, source: { kind: 'media', src: 'srcB', in: 0, out: 10 } },
                    { id: 'cut-3', at: 750, duration: 450, source: { kind: 'media', src: 'srcA', in: 17, out: 32 } }
                ]
            },
            {
                id: 'caption-track', lane: 'visual', items: [
                    {
                        id: 'captions', name: '字幕', at: 0, duration: 1200,
                        source: { kind: 'captions', path: 'captions.json' }, items: []
                    }
                ]
            }
        ]
    };
    assert.deepEqual(describeThisVideo(edit), {
        orientation: 'landscape', width: 1920, height: 1080, fps: 30,
        durationSeconds: 40, cutCount: 3
    });
});

test('describeThisVideo: 欠損した JSON を例外にせず undefined で返す', () => {
    assert.deepEqual(describeThisVideo(undefined), {
        orientation: 'landscape', width: undefined, height: undefined, fps: undefined
    });
});
