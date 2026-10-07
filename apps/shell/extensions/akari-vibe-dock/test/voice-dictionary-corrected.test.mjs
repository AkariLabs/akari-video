import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCorrectedSegments } from '../lib/common/corrected-text-model.js';

const applied = (from, to, start, end) => ({ from, to, id: from, layer: 'user', range: [start, end] });
test('複数・隣接の範囲を分ける', () => {
    const segments = buildCorrectedSegments('テロップとJev', [applied('てろっぷ', 'テロップ', 0, 4), applied('じぇぶ', 'Jev', 5, 8)]);
    assert.deepEqual(segments.map(item => item.text), ['テロップ', 'と', 'Jev']);
    assert.equal(buildCorrectedSegments('AB', [applied('a', 'A', 0, 1), applied('b', 'B', 1, 2)]).length, 2);
});
test('不正範囲と空は本文だけにする', () => {
    assert.deepEqual(buildCorrectedSegments('本文', [applied('語', '別', 0, 1)]), [{ text: '本文' }]);
    assert.deepEqual(buildCorrectedSegments('', []), [{ text: '' }]);
});
