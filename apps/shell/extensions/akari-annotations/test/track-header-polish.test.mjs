import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampTrackHeaderWidth, findNestedTrackHeaderItem, iconKindForAudioTrackHeader, iconKindForTrackHeaderItem,
  iconKindForVisualTrackHeader,
  readTrackHeaderWidth, sourcePathForTrackHeader,
  TRACK_HEADER_WIDTH_STORAGE_KEY, widthForLongestTrackHeaderName, writeTrackHeaderWidth,
} from '../lib/common/track-header-controls.js';

test('track header width clamps drag and saved values', () => {
  assert.equal(clampTrackHeaderWidth(12), 136);
  assert.equal(clampTrackHeaderWidth(420), 360);
  assert.equal(clampTrackHeaderWidth(217.6), 218);
  assert.equal(clampTrackHeaderWidth(Number.NaN), 136);
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(readTrackHeaderWidth(storage), 136);
  writeTrackHeaderWidth(storage, 219);
  assert.equal(values.get(TRACK_HEADER_WIDTH_STORAGE_KEY), '219');
  assert.equal(readTrackHeaderWidth(storage), 219);
  values.set(TRACK_HEADER_WIDTH_STORAGE_KEY, '999');
  assert.equal(readTrackHeaderWidth(storage), 360);
  values.set(TRACK_HEADER_WIDTH_STORAGE_KEY, 'broken');
  assert.equal(readTrackHeaderWidth(storage), 136);
  assert.equal(readTrackHeaderWidth({ getItem: () => { throw Error('blocked'); } }), 136);
  assert.doesNotThrow(() => writeTrackHeaderWidth({ setItem: () => { throw Error('blocked'); } }, 200));
});

test('double click adds the longest missing name width within bounds', () => {
  assert.equal(widthForLongestTrackHeaderName(136, [
    { scrollWidth: 39, clientWidth: 39 }, { scrollWidth: 250, clientWidth: 50 },
  ]), 336);
  assert.equal(widthForLongestTrackHeaderName(136, [{ scrollWidth: 600, clientWidth: 40 }]), 360);
  assert.equal(widthForLongestTrackHeaderName(210, [{ scrollWidth: 30, clientWidth: 30 }]), 210);
});

test('header icons distinguish material roles and tree row sources', () => {
  assert.equal(iconKindForTrackHeaderItem('group'), 'placeholder');
  assert.equal(iconKindForTrackHeaderItem('media', undefined, 'still.png'), 'image');
  assert.equal(iconKindForTrackHeaderItem('media', undefined, 'clip.mp4'), 'video');
  assert.equal(iconKindForTrackHeaderItem('media', 'sfx', 'impact.wav'), 'sfx');
  assert.equal(iconKindForTrackHeaderItem('media', 'bgm', 'score.mp3'), 'bgm');
  assert.equal(iconKindForTrackHeaderItem('media', 'narration', 'voice.wav'), 'narration');
  assert.equal(iconKindForTrackHeaderItem('caption'), 'caption');
  assert.equal(iconKindForTrackHeaderItem('html'), 'overlay');
});

test('v2 source IDs resolve to image paths for child rows and whole tracks', () => {
  const rawSources = [{ id: 'title', path: 'assets/title.png' }];
  const normalizedSources = [{ id: 'title', path: 'assets/title.png' }];
  const rawPath = sourcePathForTrackHeader('title', rawSources);
  assert.equal(rawPath, 'assets/title.png');
  assert.equal(iconKindForTrackHeaderItem('media', undefined, rawPath), 'image');
  const items = [{ source: { kind: 'media', src: 'title' } }];
  assert.equal(iconKindForVisualTrackHeader(items,
    id => sourcePathForTrackHeader(id, rawSources), 'video'), 'image');
  assert.equal(sourcePathForTrackHeader('title', undefined, normalizedSources), 'assets/title.png');
  assert.equal(iconKindForVisualTrackHeader(items,
    id => sourcePathForTrackHeader(id, undefined, normalizedSources), 'video'), 'image');
});

test('nested group media rows use the nested item and its declared source path', () => {
  const tracks = [{ id: 'placeholder', items: [{ id: 'playbook-opening', source: { kind: 'group' }, items: [
    { id: 'pb-jingle', source: { kind: 'media', src: 'title' } },
    { id: 'pb-title', source: { kind: 'media', src: 'title' } },
    { id: 'pb-voice', role: 'narration', source: { kind: 'media', src: 'voice' } },
  ] }] }];
  const sources = [{ id: 'title', path: 'assets/title.png' }, { id: 'voice', path: 'assets/voice.wav' }];
  const iconFor = id => {
    const item = findNestedTrackHeaderItem(tracks, id);
    return iconKindForTrackHeaderItem(item?.source?.kind, item?.role,
      sourcePathForTrackHeader(item?.source?.src, sources));
  };
  assert.equal(iconFor('pb-jingle'), 'image');
  assert.equal(iconFor('pb-title'), 'image');
  assert.equal(iconFor('pb-voice'), 'narration');
  assert.equal(findNestedTrackHeaderItem(tracks, 'missing'), undefined);
});

test('v2 audio uses only explicit item roles while legacy keeps its derived kind', () => {
  const legacySfx = ['sfx'];
  assert.equal(iconKindForAudioTrackHeader([{ source: { kind: 'media', src: 'room-tone' } }], legacySfx), 'audio');
  assert.equal(iconKindForAudioTrackHeader([{ role: 'sfx' }], legacySfx), 'sfx');
  assert.equal(iconKindForAudioTrackHeader([{ role: 'bgm' }]), 'bgm');
  assert.equal(iconKindForAudioTrackHeader([{ role: 'narration' }]), 'narration');
  assert.equal(iconKindForAudioTrackHeader([{ role: 'bgm' }, {}]), 'audio');
  assert.equal(iconKindForAudioTrackHeader([{ role: 'sfx' }, { role: 'bgm' }]), 'audio');
  assert.equal(iconKindForAudioTrackHeader([], legacySfx), 'audio');
  assert.equal(iconKindForAudioTrackHeader(undefined, legacySfx), 'sfx');
});
