import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import {
  indexEditV2Items,
  insertItem,
  insertAudioSfx,
  insertTrack,
  moveItem,
  moveAudioSfx,
  moveItemToNewTrack,
  removeItem,
  removeAudioSfx,
  removeTrack,
  renameTrack,
  reorderTracks,
  setTrackFlag,
  splitItem,
  stringifyEditV2,
  updateAudioSfx,
  updateItem
} from '../lib/common/edit-v2-mutations.js';

const fixturePath = new URL('../../../../../packages/edit-store/test/fixtures/edit-v2.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function valid(value) {
  assert.equal(readEditV2(value).version, 2);
  return value;
}

test('item id 索引は trackId / trackIndex / itemIndex を返す', () => {
  assert.deepEqual(indexEditV2Items(fixture).get('clip-1'), {
    trackId: 'v-main', trackIndex: 1, itemIndex: 0
  });
});

test('moveItem は visual 段どうしを種別なしで移動し、元の空段を残す', () => {
  const result = valid(moveItem(fixture, { itemId: 'html-1', toTrackId: 'v-main', atFrames: 15 }));
  assert.equal(result.tracks[4].items.length, 0);
  assert.equal(result.tracks[1].items.at(-1).id, 'html-1');
  assert.equal(result.tracks[1].items.at(-1).at, 15);
  assert.throws(
    () => moveItem(fixture, { itemId: 'clip-1', toTrackId: 'a1', atFrames: 0 }),
    /音のレーンには映像を置けません/
  );
});

test('moveItemToNewTrack は行間に同じ lane の段を作る', () => {
  const result = valid(moveItemToNewTrack(fixture, {
    itemId: 'clip-1', insertIndex: 2, atFrames: 12
  }));
  assert.equal(result.tracks[1].items.length, 0);
  assert.equal(result.tracks[2].lane, 'visual');
  assert.equal(result.tracks[2].items[0].id, 'clip-1');
  assert.equal(result.tracks[2].items[0].at, 12);
});

test('updateItem は item と source を部分更新し、未知の既存値を保つ', () => {
  const source = structuredClone(fixture);
  source.output.look = { preset: 'keep-me' };
  const result = valid(updateItem(source, {
    itemId: 'clip-1',
    patch: { at: 30, duration: 150, opacity: 0.75, source: { in: 13, out: 18, speed: 2 } }
  }));
  const clip = result.tracks[1].items[0];
  assert.deepEqual(result.output.look, { preset: 'keep-me' });
  assert.equal(clip.at, 30);
  assert.equal(clip.duration, 150);
  assert.equal(clip.opacity, 0.75);
  assert.deepEqual(clip.source, { kind: 'media', src: 'main', in: 13, out: 18, speed: 2 });
});

test('removeItem は空になった宣言済み段を prune しない', () => {
  const result = valid(removeItem(fixture, 'filter-1'));
  assert.equal(result.tracks.find(track => track.id === 'v-filter').items.length, 0);
});

test('insertItem は指定位置へ一意な item を挿入する', () => {
  const result = valid(insertItem(fixture, 'v-main', {
    id: 'clip-2', at: 300, duration: 30,
    source: { kind: 'media', src: 'main', in: 22, out: 23 }
  }, 0));
  assert.equal(result.tracks[1].items[0].id, 'clip-2');
  assert.throws(() => insertItem(fixture, 'v-main', fixture.tracks[1].items[0]), /重複/);
});

test('v2 HTML クリップのコピー＆ペーストは同じ段へ新 id・playhead at で挿入できる', () => {
  const original = fixture.tracks.find(track => track.id === 'v-html').items[0];
  const copied = structuredClone(original);
  copied.id = 'html-1-copy';
  copied.at = 210;
  const result = valid(insertItem(fixture, 'v-html', copied));
  const pasted = result.tracks.find(track => track.id === 'v-html').items.at(-1);
  assert.equal(pasted.id, 'html-1-copy');
  assert.equal(pasted.at, 210);
  assert.deepEqual(pasted.source, original.source);
  assert.equal(fixture.tracks.find(track => track.id === 'v-html').items.length, 1);
});

test('splitItem は整数フレーム位置で分け、media の source 区間も分割する', () => {
  const result = valid(splitItem(fixture, { itemId: 'clip-1', atFrames: 120 }));
  const [left, right] = result.tracks[1].items;
  assert.equal(left.duration, 120);
  assert.equal(right.id, 'clip-1-split');
  assert.equal(right.at, 120);
  assert.equal(right.duration, 180);
  assert.equal(left.source.out, 16);
  assert.equal(right.source.in, 16);
});

test('reorderTracks は tracks[] の順だけを動かし lane 越えを拒否する', () => {
  const result = valid(reorderTracks(fixture, { fromIndex: 4, toIndex: 5 }));
  assert.deepEqual(result.tracks.map(track => track.id), [
    'a1', 'v-main', 'captions', 'v-filter', 'v-telop', 'v-html'
  ]);
  assert.throws(() => reorderTracks(fixture, { fromIndex: 0, toIndex: 1 }), /レーンをまたいで/);
});

test('reorderTracks は content 型の captions トラック自体を visual レーン内で双方向に動かせる', () => {
  const movedDown = valid(reorderTracks(fixture, { fromIndex: 2, toIndex: 1 }));
  assert.deepEqual(movedDown.tracks.map(track => track.id), [
    'a1', 'captions', 'v-main', 'v-filter', 'v-html', 'v-telop'
  ]);
  assert.deepEqual(
    movedDown.tracks.find(track => track.id === 'captions').content,
    { from: 'captions.json' }
  );

  const movedUp = valid(reorderTracks(fixture, { fromIndex: 2, toIndex: 5 }));
  assert.deepEqual(movedUp.tracks.map(track => track.id), [
    'a1', 'v-main', 'v-filter', 'v-html', 'v-telop', 'captions'
  ]);
  assert.deepEqual(
    movedUp.tracks.find(track => track.id === 'captions').content,
    { from: 'captions.json' }
  );
});

test('insertTrack / removeTrack は audio 最下段規約と一意 id を守る', () => {
  const inserted = valid(insertTrack(fixture, { index: 1, lane: 'visual', name: '差し込み' }));
  assert.equal(inserted.tracks[1].id, 'v1');
  assert.equal(inserted.tracks[1].name, '差し込み');
  assert.deepEqual(inserted.tracks[1].items, []);
  assert.throws(() => insertTrack(fixture, { index: 0, lane: 'visual' }), /最下段/);
  const removed = valid(removeTrack(inserted, 'v1'));
  assert.equal(removed.tracks.some(track => track.id === 'v1'), false);
});

test('renameTrack は空名なら name キーを落とす', () => {
  const named = valid(renameTrack(fixture, { trackId: 'v-main', name: 'インタビュー' }));
  assert.equal(named.tracks[1].name, 'インタビュー');
  const unnamed = valid(renameTrack(named, { trackId: 'v-main', name: '' }));
  assert.equal(Object.hasOwn(unnamed.tracks[1], 'name'), false);
});

test('setTrackFlag は v2 exact 語彙に無い UI 状態を edit.json へ混入させない', () => {
  const result = valid(setTrackFlag(fixture, { trackId: 'v-main', field: 'hidden', value: true }));
  assert.equal(Object.hasOwn(result.tracks[1], 'hidden'), false);
});

test('stringifyEditV2 は 2 space + 末尾改行で整形する', () => {
  const text = stringifyEditV2(fixture);
  assert.equal(text.endsWith('\n'), true);
  assert.equal(text.startsWith('{\n  "version": 2,'), true);
  valid(JSON.parse(text));
});

test('audio.sfx はトップレベル audio ブロックのまま移動・トリム・gain・fade を更新する', () => {
  const source = structuredClone(fixture);
  source.audio = {
    sfx: [{ id: 's-0001', path: 'assets/se.wav', t: 1, track: 0, gain_db: -6 }]
  };
  const moved = valid(moveAudioSfx(source, { sfxId: 's-0001', t: 2, track: 1 }));
  assert.deepEqual(moved.audio.sfx[0], {
    id: 's-0001', path: 'assets/se.wav', t: 2, track: 1, gain_db: -6
  });
  const updated = valid(updateAudioSfx(moved, {
    sfxId: 's-0001', patch: { in: 0.5, out: 1.5, gain_db: -3, fade_in: 0.2, fade_out: 0.3 }
  }));
  assert.deepEqual(updated.audio.sfx[0], {
    id: 's-0001', path: 'assets/se.wav', t: 2, track: 1,
    in: 0.5, out: 1.5, gain_db: -3, fade_in: 0.2, fade_out: 0.3
  });
  assert.equal(updated.tracks.some(track => track.lane === 'audio'), true);
});

test('audio.sfx の挿入・削除は tracks[].items[] を変更しない', () => {
  const source = structuredClone(fixture);
  const beforeTracks = structuredClone(source.tracks);
  const inserted = valid(insertAudioSfx(source, {
    id: 's-0001', path: 'assets/se.wav', t: 1, track: 0
  }));
  assert.deepEqual(inserted.tracks, beforeTracks);
  assert.equal(inserted.audio.sfx[0].id, 's-0001');
  const removed = valid(removeAudioSfx(inserted, 's-0001'));
  assert.deepEqual(removed.audio.sfx, []);
  assert.deepEqual(removed.tracks, beforeTracks);
});
