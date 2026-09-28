import assert from 'node:assert/strict';
import test from 'node:test';
import {
    planRawPreviewAudioSidecar,
    rawPreviewProjectRootCandidates,
    selectRawPreviewProjectRoot
} from '../lib/common/raw-preview-audio.js';

test('raw sidecar is requested only for a video with confirmed embedded audio', () => {
    const base = {
        kind: 'raw', hasSourceAudio: true,
        sourceUri: 'file:///project/assets/generated/candidates/frame-7/clip.mp4',
        projectRootUri: 'file:///project'
    };
    assert.deepEqual(planRawPreviewAudioSidecar(base), {
        sourceUri: base.sourceUri, projectRootUri: base.projectRootUri,
        inSec: 0, speed: 1, padBeforeSec: 0, padAfterSec: 0, format: 'flac'
    });
    assert.equal(planRawPreviewAudioSidecar({ ...base, kind: 'output' }), undefined);
    assert.equal(planRawPreviewAudioSidecar({ ...base, hasSourceAudio: false }), undefined);
    assert.equal(planRawPreviewAudioSidecar({ ...base, hasSourceAudio: undefined }), undefined);
    assert.equal(planRawPreviewAudioSidecar({ ...base, projectRootUri: undefined }), undefined);
    assert.equal(planRawPreviewAudioSidecar({ ...base, sourceUri: 'https://example.com/clip.mp4' }), undefined);
});

test('project root candidates ascend from the media and stop at the deepest workspace', () => {
    const source = 'file:///projects/job/assets/generated/candidates/frame-7/clip.mp4';
    const candidates = rawPreviewProjectRootCandidates(source, [
        'file:///projects', 'file:///projects/job', 'file:///projects/job-other'
    ]);
    assert.deepEqual(candidates, [
        'file:///projects/job/assets/generated/candidates/frame-7',
        'file:///projects/job/assets/generated/candidates',
        'file:///projects/job/assets/generated',
        'file:///projects/job/assets',
        'file:///projects/job'
    ]);
    assert.equal(selectRawPreviewProjectRoot(candidates, new Set([
        'file:///projects/job', 'file:///projects/job/assets'
    ])), 'file:///projects/job/assets');
    assert.equal(selectRawPreviewProjectRoot(candidates, new Set()), 'file:///projects/job');
});

test('root selection rejects sibling and non-file URIs', () => {
    assert.deepEqual(rawPreviewProjectRootCandidates(
        'file:///projects/job-other/clip.mp4', ['file:///projects/job']
    ), []);
    assert.deepEqual(rawPreviewProjectRootCandidates(
        'https://example.com/clip.mp4', ['file:///projects/job']
    ), []);
    assert.deepEqual(rawPreviewProjectRootCandidates(
        'file://server-a/share/clip.mp4', ['file://server-b/share']
    ), []);
    assert.equal(selectRawPreviewProjectRoot([], new Set()), undefined);
});
