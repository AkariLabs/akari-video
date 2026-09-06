import assert from 'node:assert/strict';
import test from 'node:test';
import { readInternalEdit, projectLegacyEdit, projectLegacyAudioView, buildWebAudioSchedule } from '../../edit-store/lib/index.js';
import { splitFixture, baseline, plain, previewAdapter } from '../../edit-store/test/helpers/cut-audio-supply.mjs';
import { captureUnsplitBaseline } from '../../edit-store/test/helpers/cut-audio-baseline.mjs';
import { prepareFrameEngineAudioSummary, selectPreviewAudioItemsAt } from '../src/preview-audio-summary.mjs';

const choices = new Map([['main', { url: '/assets/main.mp4' }]]);
const project = doc => {
  const internal = readInternalEdit(doc);
  return { ...projectLegacyEdit(internal), output: doc.output, audio: projectLegacyAudioView(internal) };
};

test('preview summary, fallback URLs and schedule declarations match the unsplit baseline', () => {
  assert.deepEqual(captureUnsplitBaseline().preview, baseline().preview);
});

test('initial, update and fallback preserve independent speech and never restore embedded audio', () => {
  const doc = splitFixture();
  doc.tracks[0].muted = true;
  Object.assign(doc.tracks[1].items[0], { at: 60, duration: 30, lowcut_hz: 100 });
  Object.assign(doc.tracks[1].items[0].source, { in: 1, out: 2 });
  const edit = project(doc);
  const requests = [];
  const summary = prepareFrameEngineAudioSummary(edit, { projectRoot: '.', cacheDir: '.cache', ffmpeg: 'ffmpeg',
    sourcePathOf: value => value, requestSidecar: options => {
      requests.push(options); return { state: 'queued', key: 'voice-key' };
    } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].sourcePath, 'assets/main.mp4');
  assert.deepEqual([requests[0].inSec, requests[0].outSec], [1, 2]);
  assert.deepEqual(summary.audio.embeddedSpeech, []);
  assert.equal(summary.audio.speech.length, 1);
  assert.equal(summary.items[0].label, '本編音声（分離）');
  assert.equal(selectPreviewAudioItemsAt(summary.items, 2.5).length, 1);
  assert.equal(selectPreviewAudioItemsAt(summary.items, 0.5).length, 0);
  const client = previewAdapter();
  for (const audio of [edit.audio, summary.audio, { ...summary.audio,
    speech: summary.audio.speech.map(item => ({ ...item, sidecarState: 'unavailable' })) }]) {
    const data = { ...edit, audio };
    assert.equal(client.speechDeclarations(data, 30, choices).length, 0);
    const declarations = plain(client.audioDeclarations(data));
    assert.equal(declarations.length, 1);
    assert.equal(declarations[0].kind, 'narration');
    assert.equal(declarations[0].duckKey, true);
    assert.equal(declarations[0].spec.t, 2);
    assert.equal(declarations[0].spec.in, 1);
  }
  const stale = { ...edit, audio: { speech: [{ id: 'cut-0-speech', src: 'main' }] } };
  assert.deepEqual(plain(client.speechDeclarations(stale, 30, choices)), []);
  delete doc.tracks[1].items[0].link;
  assert.deepEqual(project(doc), edit);
});

test('preview mute is item OR audio track; muted speech requests neither sidecar nor ducking', () => {
  for (const muted of [false, true]) for (const mute of [false, true]) {
    const doc = splitFixture();
    doc.tracks[1].muted = muted;
    Object.assign(doc.tracks[1].items[0], { mute, lowcut_hz: 100 });
    const edit = project(doc);
    let requests = 0;
    const summary = prepareFrameEngineAudioSummary(edit, { projectRoot: '.', cacheDir: '.cache', ffmpeg: 'ffmpeg',
      sourcePathOf: value => value, requestSidecar: () => { requests++; return { state: 'queued' }; } });
    assert.equal(requests, muted || mute ? 0 : 1);
    const declarations = previewAdapter().audioDeclarations({ ...edit, audio: summary.audio });
    const plan = buildWebAudioSchedule({ timelineDurationSec: 3, startAtSec: 0, audio: {
      narration: declarations.map(item => ({ ...item.spec, durationSec: 3, duckKey: item.duckKey })),
    } });
    assert.equal(plan.items.length, muted || mute ? 0 : 1);
    assert.equal(plan.duckIntervals.length, muted || mute ? 0 : 1);
  }
});
