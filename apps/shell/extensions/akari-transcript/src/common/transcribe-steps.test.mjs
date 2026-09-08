import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceTranscribeSteps, startTranscribeSteps, completedColumns, initialEngineSelection } from '../../lib/common/transcribe-steps.js';
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
