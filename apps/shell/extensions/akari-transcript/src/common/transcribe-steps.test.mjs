import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTranscribeSteps, startTranscribeSteps, completedColumns, initialEngineSelection, transcribeSummary, transcribeExitOptions } from '../../lib/common/transcribe-steps.js';
const event = (backend, stage, status) => ({ backend, stage, status });
test('columns fill in completion order, not selection order', () => {
    let state = startTranscribeSteps(['speech-analyzer', 'whisper-cpp']);
    state = advanceTranscribeSteps(state, event('whisper-cpp', 'completed', 'completed'));
    assert.deepEqual(completedColumns(state, [{ backend: 'speech-analyzer' }, { backend: 'whisper-cpp' }]), [{ backend: 'whisper-cpp' }]);
    state = advanceTranscribeSteps(state, event('speech-analyzer', 'completed', 'completed'));
    assert.deepEqual(state.completedOrder, ['whisper-cpp', 'speech-analyzer']);
});
test('diff completion switches automatically; running or failed diff does not', () => {
    const state = startTranscribeSteps(['whisper-cpp', 'speech-analyzer']);
    assert.equal(advanceTranscribeSteps(state, event(undefined, 'diffing', 'running')).step, 2);
    assert.equal(advanceTranscribeSteps(state, event(undefined, 'diffing', 'failed')).step, 2);
    assert.equal(advanceTranscribeSteps(state, event(undefined, 'diffing', 'completed')).step, 3);
});
test('late start and duplicate completion never regress or duplicate columns', () => {
    let state = startTranscribeSteps(['cloud:scribe']);
    state = advanceTranscribeSteps(state, event('cloud:scribe', 'completed', 'completed'));
    state = advanceTranscribeSteps(state, event('cloud:scribe', 'transcribing', 'running'));
    state = advanceTranscribeSteps(state, event('cloud:scribe', 'completed', 'completed'));
    assert.equal(state.engines['cloud-scribe'], 'completed'); assert.deepEqual(state.completedOrder, ['cloud-scribe']);
});
test('overall failure finishes without hiding successful columns', () => {
    let state = startTranscribeSteps(['whisper-cpp', 'speech-analyzer']);
    state = advanceTranscribeSteps(state, event('whisper-cpp', 'completed', 'completed'));
    state = advanceTranscribeSteps(state, event('speech-analyzer', 'failed', 'failed'));
    state = advanceTranscribeSteps(state, event(undefined, 'completed', 'failed'));
    assert.equal(state.finished, true); assert.deepEqual(state.completedOrder, ['whisper-cpp']);
});
test('session selection copies preferences', () => {
    const preferences = ['whisper-cpp']; const selection = initialEngineSelection('auto', preferences);
    selection.compareSet.push('speech-analyzer'); assert.deepEqual(preferences, ['whisper-cpp']);
});

test('summary reports each recorded timestamp, engine and line count and the saved comparison group', () => {
    const artifacts = {
        transcripts: [
            { backend: 'whisper-cpp', generated_at: '2026-09-08T01:02:03Z', segments: [{ text: '一行目' }, { text: '二行目' }] },
            { backend: 'cloud-scribe', generated_at: '2026-09-08T01:03:04Z', segments: [] }
        ],
        diff: { engines: ['whisper-cpp', 'cloud-scribe'] }
    };
    const before = structuredClone(artifacts);
    assert.deepEqual(transcribeSummary(artifacts), [
        '2026-09-08T01:02:03Z · whisper-cpp · 2 行',
        '2026-09-08T01:03:04Z · cloud-scribe · 0 行',
        '比べる組: whisper-cpp / cloud-scribe'
    ]);
    assert.deepEqual(artifacts, before);
});

test('summary handles unprocessed, legacy completed, unrecorded timestamps and diff-only artifacts', () => {
    const empty = { transcripts: [], diff: null };
    assert.deepEqual(transcribeSummary(empty), []);
    assert.deepEqual(transcribeSummary(empty, true), ['文字起こし済み · 日時・エンジン・行数の記録なし', '比べる組: なし']);
    assert.deepEqual(transcribeSummary({ transcripts: [{ backend: 'speech-analyzer', segments: [] }], diff: null }),
        ['日時不明 · speech-analyzer · 0 行', '比べる組: なし']);
    assert.deepEqual(transcribeSummary({ transcripts: [], diff: { engines: ['a', 'b'] } }), ['比べる組: a / b']);
});

test('reuse does not request transcription even when comparison preferences are set', () => {
    assert.deepEqual(transcribeExitOptions('reuse', {
        backend: 'cloud:scribe', compareSet: ['whisper-cpp', 'cloud:scribe'], approved: true
    }), { transcribeFirst: false });
});

test('redo uses only the selected card, ignoring comparison checks', () => {
    assert.deepEqual(transcribeExitOptions('redo', {
        backend: 'whisper-cpp', compareSet: ['cloud:scribe', 'cloud:groq'], autoCuts: false, approved: false
    }), { backend: 'whisper-cpp', compareSet: [], autoCuts: false, approved: false, transcribeFirst: true });
    assert.deepEqual(transcribeExitOptions('redo', {}), { backend: 'auto', compareSet: [], transcribeFirst: true });
});

test('compare returns a copied checked group for simultaneous transcription, preserving its baseline order', () => {
    const selection = { backend: 'speech-analyzer', compareSet: ['cloud:scribe', 'whisper-cpp', 'cloud:scribe'], approved: true };
    const result = transcribeExitOptions('compare', selection);
    assert.deepEqual(result, {
        backend: 'speech-analyzer', compareSet: ['cloud:scribe', 'whisper-cpp'], approved: true, transcribeFirst: true
    });
    result.compareSet.push('cloud:groq');
    assert.deepEqual(selection.compareSet, ['cloud:scribe', 'whisper-cpp', 'cloud:scribe']);
});

test('compare needs at least two distinct checked engines and never falls back to the selected card', () => {
    for (const compareSet of [undefined, [], ['whisper-cpp'], ['whisper-cpp', 'whisper-cpp']]) {
        assert.equal(transcribeExitOptions('compare', { backend: 'speech-analyzer', compareSet }), undefined);
    }
});

import { transcribeEngineAvailability } from '../../lib/common/transcribe-steps.js';
test('engine badges distinguish ready, missing model/CLT, missing key and unsupported OS', () => {
    assert.deepEqual(transcribeEngineAvailability('whisper-cpp', [{ id: 'whisper', available: true }], []),
        { state: 'available', label: '使える', needs: [] });
    assert.deepEqual(transcribeEngineAvailability('whisper-cpp', [{ id: 'whisper', available: false, executable: '/bin/whisper', model: { available: false } }], []),
        { state: 'needs', label: '準備が要る（モデルが無い）', needs: ['モデルが無い'] });
    assert.deepEqual(transcribeEngineAvailability('speech-analyzer', [{ id: 'speech-analyzer', available: false, needs: ['Command Line Tools が無い'] }], []),
        { state: 'needs', label: '準備が要る（Command Line Tools が無い）', needs: ['Command Line Tools が無い'] });
    assert.deepEqual(transcribeEngineAvailability('speech-analyzer', [{ id: 'speech-analyzer', available: false, unsupported: true }], []),
        { state: 'unsupported', label: 'この OS では使えない', needs: [] });
    for (const id of ['scribe', 'groq']) {
        const providerId = id === 'scribe' ? 'elevenlabs' : id;
        assert.deepEqual(transcribeEngineAvailability(`cloud:${id}`, [], [{ id: providerId, configured: false, doctor: { status: 'unconfigured', detail: '' } }]),
            { state: 'unconfigured', label: '鍵が未登録', needs: [] });
        assert.equal(transcribeEngineAvailability(`cloud:${id}`, [], [{ id: providerId, configured: true, doctor: { status: 'ok', detail: '' } }]).state, 'available');
        for (const status of ['unchecked', 'unauthorized', 'setup_required']) {
            assert.equal(transcribeEngineAvailability(`cloud:${id}`, [], [{ id: providerId, configured: true, doctor: { status, detail: '' } }]).state, 'needs');
        }
    }
});
test('missing status is never treated as a ready engine or an unregistered key', () => {
    for (const id of ['speech-analyzer', 'whisper-cpp', 'cloud:scribe', 'cloud:groq']) {
        assert.equal(transcribeEngineAvailability(id, [], []).state, 'needs');
    }
});
