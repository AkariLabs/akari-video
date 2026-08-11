import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRawSourceId } from '../lib/common/raw-source-selection.js';

const edit = {
    version: 1,
    sources: [
        { id: 'camera-a', path: 'media/camera-a.mp4', proxy: null },
        { id: 'final-render', path: 'exports/render.mp4', proxy: null }
    ]
};

test('raw preview の URI を project-relative sources[].path から id へ逆引きする', () => {
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/exports/render.mp4'),
        'final-render'
    );
});

test('sources[] に一致しない raw preview は通常注釈へフォールバックできるよう未解決にする', () => {
    assert.equal(
        resolveRawSourceId(edit, 'file:///tmp/akari-project', 'file:///tmp/akari-project/exports/other.mp4'),
        undefined
    );
    assert.equal(resolveRawSourceId({ version: 0 }, 'file:///tmp/akari-project', 'file:///tmp/a.mp4'), undefined);
});
