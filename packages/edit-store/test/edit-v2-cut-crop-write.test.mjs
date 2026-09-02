import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';

// 出力プレビューの辺バークロップ（cuts[] の crop 書き戻し）。cuts[] に crop の席があるのは
// v2 の tracks[].items[] だけなので、legacy 文書は静かに捨てず throw する。
const v2 = () => ({
  version: 2,
  output: { width: 1920, height: 1080, fps: 30 },
  sources: [{ id: 'main', path: 'assets/main.mp4' }],
  tracks: [
    {
      id: 'v-main',
      lane: 'visual',
      items: [
        {
          id: 'clip-1',
          at: 0,
          duration: 90,
          transform: { x: 4, y: -6, scale: 1, rotate: 0 },
          source: { kind: 'media', src: 'main', in: 0, out: 3 },
        },
        {
          id: 'clip-2',
          at: 90,
          duration: 60,
          source: { kind: 'media', src: 'main', in: 3, out: 5 },
        },
      ],
    },
  ],
});

test('v2 の cut は crop と transform を同一 patch で書き戻せる', () => {
  const result = resolvePreviewItemWrite(JSON.stringify(v2()), {
    kind: 'cut',
    itemId: 'clip-1',
    legacyIndex: 0,
    patch: {
      crop: { x: 0, y: 0.25, w: 1, h: 0.75 },
      transform: { scale: 0.5625 },
    },
  });

  const written = JSON.parse(result.candidateText);
  const item = written.tracks[0].items[0];
  assert.deepEqual(item.crop, { x: 0, y: 0.25, w: 1, h: 0.75 });
  // transform はフィールド単位のマージ（x / y / rotate は元のまま）。
  assert.deepEqual(item.transform, { x: 4, y: -6, scale: 0.5625, rotate: 0 });
  // 他のカットは無傷。
  assert.equal(written.tracks[0].items[1].crop, undefined);
});

test('v2 の cut crop は既存 crop を丸ごと置き換える（キーの残骸を残さない）', () => {
  const value = v2();
  value.tracks[0].items[0].crop = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  const result = resolvePreviewItemWrite(JSON.stringify(value), {
    kind: 'cut',
    itemId: 'clip-1',
    legacyIndex: 0,
    patch: { crop: { x: 0, y: 0, w: 1, h: 0.5 } },
  });

  const written = JSON.parse(result.candidateText);
  assert.deepEqual(written.tracks[0].items[0].crop, { x: 0, y: 0, w: 1, h: 0.5 });
});

test('crop を持たない cut patch は従来どおり transform だけを書く', () => {
  const result = resolvePreviewItemWrite(JSON.stringify(v2()), {
    kind: 'cut',
    itemId: 'clip-1',
    legacyIndex: 0,
    patch: { transform: { rotate: 15 } },
  });

  const written = JSON.parse(result.candidateText);
  assert.equal(written.tracks[0].items[0].crop, undefined);
  assert.equal(written.tracks[0].items[0].transform.rotate, 15);
});

test('legacy v0/v1 の cut へ crop を書こうとすると v2 が必要だと拒否する', () => {
  const legacy = {
    version: 1,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'main', path: 'assets/main.mp4' }],
    cuts: [{ src: 'main', in: 0, out: 3, transform: { x: 1 } }],
  };

  assert.throws(
    () => resolvePreviewItemWrite(JSON.stringify(legacy), {
      kind: 'cut',
      legacyIndex: 0,
      patch: { crop: { x: 0, y: 0.25, w: 1, h: 0.75 }, transform: { scale: 0.5 } },
    }),
    /カットの crop 書き戻しには edit\.json version 2 が必要です/,
  );

  // 拒否は crop のときだけ。transform 単独の legacy 経路は無変更。
  const transformOnly = resolvePreviewItemWrite(JSON.stringify(legacy), {
    kind: 'cut',
    legacyIndex: 0,
    patch: { transform: { y: 2 } },
  });
  const written = JSON.parse(transformOnly.candidateText);
  assert.deepEqual(written.cuts[0].transform, { x: 1, y: 2 });
});
