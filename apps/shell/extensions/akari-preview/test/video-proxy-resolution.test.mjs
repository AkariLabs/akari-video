import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreferredVideoUri } from '../lib/common/video-proxy-resolution.js';

const sources = [
    { uri: 'file:///project/main.mov', proxyUri: 'file:///project/main.webm' },
    { uri: 'file:///project/pip.mov', proxyUri: 'file:///project/pip.webm' }
];

test('the explicit proxy belonging to the exact source wins for non-primary and v2 media sources', () => {
    assert.equal(
        resolvePreferredVideoUri('file:///project/pip.mov', sources, 'file:///cache/generated.webm'),
        'file:///project/pip.webm'
    );
});

test('a different source proxy never leaks onto the requested source', () => {
    assert.equal(
        resolvePreferredVideoUri(
            'file:///project/unlisted.mov',
            sources,
            'file:///cache/generated.webm'
        ),
        'file:///cache/generated.webm'
    );
});

test('generated fallback is second priority and the original URI is the final fallback', () => {
    assert.equal(
        resolvePreferredVideoUri('file:///project/plain.mov', [], 'file:///cache/plain.mp4'),
        'file:///cache/plain.mp4'
    );
    assert.equal(
        resolvePreferredVideoUri('file:///project/plain.mp4', []),
        'file:///project/plain.mp4'
    );
});
