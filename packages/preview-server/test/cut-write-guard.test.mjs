import assert from 'node:assert/strict';
import test from 'node:test';

import { relocateCutIndex } from '../public/cut-write-guard.js';

// issue #69 の調査: クリップ系の書き戻しがタブのキャッシュをそのまま送ると、その間に
// 他の書き手が足した item が射影から抜け落ち、書き戻しの「射影に無い既存 item は消す」
// 規則で無言の削除になりえた。送信前に取り直したうえで、対象を指し直す判定を固定する。

test('id があれば、取り直しで位置が変わっても同じクリップを指す', () => {
  const previous = [{ id: 'a' }, { id: 'b' }];
  const fresh = [{ id: 'x' }, { id: 'a' }, { id: 'b' }];
  assert.equal(relocateCutIndex(previous, 0, fresh), 1);
  assert.equal(relocateCutIndex(previous, 1, fresh), 2);
});

test('id で追えない（他の場所で消された）ときは -1 を返す', () => {
  assert.equal(relocateCutIndex([{ id: 'a' }], 0, [{ id: 'b' }]), -1);
  assert.equal(relocateCutIndex([{ id: 'a' }], 0, []), -1);
});

test('id の無い legacy 射影は、件数が一致するときだけ index を使う', () => {
  const previous = [{ in: 0, out: 1 }, { in: 1, out: 2 }];
  assert.equal(relocateCutIndex(previous, 1, [{ in: 0, out: 1 }, { in: 1, out: 2 }]), 1);
  assert.equal(relocateCutIndex(previous, 1, [{ in: 0, out: 1 }]), -1);
  assert.equal(relocateCutIndex(previous, 1, [{ in: 0, out: 1 }, { in: 1, out: 2 }, { in: 2, out: 3 }]), -1);
});

test('空文字 id は id 無しとして扱う（件数一致で index）', () => {
  const previous = [{ id: '' }, { id: '' }];
  assert.equal(relocateCutIndex(previous, 0, [{ id: '' }, { id: '' }]), 0);
  assert.equal(relocateCutIndex(previous, 0, [{ id: '' }]), -1);
});

test('対象が無い index・壊れた入力は -1', () => {
  assert.equal(relocateCutIndex([{ id: 'a' }], 5, [{ id: 'a' }]), -1);
  assert.equal(relocateCutIndex([{ id: 'a' }], -1, [{ id: 'a' }]), -1);
  assert.equal(relocateCutIndex(undefined, 0, [{ id: 'a' }]), -1);
  assert.equal(relocateCutIndex([{ id: 'a' }], 0, undefined), -1);
});
