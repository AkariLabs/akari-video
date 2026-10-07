import assert from 'node:assert/strict';
import test from 'node:test';
import { parseProbedVideoDimensions } from '../lib/node/hevc-proxy.js';

test('ffprobe dimensions follow side data and tag rotation', () => {
    const stream = { width: 1920, height: 1080 };
    for (const rotation of [90, -270, 450]) {
        assert.deepEqual(parseProbedVideoDimensions({ streams: [{ ...stream,
            side_data_list: [{ rotation }] }] }), { width: 1080, height: 1920 });
    }
    for (const rotation of ['-90', '270']) {
        assert.deepEqual(parseProbedVideoDimensions(JSON.stringify({ streams: [{ ...stream,
            tags: { rotate: rotation } }] })), { width: 1080, height: 1920 });
    }
    assert.deepEqual(parseProbedVideoDimensions({ streams: [{ ...stream,
        side_data_list: [{ rotation: 180 }], tags: { rotate: '90' } }] }), stream);
    assert.deepEqual(parseProbedVideoDimensions({ streams: [stream] }), stream);
    assert.equal(parseProbedVideoDimensions('{bad json'), undefined);
    assert.equal(parseProbedVideoDimensions({ streams: [{ width: 0, height: 1080 }] }), undefined);
});
