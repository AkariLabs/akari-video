import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readEditV2 } from '@akari-video/edit-store/lib/edit-v2.js';
import {
  findAudioItemIdByRole,
  indexEditV2Items,
  insertItem,
  insertAudioSfx,
  insertAudioSfxPreferV2,
  insertTrack,
  moveItem,
  moveAudioSfx,
  moveAudioSfxPreferV2,
  moveItemToNewTrack,
  removeItem,
  removeAudioNarrationPreferV2,
  removeAudioSfx,
  removeAudioSfxPreferV2,
  removeTrack,
  renameTrack,
  reorderTracks,
  setTrackFlag,
  splitItem,
  stringifyEditV2,
  updateAudioSfx,
  updateAudioSfxPreferV2,
  updateAudioNarrationGainPreferV2,
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
    trackId: 'v-main', trackIndex: 3, itemIndex: 0
  });
});

test('moveItem は visual 段どうしを種別なしで移動し、空になった移動元段を畳む', () => {
  const result = valid(moveItem(fixture, { itemId: 'html-1', toTrackId: 'v-main', atFrames: 15 }));
  assert.equal(result.tracks.some(track => track.id === 'v-html'), false);
  assert.equal(result.tracks.find(track => track.id === 'v-main').items.at(-1).id, 'html-1');
  assert.equal(result.tracks.find(track => track.id === 'v-main').items.at(-1).at, 15);
  assert.deepEqual(result.tracks.map(track => track.id), [
    'a-sfx', 'a-narration', 'a-bgm', 'v-main', 'captions', 'v-filter', 'v-telop'
  ]);
  assert.throws(
    () => moveItem(fixture, { itemId: 'clip-1', toTrackId: 'a-sfx', atFrames: 0 }),
    /音のレーンには映像を置けません/
  );
});

test('moveItemToNewTrack は行間に同じ lane の段を作る', () => {
  const result = valid(moveItemToNewTrack(fixture, {
    itemId: 'clip-1', insertIndex: 4, atFrames: 12
  }));
  assert.equal(result.tracks.some(track => track.id === 'v-main'), false);
  assert.equal(result.tracks[3].lane, 'visual');
  assert.equal(result.tracks[3].items[0].id, 'clip-1');
  assert.equal(result.tracks[3].items[0].at, 12);
});

test('最上段挿入は空になった移動元を畳み、tracks[] 末尾へ新しい最上段を作る', () => {
  const result = valid(moveItemToNewTrack(fixture, {
    itemId: 'html-1', insertIndex: fixture.tracks.length, atFrames: 90
  }));
  assert.equal(result.tracks.some(track => track.id === 'v-html'), false);
  assert.equal(result.tracks.at(-1).lane, 'visual');
  assert.equal(result.tracks.at(-1).items[0].id, 'html-1');
  assert.equal(result.tracks.at(-1).items[0].at, 90);
  assert.deepEqual(result.tracks.slice(0, -1).map(track => track.id), [
    'a-sfx', 'a-narration', 'a-bgm', 'v-main', 'captions', 'v-filter', 'v-telop'
  ]);
});

test('移動元に別アイテムが残る場合は visual 段を畳まない', () => {
  const source = structuredClone(fixture);
  source.tracks.find(track => track.id === 'v-html').items.push({
    id: 'html-2', at: 120, duration: 30,
    source: { kind: 'html', path: 'overlays/second.html' }
  });
  const result = valid(moveItem(source, { itemId: 'html-1', toTrackId: 'v-main', atFrames: 15 }));
  assert.deepEqual(result.tracks.find(track => track.id === 'v-html').items.map(item => item.id), ['html-2']);
});

test('移動時の空段整理は content/audio/明示追加の未使用 visual 段を巻き込まない', () => {
  const source = structuredClone(fixture);
  source.tracks.splice(6, 0, { id: 'v-empty-explicit', lane: 'visual', items: [] });
  const result = valid(moveItem(source, { itemId: 'html-1', toTrackId: 'v-main', atFrames: 15 }));
  assert.equal(result.tracks.some(track => track.id === 'v-html'), false);
  assert.ok(result.tracks.some(track => track.id === 'v-empty-explicit'));
  assert.deepEqual(result.tracks.find(track => track.id === 'captions').content, {
    from: 'captions.json'
  });
  assert.ok(result.tracks.some(track => track.id === 'a-sfx'));
  assert.ok(result.tracks.some(track => track.id === 'a-narration'));
  assert.ok(result.tracks.some(track => track.id === 'a-bgm'));
});

test('updateItem は item と source を部分更新し、未知の既存値を保つ', () => {
  const source = structuredClone(fixture);
  source.output.look = { preset: 'keep-me' };
  const result = valid(updateItem(source, {
    itemId: 'clip-1',
    patch: { at: 30, duration: 150, opacity: 0.75, source: { in: 13, out: 18, speed: 2 } }
  }));
  const clip = result.tracks.find(track => track.id === 'v-main').items[0];
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
  assert.equal(result.tracks.find(track => track.id === 'v-main').items[0].id, 'clip-2');
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
  const [left, right] = result.tracks.find(track => track.id === 'v-main').items;
  assert.equal(left.duration, 120);
  assert.equal(right.id, 'clip-1-split');
  assert.equal(right.at, 120);
  assert.equal(right.duration, 180);
  assert.equal(left.source.out, 16);
  assert.equal(right.source.in, 16);
});

test('reorderTracks は tracks[] の順だけを動かし lane 越えを拒否する', () => {
  const result = valid(reorderTracks(fixture, { fromIndex: 6, toIndex: 7 }));
  assert.deepEqual(result.tracks.map(track => track.id), [
    'a-sfx', 'a-narration', 'a-bgm', 'v-main', 'captions', 'v-filter', 'v-telop', 'v-html'
  ]);
  assert.throws(() => reorderTracks(fixture, { fromIndex: 0, toIndex: 3 }), /レーンをまたいで/);
});

test('reorderTracks は content 型の captions トラック自体を visual レーン内で双方向に動かせる', () => {
  const movedDown = valid(reorderTracks(fixture, { fromIndex: 4, toIndex: 3 }));
  assert.deepEqual(movedDown.tracks.map(track => track.id), [
    'a-sfx', 'a-narration', 'a-bgm', 'captions', 'v-main', 'v-filter', 'v-html', 'v-telop'
  ]);
  assert.deepEqual(
    movedDown.tracks.find(track => track.id === 'captions').content,
    { from: 'captions.json' }
  );

  const movedUp = valid(reorderTracks(fixture, { fromIndex: 4, toIndex: 7 }));
  assert.deepEqual(movedUp.tracks.map(track => track.id), [
    'a-sfx', 'a-narration', 'a-bgm', 'v-main', 'v-filter', 'v-html', 'v-telop', 'captions'
  ]);
  assert.deepEqual(
    movedUp.tracks.find(track => track.id === 'captions').content,
    { from: 'captions.json' }
  );
});

test('insertTrack / removeTrack は audio 最下段規約と一意 id を守る', () => {
  const inserted = valid(insertTrack(fixture, { index: 3, lane: 'visual', name: '差し込み' }));
  assert.equal(inserted.tracks[3].id, 'v1');
  assert.equal(inserted.tracks[3].name, '差し込み');
  assert.deepEqual(inserted.tracks[3].items, []);
  assert.throws(() => insertTrack(fixture, { index: 2, lane: 'visual' }), /最下段/);
  const removed = valid(removeTrack(inserted, 'v1'));
  assert.equal(removed.tracks.some(track => track.id === 'v1'), false);
});

test('renameTrack は空名なら name キーを落とす', () => {
  const named = valid(renameTrack(fixture, { trackId: 'v-main', name: 'インタビュー' }));
  assert.equal(named.tracks.find(track => track.id === 'v-main').name, 'インタビュー');
  const unnamed = valid(renameTrack(named, { trackId: 'v-main', name: '' }));
  assert.equal(Object.hasOwn(unnamed.tracks.find(track => track.id === 'v-main'), 'name'), false);
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

test('SFX 互換ルーターは tracks[].items[] を最優先して移動・トリム・gain/fade・削除する', () => {
  const source = structuredClone(fixture);
  source.audio = {
    sfx: [{ id: 'hit-1', path: 'legacy-duplicate.wav', t: 99, track: 9, gain_db: 9 }]
  };
  const moved = valid(moveAudioSfxPreferV2(source, {
    sfxId: 'hit-1', t: 2, track: 1, toTrackId: 'a-narration', atFrames: 60
  }));
  assert.equal(moved.tracks.find(track => track.id === 'a-sfx').items.length, 0);
  assert.equal(moved.tracks.find(track => track.id === 'a-narration').items.at(-1).id, 'hit-1');
  assert.equal(moved.tracks.find(track => track.id === 'a-narration').items.at(-1).at, 60);
  assert.equal(moved.audio.sfx[0].t, 99);

  const updated = valid(updateAudioSfxPreferV2(moved, {
    sfxId: 'hit-1',
    itemPatch: {
      at: 75, duration: 24, gain_db: -3, fade_in: 0.2, fade_out: 0.3,
      source: { in: 0.5, out: 1.3 }
    },
    legacyPatch: { t: 2.5, in: 0.5, out: 1.3, gain_db: -3, fade_in: 0.2, fade_out: 0.3 }
  }));
  const item = updated.tracks.find(track => track.id === 'a-narration').items.at(-1);
  assert.equal(item.at, 75);
  assert.equal(item.duration, 24);
  assert.equal(item.gain_db, -3);
  assert.equal(item.fade_in, 0.2);
  assert.equal(item.fade_out, 0.3);
  assert.equal(item.source.in, 0.5);
  assert.equal(item.source.out, 1.3);
  assert.equal(updated.audio.sfx[0].gain_db, 9);

  const removed = valid(removeAudioSfxPreferV2(updated, 'hit-1'));
  assert.equal(indexEditV2Items(removed).has('hit-1'), false);
  assert.equal(removed.audio.sfx[0].id, 'hit-1');
});

test('SFX 互換ルーターは raw item が無い旧形式では audio.sfx[] を更新する', () => {
  const source = structuredClone(fixture);
  source.audio = {
    sfx: [{ id: 'legacy-sfx', path: 'assets/legacy.wav', t: 1, track: 0, gain_db: -6 }]
  };
  const moved = valid(moveAudioSfxPreferV2(source, {
    sfxId: 'legacy-sfx', t: 2, track: 1, atFrames: 60
  }));
  assert.equal(moved.audio.sfx[0].t, 2);
  assert.equal(moved.audio.sfx[0].track, 1);
  const updated = valid(updateAudioSfxPreferV2(moved, {
    sfxId: 'legacy-sfx',
    itemPatch: { gain_db: -2 },
    legacyPatch: { gain_db: -2, fade_in: 0.1, fade_out: 0.2 }
  }));
  assert.deepEqual(updated.audio.sfx[0], {
    id: 'legacy-sfx', path: 'assets/legacy.wav', t: 2, track: 1,
    gain_db: -2, fade_in: 0.1, fade_out: 0.2
  });
  const removed = valid(removeAudioSfxPreferV2(updated, 'legacy-sfx'));
  assert.deepEqual(removed.audio.sfx, []);
});

test('SFX 互換ルーターは挿入先 track id があれば item、無ければ legacy 配列へ挿入する', () => {
  const insertedV2 = valid(insertAudioSfxPreferV2(fixture, {
    trackId: 'a-sfx',
    item: {
      id: 'hit-2', at: 90, duration: 15, gain_db: -4,
      source: { kind: 'media', src: 'sfx', in: 0, out: 0.5 }
    },
    legacyItem: { id: 'hit-2', path: 'assets/hit.wav', t: 3, track: 0 }
  }));
  assert.equal(insertedV2.tracks.find(track => track.id === 'a-sfx').items.at(-1).id, 'hit-2');
  assert.equal(insertedV2.audio?.sfx?.some(item => item.id === 'hit-2') ?? false, false);

  const insertedLegacy = valid(insertAudioSfxPreferV2(fixture, {
    item: {
      id: 'legacy-new', at: 90, duration: 15,
      source: { kind: 'media', src: 'sfx', in: 0, out: 0.5 }
    },
    legacyItem: { id: 'legacy-new', path: 'assets/hit.wav', t: 3, track: 0 }
  }));
  assert.equal(insertedLegacy.audio.sfx.at(-1).id, 'legacy-new');
  assert.equal(indexEditV2Items(insertedLegacy).has('legacy-new'), false);
});

test('narration / BGM の raw item は role で見つかり、gain/fade を item 側へ書ける', () => {
  const narrationId = findAudioItemIdByRole(fixture, 'narration');
  const bgmId = findAudioItemIdByRole(fixture, 'bgm');
  assert.equal(narrationId, 'n-0001');
  assert.equal(bgmId, 'music-1');
  const narrationUpdated = valid(updateAudioNarrationGainPreferV2(fixture, {
    narrationId, gainDb: 2
  }));
  const updated = valid(updateItem(narrationUpdated, {
    itemId: bgmId, patch: { gain_db: -12, fade_in: 1, fade_out: 2 }
  }));
  assert.equal(updated.tracks.find(track => track.id === 'a-narration').items[0].gain_db, 2);
  assert.deepEqual(
    Object.fromEntries(['gain_db', 'fade_in', 'fade_out'].map(key => [
      key, updated.tracks.find(track => track.id === 'a-bgm').items[0][key]
    ])),
    { gain_db: -12, fade_in: 1, fade_out: 2 }
  );
});

test('narration gain は raw item が無い旧形式では audio.narration[] を更新する', () => {
  const source = structuredClone(fixture);
  source.audio = {
    narration: [{ id: 'legacy-narration', path: 'voice.wav', t: 0, gain_db: -1 }]
  };
  const updated = valid(updateAudioNarrationGainPreferV2(source, {
    narrationId: 'legacy-narration', gainDb: 3
  }));
  assert.equal(updated.audio.narration[0].gain_db, 3);
  assert.equal(findAudioItemIdByRole(updated, 'narration'), 'n-0001');
  const removed = valid(removeAudioNarrationPreferV2(updated, 'legacy-narration'));
  assert.deepEqual(removed.audio.narration, []);
});

test('reorderTracks は narration と BGM の audio track を中身ごと入れ替える', () => {
  const result = valid(reorderTracks(fixture, { fromIndex: 1, toIndex: 2 }));
  assert.deepEqual(result.tracks.slice(0, 3).map(track => track.id), [
    'a-sfx', 'a-bgm', 'a-narration'
  ]);
  assert.equal(result.tracks[1].items[0].role, 'bgm');
  assert.equal(result.tracks[1].items[0].id, 'music-1');
  assert.equal(result.tracks[2].items[0].role, 'narration');
  assert.equal(result.tracks[2].items[0].id, 'n-0001');
});
