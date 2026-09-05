import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
    PREVIEW_AUDIO_DECODED_BYTES_THRESHOLD,
    isPreviewAudioHeavy,
    resolveRegularSidecarPlan,
    resolveSpeechSidecarFormat
} from '../lib/common/preview-audio-eligibility.js';
import { prepareFrameEngineAudioSummary } from '../../../../../packages/preview-server/src/preview-audio-summary.mjs';

const boundary = 64 * 1024 * 1024 / (48000 * 2 * 4);

test('regular sidecars use decoded size, clip FX and the strict 64 MiB boundary', () => {
    assert.equal(PREVIEW_AUDIO_DECODED_BYTES_THRESHOLD, 64 * 1024 * 1024);
    assert.deepEqual(resolveRegularSidecarPlan({ inSec: 0, outSec: 5310, hasClipFx: false }), {
        request: true, format: 'pcm-s16le'
    });
    assert.deepEqual(resolveRegularSidecarPlan({ inSec: 0, outSec: 3, hasClipFx: false }), { request: false });
    assert.deepEqual(resolveRegularSidecarPlan({ inSec: 0, outSec: 20, hasClipFx: true }), {
        request: true, format: 'flac'
    });
    assert.equal(isPreviewAudioHeavy(boundary), false);
    assert.equal(isPreviewAudioHeavy(boundary + 1 / 48000), true);
    assert.deepEqual(resolveRegularSidecarPlan({ inSec: 3, hasClipFx: false }), {
        request: true, format: 'pcm-s16le', decodedBytesThreshold: 64 * 1024 * 1024
    });
});

test('speech format includes both pads and defaults omitted pads to zero', () => {
    assert.equal(resolveSpeechSidecarFormat({ inSec: 10, outSec: 30 }), 'flac');
    assert.equal(resolveSpeechSidecarFormat({ inSec: 0, outSec: boundary }), 'flac');
    for (const pad of ['padBeforeSec', 'padAfterSec']) {
        assert.equal(resolveSpeechSidecarFormat({ inSec: 0, outSec: boundary, [pad]: 1 / 48000 }), 'pcm-s16le');
    }
});

function serverSummary(readData) {
    const calls = [];
    const summary = prepareFrameEngineAudioSummary(readData, {
        projectRoot: fileURLToPath(new URL('.', import.meta.url)),
        cacheDir: fileURLToPath(new URL('./cache/', import.meta.url)),
        ffmpeg: 'ffmpeg', sourcePathOf: value => value,
        requestSidecar: options => {
            calls.push(options);
            return { state: 'queued', key: 'k' };
        }
    });
    return { calls, summary };
}

for (const kind of ['bgm', 'sfx', 'narration']) {
    for (const [label, inSec, outSec, hasClipFx] of [
        ['heavy m4a', 0, 5310, false],
        ['light mp3', 0, 3, false],
        ['short FX', 5, 25, true],
        ['no out', 5, undefined, false],
        ['no out with FX', 5, undefined, true],
        ['exact threshold', 0, boundary, false],
        ['one sample over', 0, boundary + 1 / 48000, false],
        ['trimmed light', 5307, 5310, false]
    ]) {
        test(`${kind} ${label}: shell plan matches preview-server requests`, () => {
            const raw = {
                id: 'audio', path: label.includes('mp3') ? 'audio.mp3' : 'audio.m4a', in: inSec,
                ...(outSec !== undefined ? { out: outSec } : {}),
                ...(hasClipFx ? { lowcut_hz: 100 } : {})
            };
            const { calls } = serverSummary({ audio: { [kind]: kind === 'bgm' ? raw : [raw] } });
            const plan = resolveRegularSidecarPlan({ inSec, outSec, hasClipFx });
            assert.equal(calls.length, plan.request ? 1 : 0);
            if (plan.request) {
                assert.equal(calls[0].format, plan.format);
                assert.equal(calls[0].decodedBytesThreshold, plan.decodedBytesThreshold);
                assert.equal('decodedBytesThreshold' in calls[0], 'decodedBytesThreshold' in plan);
            }
        });
    }
}

for (const [label, outSec] of [['heavy', 1440], ['light', 20], ['boundary', boundary], ['over', boundary + 1 / 48000]]) {
    test(`speech ${label}: shell format matches preview-server projected cuts`, () => {
        const { calls, summary } = serverSummary({
            output: { fps: 30 }, sources: [{ id: 'camera', path: 'camera.mp4' }],
            cuts: [{ id: 'speech', src: 'camera', in: 0, out: outSec }]
        });
        assert.equal(calls.length, 1);
        assert.equal(summary.audio.speech.length, 1);
        assert.equal(calls[0].format, resolveSpeechSidecarFormat(summary.audio.speech[0]));
        assert.equal('decodedBytesThreshold' in calls[0], false);
    });
}
