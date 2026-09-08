import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPTION_LINE_DEFAULT_SECONDS,
  CAPTION_LINE_MIN_SECONDS,
  createCaptionIdAllocator,
  diffCaptionLines,
  planInsertSpans,
  planSplitSpans,
} from '../lib/caption-line-diff.js';

// 「1 行 = 1 字幕」の対応表。diffCaptionLines は id しか見ない。
const ids = (...values) => values.map(id => ({ id }));

const THREE = ids('c-0001', 'c-0002', 'c-0003');

test('(a) 変更なし: 操作は 1 つも出ない', () => {
  assert.deepEqual(diffCaptionLines(['A', 'B', 'C'], ['A', 'B', 'C'], THREE), []);
});

test('(b) 1 行のテキスト置換: その行だけ replace になる', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'B2', 'C'], THREE),
    [{ kind: 'replace', id: 'c-0002', text: 'B2' }]
  );
});

test('(c) 1 行 → 2 行の分割: split 1 つ（新しいテキストを順に持つ）', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'B前', 'B後', 'C'], THREE),
    [{ kind: 'split', id: 'c-0002', texts: ['B前', 'B後'] }]
  );
});

test('(d) 1 行 → 3 行の分割: texts は 3 つ', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'B1', 'B2', 'B3', 'C'], THREE),
    [{ kind: 'split', id: 'c-0002', texts: ['B1', 'B2', 'B3'] }]
  );
});

test('(e) 2 行 → 1 行の結合: merge が畳む id を並び順で持つ', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['AB', 'C'], THREE),
    [{ kind: 'merge', ids: ['c-0001', 'c-0002'], text: 'AB' }]
  );
});

test('(f) 3 行 → 1 行の結合: 3 つの id を 1 行へ畳む', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['ABC'], THREE),
    [{ kind: 'merge', ids: ['c-0001', 'c-0002', 'c-0003'], text: 'ABC' }]
  );
});

test('(g) 中間 1 行の削除: remove 1 つ', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'C'], THREE),
    [{ kind: 'remove', id: 'c-0002' }]
  );
});

test('(h) 先頭行の削除: 先頭一致が 0 でも末尾一致から塊が決まる', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['B', 'C'], THREE),
    [{ kind: 'remove', id: 'c-0001' }]
  );
});

test('(i) 末尾への追加: afterId は最後の既存字幕', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'B', 'C', 'D'], THREE),
    [{ kind: 'insert', afterId: 'c-0003', text: 'D' }]
  );
});

test('(j) 中間への追加: afterId は挿入位置の直前の既存字幕', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], ['A', 'X', 'B', 'C'], THREE),
    [{ kind: 'insert', afterId: 'c-0001', text: 'X' }]
  );
});

test('(k) 分割と削除が同時に起きる複合: 組は replace、余った旧行は remove へ落ちる', () => {
  // 「2 行目を 2 つに割り、3 行目と 4 行目を消した」編集。中央に残る塊は 1 つしかないので
  // 旧 3 行 → 新 2 行として解ける（split と remove が 1 回の呼び出しで同時に出ることはない）。
  assert.deepEqual(
    diffCaptionLines(
      ['A', 'B', 'C', 'D'],
      ['A', 'B前', 'B後'],
      ids('c-0001', 'c-0002', 'c-0003', 'c-0004')
    ),
    [
      { kind: 'replace', id: 'c-0002', text: 'B前' },
      { kind: 'replace', id: 'c-0003', text: 'B後' },
      { kind: 'remove', id: 'c-0004' },
    ]
  );
});

test('(k2) 分割してから削除する 2 手の複合: 各手で split → remove が順に出る', () => {
  const first = diffCaptionLines(['A', 'B', 'C'], ['A', 'B前', 'B後', 'C'], THREE);
  assert.deepEqual(first, [{ kind: 'split', id: 'c-0002', texts: ['B前', 'B後'] }]);
  // 分割を保存した後の状態（4 行 / 新しい id が 1 つ増えている）から末尾を消す。
  const second = diffCaptionLines(
    ['A', 'B前', 'B後', 'C'],
    ['A', 'B前', 'B後'],
    ids('c-0001', 'c-0002', 'c-0004', 'c-0003')
  );
  assert.deepEqual(second, [{ kind: 'remove', id: 'c-0003' }]);
});

test('先頭への追加は afterId が undefined になる', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B'], ['X', 'A', 'B'], ids('c-0001', 'c-0002')),
    [{ kind: 'insert', afterId: undefined, text: 'X' }]
  );
});

test('同じ位置への連続追加は同じ afterId の insert が並ぶ', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B'], ['A', 'X', 'Y', 'B'], ids('c-0001', 'c-0002')),
    [
      { kind: 'insert', afterId: 'c-0001', text: 'X' },
      { kind: 'insert', afterId: 'c-0001', text: 'Y' },
    ]
  );
});

test('決定論: 同じ入力を何度渡しても同じ操作列になる', () => {
  const run = () => diffCaptionLines(['A', 'B', 'C'], ['A', 'B1', 'B2', 'C'], THREE);
  assert.deepEqual(run(), run());
  assert.deepEqual(JSON.stringify(run()), JSON.stringify(run()));
});

test('baseline と字幕データの件数が食い違う入力は拒否する', () => {
  assert.throws(
    () => diffCaptionLines(['A', 'B'], ['A'], THREE),
    /字幕の行数と字幕データの件数が一致しません。/
  );
});

test('全消しは全行の merge ではなく先頭一致 0 の塊として解ける', () => {
  assert.deepEqual(
    diffCaptionLines(['A', 'B', 'C'], [], THREE),
    [
      { kind: 'remove', id: 'c-0001' },
      { kind: 'remove', id: 'c-0002' },
      { kind: 'remove', id: 'c-0003' },
    ]
  );
});

test('採番は既存 id と衝突せず c-NNNN を繰り上げる（timeline-material-insert と同型）', () => {
  const allocate = createCaptionIdAllocator(['c-0001', 'c-0003']);
  assert.equal(allocate(), 'c-0004');
  assert.equal(allocate(), 'c-0005');
  const fromEmpty = createCaptionIdAllocator([]);
  assert.equal(fromEmpty(), 'c-0001');
  // c- 形式でない id しか無くても 1 から採番し、衝突するものは飛ばす
  const mixed = createCaptionIdAllocator(['line-a', 'c-0001']);
  assert.equal(mixed(), 'c-0002');
});

test('公開している最小尺・既定尺の定数は契約値のまま', () => {
  assert.equal(CAPTION_LINE_MIN_SECONDS, 0.2);
  assert.equal(CAPTION_LINE_DEFAULT_SECONDS, 1);
});

test('planSplitSpans / planInsertSpans の存在確認（詳細は caption-store.test.mjs）', () => {
  assert.equal(typeof planSplitSpans, 'function');
  assert.equal(typeof planInsertSpans, 'function');
});
