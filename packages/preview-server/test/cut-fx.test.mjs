import assert from 'node:assert/strict';
import test from 'node:test';

import { FX_IDS as RENDER_FX_IDS } from '../../render-cut/src/fx.mjs';
import {
  FX_IDS,
  intensityToOpacity,
  normalizeCutFxList,
  normalizePreviewColor,
} from '../public/cut-fx.js';

// 2026-08-11 撤去: v0 の画面 FX 小語彙 5 種はオーナー裁定により製品面から撤去した
// （docs/contract-2026-08-05-fx-v0.md 冒頭の廃止追記参照）。プレビュー側の FX_IDS は
// render-cut 側の FX_IDS（fx.mjs の FX_BUILDERS ディスパッチ表）と常に一致させる —
// 現在はどちらも 0 件。将来 fx が復活したら両方に同じ id を登録する。

test('preview supports exactly the render-cut FX vocabulary (both empty until a new fx is registered)', () => {
  assert.deepEqual([...FX_IDS].sort(), [...RENDER_FX_IDS].sort());
});

test('normalization returns an empty list for any input while FX_IDS is empty (nothing is a known preview id yet)', () => {
  assert.deepEqual(normalizeCutFxList([
    { id: 'sample-fx' },
    { id: 'another-fx', intensity: -2, params: { color: 'white' } },
    { id: 'anything-else', intensity: 2 },
    null,
  ]), []);
  assert.deepEqual(normalizeCutFxList(undefined), []);
  assert.deepEqual(normalizeCutFxList([]), []);
});

test('intensity maps linearly to CSS opacity and zero is the identity boundary', () => {
  assert.equal(intensityToOpacity(0), 0);
  assert.equal(intensityToOpacity(0.22), 0.22);
  assert.equal(intensityToOpacity(0.32), 0.32);
  assert.equal(intensityToOpacity(1), 1);
  assert.equal(intensityToOpacity(-1), 0);
  assert.equal(intensityToOpacity(4), 1);
  assert.equal(intensityToOpacity(undefined), 1);
});

test('ffmpeg 0x colors become browser CSS colors and missing color falls back to black', () => {
  assert.equal(normalizePreviewColor('0xff0000'), '#ff0000');
  assert.equal(normalizePreviewColor('0x112233aa'), '#112233aa');
  assert.equal(normalizePreviewColor('#abcdef'), '#abcdef');
  assert.equal(normalizePreviewColor(undefined), 'black');
});
