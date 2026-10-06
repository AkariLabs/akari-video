import assert from 'node:assert/strict';
import test from 'node:test';
import { audioSections, audioSnapshot } from './helpers/audio-clip-fx-fixture.mjs';
import { isAudioFadeShapeWriteRequest } from '../lib/browser/inspector/audio-fade-shape-write.js';

test('inspector shape request guard keeps the vocabulary closed', () => {
  const request = { kind: 'audio-fade-shape', id: 'clip', audioKind: 'sfx', edge: 'out', value: 'slow' };
  assert.equal(isAudioFadeShapeWriteRequest(request), true);
  assert.equal(isAudioFadeShapeWriteRequest({ ...request, value: 'unknown' }), false);
});

for (const audioKind of ['bgm', 'sfx']) {
  test(`${audioKind} inspector places shape selects next to fade durations`, async () => {
    let written;
    const sections = audioSections(audioSnapshot(audioKind, { fadeInShape: 'slow' }),
      async request => { written = request; return { ok: true }; });
    const fields = sections.find(section => section.id === 'audio:fades').fields;
    const names = fields.map(field => field.name);
    assert.equal(names.indexOf('audio-fade-in-shape'), names.indexOf('audio-fade-in') + 1);
    assert.equal(names.indexOf('audio-fade-out-shape'), names.indexOf('audio-fade-out') + 1);
    const shape = fields.find(field => field.name === 'audio-fade-in-shape');
    assert.equal(shape.getValue(), 'slow');
    assert.deepEqual(shape.options, ['linear', 'equal_power', 's_curve', 'slow']);
    assert.deepEqual(await shape.write(undefined, 'equal_power'), { ok: true });
    assert.deepEqual(written, { kind: 'audio-fade-shape', id: audioKind === 'bgm' ? 'bgm' : 'clip',
      audioKind, edge: 'in', value: 'equal_power' });
  });
}
