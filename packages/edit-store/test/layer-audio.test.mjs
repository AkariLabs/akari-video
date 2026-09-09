import assert from 'node:assert/strict';
import test from 'node:test';
import { projectLayerSpeechDeclarations, projectSpeechDeclarations, buildWebAudioSchedule,
  isLayerAudioAudible, readInternalEdit, projectLegacyEdit, attachEditHelpers, updateItem } from '../lib/index.js';
import { unsplitFixture } from './helpers/cut-audio-supply.mjs';
const layer = (extra = {}) => ({ id: 'pip', kind: 'video', src: 'pip.mov', t: 1, duration: 4, in: 2, ...extra });
const project = layers => projectLayerSpeechDeclarations(layers, { fps: 30 });
test('overlapping layers retain both speech streams, trim, gain and track ownership', () => {
  const layers = [layer({ track: 0, gain_db: -6 }), layer({ id: 'top', track: 1, speed: 2 })];
  const before = JSON.stringify(layers), speech = project(layers);
  assert.deepEqual(speech.map(s => [s.id, s.atSec, s.durationSec, s.inSec, s.outSec, s.gainDb, s.scope]), [
    ['layer-pip-speech', 1, 4, 2, 6, -6, 'layers'], ['layer-top-speech', 1, 4, 2, 10, 0, 'layers'],
  ]);
  const schedule = buildWebAudioSchedule({ timelineDurationSec: 5, startAtSec: 2, audio: { speech } });
  assert.deepEqual(schedule.items.map(i => [i.kind, i.sourceOffsetSec, i.track]), [['speech', 3, 0], ['speech', 4, 1]]);
  assert.equal(JSON.stringify(layers), before);
});
test('audio false, item mute, non-video and still layers supply no speech; hidden pixels keep audio', () => {
  for (const patch of [{ audio: false }, { mute: true }, { kind: 'baked' }, { kind: 'filter' },
    { src: 'still.png' }, { isImage: true }]) assert.deepEqual(project([layer(patch)]), []);
  assert.equal(isLayerAudioAudible(layer(), { muted: true }), false);
  assert.equal(project([layer({ opacity: 0, hidden: true })]).length, 1);
});
test('freeze and transitions reuse the unchanged cut projection', () => {
  const layers = [layer({ freeze: { at_sec: 1, duration_sec: 2 }, track: 0 }),
    layer({ id: 'next', t: 5, duration: 2, track: 0 })];
  const cutProjection = projectSpeechDeclarations(layers.map(l => ({ ...l, id: `layer-${l.id}`,
    at: l.t, in: l.in, out: l.in + l.duration - (l.freeze?.duration_sec ?? 0) })), { fps: 30 });
  assert.deepEqual(project(layers).map(({ scope, ...item }) => item), cutProjection);
  assert.deepEqual(project(layers).map(s => [s.atSec, s.durationSec]), [[1, 1], [4, 1], [5, 2]]);
  const transition = [layer({ t: 0, track: 0, transition_out: { type: 'crossfade', duration: 0.5 } }),
    layer({ id: 'next', t: 4, track: 0 })];
  const cuts = transition.map(l => ({ ...l, id: `layer-${l.id}`, at: l.t, out: l.in + l.duration }));
  assert.deepEqual(project(transition).map(({ scope, ...item }) => item), projectSpeechDeclarations(cuts, { fps: 30 }));
});
test('PiP projection and the existing item mutator preserve gain/mute/audio without changing routing', () => {
  const doc = unsplitFixture();
  const base = doc.tracks[0].items[0];
  doc.tracks = [doc.tracks[0], { id: 'upper', lane: 'visual', items: [
    { ...structuredClone(base), id: 'pip', transform: { scale: 0.5 } },
  ] }];
  const get = () => projectLegacyEdit(readInternalEdit(doc));
  assert.equal(get().layers.length, 1);
  assert.equal(project(get().layers).length, 1);
  attachEditHelpers(doc);
  updateItem(doc, 'pip', { source: { gain_db: -9, mute: true } });
  assert.equal(get().layers[0].gain_db, -9);
  assert.deepEqual(project(get().layers), []);
  updateItem(doc, 'pip', { source: { mute: false } });
  assert.equal(project(get().layers)[0].gainDb, -9);
  doc.tracks[1].muted = true;
  assert.deepEqual(project(get().layers), []);
  delete doc.tracks[1].muted;
  updateItem(doc, 'pip', { audio: false });
  assert.deepEqual(project(get().layers), []);
});


test('combined speech projection appends layer declarations without changing the cut bytes', () => {
  const cuts = [{ id: 'base', src: 'main', in: 0, out: 3 }];
  const original = projectSpeechDeclarations(cuts, { fps: 30 });
  assert.equal(JSON.stringify(projectSpeechDeclarations(cuts, { fps: 30, layers: [] })), JSON.stringify(original));
  const combined = projectSpeechDeclarations(cuts, { fps: 30, layers: [layer()] });
  assert.equal(JSON.stringify(combined.slice(0, original.length)), JSON.stringify(original));
  assert.deepEqual(combined.slice(original.length), project([layer()]));
});
