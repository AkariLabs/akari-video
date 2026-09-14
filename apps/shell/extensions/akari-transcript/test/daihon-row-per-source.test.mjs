import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildDaihonRows } = require('../lib/common/daihon-row-model.js');

const segments = [
  { kind: 'src', src: 'src-1', cutIndex: 0, in: 0, out: 10, outStart: 0, outEnd: 10 },
  { kind: 'src', src: 'src-2', cutIndex: 1, in: 0, out: 20, outStart: 10, outEnd: 30 }
];
const caption = (id, src, start, end) => ({
  id, start, end, text: id, style: null, edited: false, ...(src ? { src } : {})
});

test('buildDaihonRows は行の素材だけで出力時刻を写す', () => {
  const [source2, source1, legacy] = buildDaihonRows([
    caption('source-2', 'src-2', 5, 8),
    caption('source-1', 'src-1', 5, 8),
    caption('legacy', null, 5, 8)
  ], segments);

  assert.equal(source2.src, 'src-2');
  assert.equal(source2.outStart, 15);
  assert.equal(source2.outEnd, 18);
  assert.equal(source1.src, 'src-1');
  assert.equal(source1.outStart, 5);
  assert.equal(source1.outEnd, 8);
  assert.equal(legacy.src, null);
  assert.equal(legacy.outStart, 5);
});

test('buildDaihonRows の kept 判定は別素材の区間へ吸われない', () => {
  const [source1, source2] = buildDaihonRows([
    caption('source-1-cut', 'src-1', 12, 14),
    caption('source-2-kept', 'src-2', 12, 14)
  ], segments);

  assert.equal(source1.outStart, null);
  assert.equal(source1.outEnd, null);
  assert.equal(source2.outStart, 22);
  assert.equal(source2.outEnd, 24);
});
