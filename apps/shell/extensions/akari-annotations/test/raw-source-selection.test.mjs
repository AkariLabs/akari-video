import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRawSourceId } from '../lib/common/raw-source-selection.js';

const edit = {
    version: 1,
    sources: [
        { id: 'camera-a', path: 'media/camera-a.mp4', proxy: null },
        { id: 'final-render', path: 'exports/render.mp4', proxy: null },
        { id: 'voice-over', path: 'audio/voice-over.wav', proxy: null },
        { id: 'music-bed', path: 'audio/music.m4a', proxy: null }
    ]
};

test('raw preview の URI を project-relative sources[].path から id へ逆引きする', () => {
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/exports/render.mp4'),
        'final-render'
    );
});

test('音声ファイルの URI も拡張子に依存せず sources[].id へ逆引きする', () => {
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/audio/voice-over.wav'),
        'voice-over'
    );
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/audio/music.m4a'),
        'music-bed'
    );
});

test('sources[] に一致しない raw preview は通常注釈へフォールバックできるよう未解決にする', () => {
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/exports/other.mp4'),
        undefined
    );
    assert.equal(resolveRawSourceId({ version: 0 }, 'file:///tmp/akari-project', 'file:///tmp/a.mp4'), undefined);
});
