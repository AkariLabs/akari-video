import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  canSplitCutAudio, splitCutAudio, unlinkCutAudio, linkedAudioItemIdOf,
  linkedCutIdOf, moveLinkedCutAudio, removeCutAudioLinked,
} from '../lib/cut-audio-split-ops.js';
import { readEditV2 } from '../lib/edit-v2.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { projectLegacyAudioView } from '../lib/legacy-audio-view.js';
import { serializeEdit } from '../lib/canonical.js';
import { evaluateEnvelopeDb } from '../lib/envelope.js';

const schema = JSON.parse(readFileSync(new URL('../../schemas/edit.schema.json', import.meta.url), 'utf8'));
const validateEditV2 = new Ajv2020({ strict: false, allErrors: true }).compile({
  ...schema, $ref: '#/$defs/editV2',
});

function fixture() {
  return {
    version: 2, output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'assets/talk.mp4' }, { id: 'music', path: 'assets/music.wav' }],
    audio: { duck_keys: ['speech', 'narration'] },
    tracks: [
      { id: 'a1', lane: 'audio', name: 'BGM', items: [
        { id: 'music', role: 'bgm', at: 0, duration: 180, gain_db: -18,
          source: { kind: 'media', src: 'music', in: 0, out: 6 } },
      ] },
      { id: 'v1', lane: 'visual', name: '本編', items: [
        { id: 'cut', at: 30, duration: 90, source: { kind: 'media', src: 'main', in: 2, out: 5 } },
        { id: 'second', at: 120, duration: 60, source: { kind: 'media', src: 'main', in: 5, out: 7 } },
      ] },
      { id: 'v2', lane: 'visual', items: [
        { id: 'title', at: 0, duration: 180, source: { kind: 'html', path: 'title.html' } },
      ] },
    ],
  };
}

const trackOf = (doc, id) => doc.tracks.find(track => track.id === id);
const itemOf = (doc, id) => doc.tracks.flatMap(track => track.items ?? []).find(item => item.id === id);
const split = doc => splitCutAudio(doc, { cutId: 'cut' });
function unchanged(doc, operation) {
  const before = JSON.stringify(doc);
  const result = operation();
  assert.equal(JSON.stringify(doc), before, 'input document bytes');
  return result;
}

test('1: eligibility reports all nine blockers with a Japanese single-line message', () => {
  const cases = [
    ['not-found', () => {}, 'missing'],
    ['not-visual-media', () => {}, 'title'],
    ['not-visual-media', () => {}, 'music'],
    ['nested', doc => { itemOf(doc, 'cut').items = []; }],
    ['nested', doc => {
      const track = trackOf(doc, 'v1');
      track.items = [{ id: 'group', at: 0, duration: 180, source: { kind: 'group' }, items: track.items }];
    }],
    ['anchored', doc => { itemOf(doc, 'cut').anchor = { caption: 'c1' }; }],
    ['speed', doc => { itemOf(doc, 'cut').source.speed = 2; }],
    ['freeze', doc => { itemOf(doc, 'cut').source.freeze = { at: 1, duration: 1 }; }],
    ['transition-crossfade', doc => { itemOf(doc, 'cut').source.transition_out = { type: 'crossfade', duration: 0.5 }; }],
    ['already-split', doc => { itemOf(doc, 'cut').audio = false; }],
    ['no-audio', () => {}, 'cut', { hasAudio: false }],
  ];
  for (const [blocker, change, id = 'cut', options] of cases) {
    const doc = fixture();
    change(doc);
    const result = unchanged(doc, () => canSplitCutAudio(doc, id, options));
    assert.equal(result.ok, false);
    assert.equal(result.blocker, blocker);
    assert.match(result.message, /[ぁ-んァ-ヶ一-龠]/u);
    assert.doesNotMatch(result.message, /[\r\n]/u);
    unchanged(doc, () => assert.throws(() => splitCutAudio(doc, { cutId: id, ...options }),
      error => error.message === result.message));
  }
  const doc = fixture();
  assert.deepEqual(canSplitCutAudio(doc, 'cut'), { ok: true });
  Object.assign(itemOf(doc, 'cut').source, { speed: 1, freeze: null, transition_out: null });
  assert.deepEqual(canSplitCutAudio(doc, 'cut', { hasAudio: true }), { ok: true });
});

test('2: split transfers source timing, gain and mute and allocates deterministic global item IDs', () => {
  const doc = fixture();
  Object.assign(itemOf(doc, 'cut').source, { speed: 1, gain_db: 0, mute: true });
  const result = unchanged(doc, () => split(doc));
  assert.equal(result.audioItemId, 'cut-audio');
  assert.equal(result.audioTrackId, 'a2');
  assert.deepEqual(itemOf(result.document, result.audioItemId), {
    id: 'cut-audio', role: 'speech', link: 'cut', at: 30, duration: 90,
    source: { kind: 'media', src: 'main', in: 2, out: 5 }, gain_db: 0, mute: true,
  });
  const cut = itemOf(result.document, 'cut');
  assert.equal(cut.audio, false);
  assert.equal('gain_db' in cut.source, false);
  assert.equal('mute' in cut.source, false);
  assert.equal(cut.source.speed, 1);
  trackOf(doc, 'v2').items.push({ id: 'group', at: 0, duration: 90, source: { kind: 'group' }, items: [
    { id: 'cut-audio', at: 0, duration: 90, source: { kind: 'html', path: 'title.html' } },
  ] });
  trackOf(doc, 'a1').items.push({ ...structuredClone(itemOf(doc, 'music')), id: 'cut-audio-2' });
  assert.equal(split(doc).audioItemId, 'cut-audio-3');
  assert.equal(split(doc).audioItemId, 'cut-audio-3');
  const defaults = itemOf(split(fixture()).document, 'cut-audio');
  assert.equal('gain_db' in defaults, false);
  assert.equal('mute' in defaults, false);
});

test('3: gain keyframes move with local times/easing while visual properties stay in place', () => {
  const doc = fixture();
  const points = [
    { t: 0, gain_db: -12, easing: 'linear' },
    { t: 30, gain_db: -3, transform: { x: 10 }, easing: { gain_db: 'in-quad', 'transform.x': 'linear' } },
    { t: 60, opacity: 0.5, crop: { x: 0, y: 0, w: 1, h: 1 } },
  ];
  itemOf(doc, 'cut').keyframes = points;
  const { document } = unchanged(doc, () => split(doc));
  assert.deepEqual(itemOf(document, 'cut-audio').keyframes, [points[0],
    { t: 30, gain_db: -3, easing: points[1].easing }]);
  assert.deepEqual(itemOf(document, 'cut').keyframes, [
    { t: 30, transform: { x: 10 }, easing: points[1].easing }, points[2],
  ]);
  itemOf(document, 'cut-audio').keyframes[1].easing.gain_db = 'hold';
  assert.equal(itemOf(document, 'cut').keyframes[0].easing.gain_db, 'in-quad');
  itemOf(doc, 'cut').keyframes = [{ t: 0, gain_db: -12 }, { t: 90, gain_db: 0 }];
  assert.equal('keyframes' in itemOf(split(doc).document, 'cut'), false);
});

test('4: receiver creation/reuse respects visual ownership and mute without commandeering BGM/SE', () => {
  for (const muted of [undefined, false, true]) {
    const doc = fixture();
    if (muted !== undefined) trackOf(doc, 'v1').muted = muted;
    doc.tracks.splice(1, 0, { id: 'a3', lane: 'audio', muted: true, items: [
      { id: 'effect', at: 0, duration: 30, source: { kind: 'media', src: 'music', in: 0, out: 1 } },
    ] });
    const first = split(doc);
    const receiver = trackOf(first.document, first.audioTrackId);
    assert.equal(first.createdTrack, true);
    assert.equal(receiver.name, '本編の音声');
    assert.equal(receiver.muted, muted === true ? true : undefined);
    assert.deepEqual(first.document.tracks.map(track => track.id), ['a1', 'a3', 'a2', 'v1', 'v2']);
    receiver.name = '変更された名前';
    const second = splitCutAudio(first.document, { cutId: 'second' });
    assert.equal(second.createdTrack, false);
    assert.equal(second.audioTrackId, first.audioTrackId);
    assert.equal(trackOf(second.document, first.audioTrackId).items.length, 2);
    assert.equal(JSON.stringify(trackOf(second.document, 'a1')), JSON.stringify(trackOf(doc, 'a1')));
    assert.equal(JSON.stringify(trackOf(second.document, 'a3')), JSON.stringify(trackOf(doc, 'a3')));
    receiver.muted = muted !== true;
    const changedMute = splitCutAudio(first.document, { cutId: 'second' });
    assert.equal(changedMute.createdTrack, true);
    assert.equal(trackOf(changedMute.document, first.audioTrackId).muted, muted !== true);
  }
  const doc = fixture();
  delete trackOf(doc, 'v1').name;
  const first = split(doc);
  assert.equal(trackOf(first.document, first.audioTrackId).name, 'V1の音声');
  const unrelated = structuredClone(itemOf(doc, 'second'));
  unrelated.id = 'other-cut';
  trackOf(first.document, 'v2').items.push(unrelated);
  assert.equal(splitCutAudio(first.document, { cutId: 'other-cut' }).createdTrack, true);
  const unlinked = unlinkCutAudio(first.document, { audioItemId: first.audioItemId });
  assert.equal(splitCutAudio(unlinked, { cutId: 'second' }).createdTrack, true);
  doc.tracks.unshift({ id: 'empty', lane: 'audio', items: [] });
  assert.notEqual(split(doc).audioTrackId, 'empty');
  assert.equal(split(doc).createdTrack, true);
});

test('5: split/unlink never mutate inputs and unlink removes only the link without enabling re-split', () => {
  const doc = fixture();
  Object.assign(itemOf(doc, 'cut').source, { gain_db: -6, mute: true });
  const { document, audioItemId } = unchanged(doc, () => split(doc));
  unchanged(document, () => assert.throws(() => split(document), /すでに分離/u));
  assert.equal(linkedAudioItemIdOf(document, 'cut'), audioItemId);
  assert.equal(linkedCutIdOf(document, audioItemId), 'cut');
  const unlinked = unchanged(document, () => unlinkCutAudio(document, { audioItemId }));
  const expected = structuredClone(document);
  delete itemOf(expected, audioItemId).link;
  assert.equal(JSON.stringify(unlinked), JSON.stringify(expected));
  assert.equal(linkedAudioItemIdOf(unlinked, 'cut'), undefined);
  assert.equal(linkedCutIdOf(unlinked, audioItemId), undefined);
  assert.equal(linkedCutIdOf(document, 'cut'), undefined);
  assert.equal(linkedCutIdOf(document, 'missing'), undefined);
  assert.equal(canSplitCutAudio(unlinked, 'cut').blocker, 'already-split');
  unchanged(unlinked, () => assert.throws(() => split(unlinked), /すでに分離/u));
  assert.deepEqual(unlinkCutAudio(unlinked, { audioItemId }), unlinked);
});

test('6: splitting changes only the chosen cut and receiver; unrelated JSON bytes/order are retained', () => {
  const doc = fixture();
  const beforeCanonical = serializeEdit(doc);
  const result = unchanged(doc, () => split(doc));
  const expected = structuredClone(doc);
  itemOf(expected, 'cut').audio = false;
  expected.tracks.splice(1, 0, trackOf(result.document, result.audioTrackId));
  assert.equal(JSON.stringify(result.document), JSON.stringify(expected));
  for (const field of ['sources', 'output', 'audio']) {
    assert.equal(JSON.stringify(result.document[field]), JSON.stringify(doc[field]));
  }
  for (const id of ['a1', 'v2']) {
    assert.equal(JSON.stringify(trackOf(result.document, id)), JSON.stringify(trackOf(doc, id)));
  }
  assert.equal(JSON.stringify(itemOf(result.document, 'second')), JSON.stringify(itemOf(doc, 'second')));
  assert.equal(serializeEdit(doc), beforeCanonical);
  const second = splitCutAudio(result.document, { cutId: 'second' });
  const reusedExpected = structuredClone(result.document);
  itemOf(reusedExpected, 'second').audio = false;
  trackOf(reusedExpected, result.audioTrackId).items.push(itemOf(second.document, second.audioItemId));
  assert.equal(JSON.stringify(second.document), JSON.stringify(reusedExpected));
});

test('7: linked moves preserve sync offsets/source/keyframes and reject invalid deltas atomically', () => {
  const { document } = split(fixture());
  const audio = itemOf(document, 'cut-audio');
  audio.at = 20;
  audio.source.in = 1.5;
  audio.keyframes = [{ t: 0, gain_db: -12 }, { t: 90, gain_db: 0 }];
  for (const deltaFrames of [15, -20, 0]) {
    const moved = unchanged(document, () => moveLinkedCutAudio(document, { cutId: 'cut', deltaFrames }));
    const expected = structuredClone(document);
    itemOf(expected, 'cut').at += deltaFrames;
    itemOf(expected, 'cut-audio').at += deltaFrames;
    assert.equal(JSON.stringify(moved), JSON.stringify(expected));
    assert.equal(itemOf(moved, 'cut').at - itemOf(moved, 'cut-audio').at, 10);
  }
  for (const deltaFrames of [-21, -31, 0.5, NaN, Infinity, -Infinity]) {
    unchanged(document, () => assert.throws(() => moveLinkedCutAudio(document, { cutId: 'cut', deltaFrames })));
  }
  audio.at = 50;
  unchanged(document, () => assert.throws(() => moveLinkedCutAudio(document, { cutId: 'cut', deltaFrames: -31 })));
});

test('8: all three removal routes work from either ID, retain empty tracks and avoid dangling links', () => {
  const { document, audioTrackId } = split(fixture());
  for (const target of ['pair', 'audio-only', 'cut-only']) {
    for (const selection of [{ cutId: 'cut' }, { audioItemId: 'cut-audio' }, { cutId: 'cut', audioItemId: 'cut-audio' }]) {
      const removed = unchanged(document, () => removeCutAudioLinked(document, { target, ...selection }));
      const expected = structuredClone(document);
      if (target !== 'audio-only') trackOf(expected, 'v1').items.shift();
      if (target !== 'cut-only') trackOf(expected, audioTrackId).items = [];
      else delete itemOf(expected, 'cut-audio').link;
      assert.equal(JSON.stringify(removed), JSON.stringify(expected));
      assert.deepEqual(removed.tracks.map(track => track.id), document.tracks.map(track => track.id));
      if (target === 'audio-only') assert.equal(itemOf(removed, 'cut').audio, false);
      assert.doesNotThrow(() => readInternalEdit(removed));
    }
  }
  unchanged(document, () => assert.throws(() => removeCutAudioLinked(document,
    { target: 'pair', cutId: 'second', audioItemId: 'cut-audio' })));
  unchanged(document, () => assert.throws(() => removeCutAudioLinked(document, { target: 'pair' })));
});

test('9: split documents pass the v2 schema/readers and project exactly one independent speech item', () => {
  const doc = fixture();
  itemOf(doc, 'cut').keyframes = [{ t: 0, gain_db: -12 }, { t: 90, gain_db: 0 }];
  const { document, audioItemId } = split(doc);
  assert.equal(validateEditV2(document), true, JSON.stringify(validateEditV2.errors));
  assert.doesNotThrow(() => readEditV2(document));
  const internal = readInternalEdit(document);
  const speech = projectLegacyAudioView(internal).speech;
  assert.equal(speech.length, 1);
  assert.equal(speech[0].id, audioItemId);
  assert.equal(speech[0].role, 'speech');
  assert.deepEqual(JSON.parse(serializeEdit(document)), document);
});

function assertValid(doc) {
  assert.equal(validateEditV2(doc), true, JSON.stringify(validateEditV2.errors));
  assert.doesNotThrow(() => readEditV2(doc));
  assert.doesNotThrow(() => readInternalEdit(doc));
}

test('10: singleton audio gain folds into the base gain with an equivalent constant envelope (A)', () => {
  for (const [baseGain, offset] of [[undefined, -12], [-6, -12], [6, -12], [-12, 12], [0, 0], [-48, -12], [6, 6]]) {
    for (const gainTime of [0, 30]) {
      const doc = fixture();
      const cut = itemOf(doc, 'cut');
      if (baseGain !== undefined) cut.source.gain_db = baseGain;
      cut.keyframes = [{ t: gainTime, gain_db: offset }, { t: 5, transform: { x: 1 } }];
      assertValid(doc);
      const { document, audioItemId } = unchanged(doc, () => split(doc));
      assertValid(document);
      const audio = itemOf(document, audioItemId);
      assert.equal(audio.gain_db, (baseGain ?? 0) + offset);
      assert.equal('keyframes' in audio, false);
      assert.equal('gain_db' in itemOf(document, 'cut').source, false);
      assert.deepEqual(itemOf(document, 'cut').keyframes, [
        { t: gainTime }, { t: 5, transform: { x: 1 } },
      ]);
      const envelope = [{ t: gainTime / doc.output.fps, gainDb: offset }];
      for (const frame of [0, 1, 5, 15, 30, 60, 89, 90]) {
        const beforeDb = (baseGain ?? 0) + evaluateEnvelopeDb(envelope, frame / doc.output.fps);
        const afterDb = audio.gain_db + evaluateEnvelopeDb([], frame / doc.output.fps);
        assert.equal(afterDb, beforeDb, `equivalent gain at frame ${frame}`);
      }
    }
  }
});

test('11: singleton visual retains inactive points and all visual property samples unchanged (B)', () => {
  for (const visual of [
    { transform: { x: 1 } },
    { crop: { x: 0.1, y: 0, w: 0.8, h: 1 } },
    { opacity: 0.5 },
    { perspective: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]] } },
    { animator: { title: { offset: 0.5 } } },
  ]) {
    for (const mixedPoint of [false, true]) {
      const doc = fixture();
      const points = [
        { t: 0, gain_db: -12 },
        { t: 5, gain_db: 0 },
        { t: 9, ...visual, ...(mixedPoint ? { gain_db: -3, easing: 'ease-in-out' } : {}) },
      ];
      itemOf(doc, 'cut').keyframes = points;
      assertValid(doc);
      const { document, audioItemId } = unchanged(doc, () => split(doc));
      assertValid(document);
      const remaining = itemOf(document, 'cut').keyframes;
      assert.deepEqual(remaining, points.map(({ gain_db, ...point }) => point));
      assert.deepEqual(itemOf(document, audioItemId).keyframes,
        points.filter(point => point.gain_db !== undefined).map(({ t, gain_db, easing }) =>
          ({ t, gain_db, ...(easing === undefined ? {} : { easing }) })));
      // The engine evaluates each property using only points declaring that property.
      for (const property of ['transform', 'crop', 'opacity', 'perspective', 'animator']) {
        const samples = keyframes => keyframes.filter(point => property in point).map(point => ({
          t: point.t, value: point[property], easing: point.easing,
        }));
        assert.deepEqual(samples(remaining), samples(points), property);
      }
    }
  }
});

test('12: singleton audio folding explicitly clamps out-of-range sums to schema bounds', () => {
  for (const [baseGain, offset, expected] of [[-60, -12, -60], [12, 12, 12]]) {
    const doc = fixture();
    Object.assign(itemOf(doc, 'cut').source, { gain_db: baseGain, mute: true });
    itemOf(doc, 'cut').keyframes = [{ t: 0, gain_db: offset }, { t: 5, transform: { x: 1 } }];
    assertValid(doc);
    const { document, audioItemId } = unchanged(doc, () => split(doc));
    assertValid(document);
    const audio = itemOf(document, audioItemId);
    assert.equal(audio.gain_db, expected);
    assert.equal(audio.mute, true);
    assert.equal('keyframes' in audio, false);
  }
});

test('13: empty audio tracks with matching mute stay empty when a dedicated receiver is created', () => {
  for (const muted of [undefined, false, true]) {
    const doc = fixture();
    const empty = { id: 'empty', lane: 'audio', name: 'Reserved for effects', items: [] };
    if (muted !== undefined) {
      trackOf(doc, 'v1').muted = muted;
      empty.muted = muted;
    }
    doc.tracks.unshift(empty);
    const result = unchanged(doc, () => split(doc));
    assert.equal(result.createdTrack, true);
    assert.notEqual(result.audioTrackId, empty.id);
    assert.deepEqual(trackOf(result.document, empty.id), empty);
    assert.equal(result.document.tracks.length, doc.tracks.length + 1);
    assert.equal(trackOf(result.document, result.audioTrackId).items[0].id, result.audioItemId);
    assertValid(result.document);
  }
});

test('14: a receiver emptied by pair removal stays empty while a new nonempty receiver is reused', () => {
  const doc = fixture();
  const first = split(doc);
  const removed = unchanged(first.document, () => removeCutAudioLinked(first.document,
    { target: 'pair', cutId: 'cut' }));
  assert.deepEqual(trackOf(removed, first.audioTrackId).items, []);
  trackOf(removed, 'v1').items.unshift(structuredClone(itemOf(doc, 'cut')));
  const next = unchanged(removed, () => split(removed));
  assert.equal(next.createdTrack, true);
  assert.notEqual(next.audioTrackId, first.audioTrackId);
  assert.deepEqual(trackOf(next.document, first.audioTrackId), trackOf(removed, first.audioTrackId));
  assert.equal(next.document.tracks.length, removed.tracks.length + 1);
  const second = unchanged(next.document, () => splitCutAudio(next.document, { cutId: 'second' }));
  assert.equal(second.createdTrack, false);
  assert.equal(second.audioTrackId, next.audioTrackId);
  assert.equal(second.document.tracks.length, next.document.tracks.length);
  assert.deepEqual(trackOf(second.document, first.audioTrackId).items, []);
  assert.deepEqual(trackOf(second.document, next.audioTrackId).items.map(item => item.id),
    [next.audioItemId, second.audioItemId]);
  assertValid(second.document);
});
