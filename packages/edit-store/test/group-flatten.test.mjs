import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { readInternalEdit, projectLegacyEdit, collectExcludedCaptionIds, isAudioItemAudible, toLegacyTrack } = require('../lib/index.js');
const { flattenGroupDescendants } = require('../lib/group-flatten.js');

const edit = tracks => JSON.stringify({
  version: 2, output: { width: 640, height: 360, fps: 30 },
  sources: [{ id: 'image', path: 'assets/image.png' }], tracks
});
const orderFixture = JSON.parse(readFileSync(new URL('../../../evidence/c0a-group-media-render/fixture-order/edit.json', import.meta.url), 'utf8'));

test('group children occupy the parent position in legacy layer order', () => {
  const internal = readInternalEdit(JSON.stringify(orderFixture));
  assert.deepEqual(projectLegacyEdit(internal).layers.map(item => item.id), ['A', 'B', 'C', 'D', 'E']);
});

test('a clipped child advances its source window at declared speed', () => {
  const internal = readInternalEdit(edit([{ id: 'v', lane: 'visual', items: [
    { id: 'g', at: 30, duration: 30, source: { kind: 'group' }, items: [
      { id: 'long', at: 0, duration: 60,
        source: { kind: 'media', src: 'image', in: 2, out: 6 } }
    ] }
  ] }]));
  const child = internal.tracks[0].items[0].children[0];
  child.atFrames = 20;
  child.at = 20 / 30;
  const flat = flattenGroupDescendants(internal).find(entry => entry.item.id === 'long').item;
  assert.equal(flat.atFrames, 30);
  assert.equal(flat.durationFrames, 30);
  assert.ok(Math.abs(flat.source.in - (2 + 10 / 30 * 2)) < 1e-9);
  assert.ok(Math.abs(flat.source.out - (2 + 10 / 30 * 2 + 2)) < 1e-9);
  assert.equal(flat.declaration.speed, 2);
});

test('two nested groups compose time, transform, opacity and child order', () => {
  const internal = readInternalEdit(edit([{ id: 'v', lane: 'visual', items: [{
    id: 'outer', at: 30, duration: 60, source: { kind: 'group' },
    transform: { x: 10, y: 0, scale: 2, rotate: 90 }, opacity: 0.5,
    items: [{ id: 'inner', at: 10, duration: 40, source: { kind: 'group' },
      transform: { x: 5, scale: 0.5, rotate: 30 }, opacity: 0.8,
      items: [
        { id: 'photo', at: 0, duration: 60, source: { kind: 'media', src: 'image', in: 0, out: 2 },
          transform: { x: 4, scale: 0.5 }, opacity: 0.5 },
        { id: 'line', at: 5, duration: 20, source: { kind: 'caption', path: 'captions.json', id: 'c-0001' } },
        { id: 'html', at: 6, duration: 20, source: { kind: 'html', path: 'overlays/a.html' } }
      ] }
    ]
  }] }]));
  const flat = flattenGroupDescendants(internal);
  assert.deepEqual(flat.map(x => x.item.id), ['photo', 'line', 'html']);
  assert.deepEqual(flat.map(x => x.order), [2, 3, 4]);
  const photo = flat[0].item;
  assert.equal(photo.atFrames, 40);
  assert.equal(photo.durationFrames, 40);
  assert.equal(photo.legacy.collection, 'layers');
  assert.equal(photo.declaration.opacity, 0.2);
  assert.ok(Math.abs(photo.declaration.transform.x - 8) < 1e-9);
  assert.ok(Math.abs(photo.declaration.transform.y - (10 + 4 * Math.sin(120 * Math.PI / 180))) < 1e-9);
  assert.equal(photo.declaration.transform.scale, 0.5);
  assert.equal(photo.declaration.transform.rotate, 120);
  assert.equal(flat[1].item.atFrames, 45);
  assert.equal(flat[1].item.durationFrames, 20);
  assert.equal(flat[1].item.declaration.opacity, 0.4);
  const legacy = projectLegacyEdit(internal);
  assert.equal(legacy.layers.length, 1);
  assert.equal(legacy.layers[0].id, 'photo');
});

test('caption exclusion is recursive and an ordinary top-level edit keeps its legacy projection', () => {
  const internal = readInternalEdit(edit([{ id: 'v', lane: 'visual', items: [
    { id: 'photo', at: 0, duration: 30, source: { kind: 'media', src: 'image', in: 0, out: 1 } },
    { id: 'bag-parent', at: 30, duration: 30, source: { kind: 'group' }, items: [
      { id: 'bag', at: 0, duration: 30, source: { kind: 'captions', path: 'captions.json', exclude: ['c-0001'] }, items: [] },
      { id: 'line', at: 0, duration: 30, source: { kind: 'caption', path: 'captions.json', id: 'c-0001' } }
    ] }
  ] }]));
  assert.deepEqual([...collectExcludedCaptionIds(internal)], ['c-0001']);
  const flat = flattenGroupDescendants(internal);
  assert.equal(flat[0].item, internal.tracks[0].items[0]);
  const legacy = projectLegacyEdit(internal);
  assert.deepEqual(legacy.cuts, [internal.tracks[0].items[0].legacy.value]);
  assert.equal(legacy.layers.length, 0);
});

// The b76f1275 track.items loop, kept as an independent direct-only reference.
function baselineLegacyProjection(internal) {
  const cuts = [], overlays = [], layers = [], audioSfx = [], audioNarration = [], audioSpeech = [], audioBgms = [];
  const add = (collection, item, value) => collection.push({ index: item.legacy.index, value });
  for (const track of internal.tracks) {
    if (track.lane === 'audio' && !isAudioItemAudible(track, undefined)) continue;
    for (const item of track.items) {
      const value = item.legacy.value;
      if (value === undefined) {
        if (item.source.kind === 'telop' || item.source.kind === 'filter') add(layers, item, item.declaration);
        continue;
      }
      switch (item.source.kind) {
        case 'media': {
          const visual = track.lane === 'visual' && track.muted === true ? { ...value, mute: true } : value;
          switch (item.legacy.collection) {
            case 'sfx': add(audioSfx, item, value); break;
            case 'narration': add(audioNarration, item, value); break;
            case 'speech': add(audioSpeech, item, value); break;
            case 'bgm': audioBgms.push(value); break;
            case 'layers': add(layers, item, visual); break;
            default: add(cuts, item, visual); break;
          }
          break;
        }
        case 'html': add(overlays, item, value); break;
        case 'telop':
        case 'filter': add(layers, item, value); break;
        default: break;
      }
    }
  }
  const ordered = entries => [...entries].sort((a, b) => a.index - b.index).map(entry => entry.value);
  audioBgms.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return {
    cuts: ordered(cuts),
    ...(internal.sourceTableDeclared ? { sources: internal.sources
      .filter(source => source.path !== undefined)
      .map(source => ({ id: source.id, path: source.path, proxy: source.proxy })) } : {}),
    overlays: ordered(overlays),
    ...(internal.beats !== undefined ? { beats: internal.beats } : {}),
    layers: ordered(layers),
    audioSfx: ordered(audioSfx),
    audioNarration: ordered(audioNarration),
    ...(audioSpeech.length ? { audioSpeech: ordered(audioSpeech) } : {}),
    audioBgms,
    ...(audioBgms.length ? { audioBgm: audioBgms[0] } : {}),
    ...(internal.tracksDeclared ? { timeline: { tracks: internal.tracks
      .filter(track => track.origin === 'declared').map(toLegacyTrack) } } : {}),
    fps: internal.output.fps,
    warnings: internal.warnings
  };
}

const directCases = JSON.parse(readFileSync(new URL('../../../evidence/c0a-group-media-render/fixture-direct-only-cases.json', import.meta.url), 'utf8'));
for (const fixture of directCases) {
  test(`direct-only ${fixture.name} keeps the b76f1275 legacy projection`, () => {
    const internal = readInternalEdit(JSON.stringify({
      version: 2, output: { width: 640, height: 360, fps: 30 },
      sources: [{ id: 'still', path: 'assets/still.png' }, { id: 'video', path: 'assets/video.mp4' }],
      tracks: fixture.tracks
    }));
    assert.deepEqual(projectLegacyEdit(internal), baselineLegacyProjection(internal));
  });
}
