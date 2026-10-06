import test from 'node:test';
import assert from 'node:assert/strict';
import {
    analysisTranscriptSummary, popupCanNavigate, popupInitialSourceIds,
    transcribeEngineAvailability, transcribeSummary
} from '../../lib/common/transcribe-steps.js';

const sources = [
    { id: 'image', path: 'assets/title.png', status: 'excluded' },
    { id: 'camera', path: 'assets/camera.mp4', status: 'voice' },
    { id: 'mic', path: 'assets/mic.wav', status: 'voice' },
    { id: 'bgm', path: 'assets/music.mp3', status: 'bgm' }
];

test('popup selects a requested source, including BGM, but never an excluded source', () => {
    assert.deepEqual(popupInitialSourceIds(sources, 'assets/mic.wav', []), ['mic']);
    assert.deepEqual(popupInitialSourceIds(sources, 'assets/music.mp3', []), ['bgm']);
    assert.deepEqual(popupInitialSourceIds(sources, 'assets/title.png', []), []);
});

test('popup defaults to transcript sources or first voice source', () => {
    assert.deepEqual(popupInitialSourceIds(sources, undefined, ['mic', 'camera']), ['camera', 'mic']);
    assert.deepEqual(popupInitialSourceIds(sources, undefined, []), ['camera']);
    assert.deepEqual(popupInitialSourceIds(sources, undefined, ['bgm']), ['camera']);
});

test('popup navigation cannot skip a step or go back to selection while running', () => {
    assert.equal(popupCanNavigate(1, 0, false), false);
    assert.equal(popupCanNavigate(0, 1, false), true);
    assert.equal(popupCanNavigate(1, 2, true), false);
    assert.equal(popupCanNavigate(2, 2, true), true);
    assert.equal(popupCanNavigate(3, 2, false), false);
    assert.equal(popupCanNavigate(3, 3, false), true);
});

test('engine badges distinguish ready, missing model, missing key and unsupported OS', () => {
    assert.equal(transcribeEngineAvailability('whisper-cpp', [{ id: 'whisper', available: true }], []).state, 'available');
    assert.equal(transcribeEngineAvailability('whisper-cpp', [{ id: 'whisper', available: false,
        executable: '/bin/whisper', model: { available: false } }], []).label, '準備が要る（モデルが無い）');
    assert.equal(transcribeEngineAvailability('speech-analyzer', [{ id: 'speech-analyzer', available: false,
        unsupported: true }], []).state, 'unsupported');
    assert.equal(transcribeEngineAvailability('cloud:scribe', [], [{ id: 'elevenlabs', configured: false,
        doctor: { status: 'unconfigured', detail: '' } }]).label, '鍵が未登録');
});

test('analysis summary keeps the most recent transcript provenance', () => {
    assert.equal(analysisTranscriptSummary({ transcript: [{ text: '一行目' }], observations: [
        { kind: 'transcribe', at: 'earlier', args: { backend: 'old' } },
        { kind: 'transcribe', at: 'later', args: { backend: 'whisper-cpp' } }
    ] }), 'later · whisper-cpp · 1 行');
    assert.deepEqual(transcribeSummary({ transcripts: [], diff: null }, true), [
        '文字起こし済み · 日時・エンジン・行数の記録なし', '比べる組: なし'
    ]);
});
