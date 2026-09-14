import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  DAIHON_SILENCE_DEFAULTS, findRowGaps, findRowSilenceGaps, parseSilenceSpans,
  rowGapsWithSilences, silencesInWindow
} from '../lib/common/daihon-silence.js';

const row = (id, start, end, outStart = start) => ({ id, start, end, outStart });

test('既定値は 0.45 秒と 0.15 秒', () => assert.deepEqual(DAIHON_SILENCE_DEFAULTS, { minGapSec: 0.45, keepSec: 0.15 }));
test('2 行間の無音を返す', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 1.7, 2)]), [{ prevId: 'a', nextId: 'b', start: 1, end: 1.7, span: 0.7 }]));
test('接している行は無音にしない', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 1, 2)]), []));
test('重なる行は無音にしない', () => assert.deepEqual(findRowGaps([row('a', 0, 2), row('b', 1, 3)]), []));
test('カット済み行を飛ばして非カット行同士を比べる', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('x', 1.1, 2, null), row('b', 3, 4)]), [{ prevId: 'a', nextId: 'b', start: 1, end: 3, span: 2 }]));
test('複数ギャップを入力順で返す', () => assert.deepEqual(findRowGaps([row('a', 0, 1), row('b', 2, 3), row('c', 5, 6)]).map(gap => gap.span), [1, 2]));
test('1 行だけなら空', () => assert.deepEqual(findRowGaps([row('a', 0, 1)]), []));
test('全行カット済みなら空', () => assert.deepEqual(findRowGaps([row('a', 0, 1, null), row('b', 2, 3, null)]), []));
test('小数の境界をそのまま保持する', () => assert.deepEqual(findRowGaps([row('a', 0.1, 0.33), row('b', 0.81, 1)])[0], { prevId: 'a', nextId: 'b', start: 0.33, end: 0.81, span: 0.48000000000000004 }));

test('無音一覧は tuple と object を正規化して入力を壊さず整列する', () => {
  const input = [{ start: 3, end: 4 }, [1, 2], [2, 2], [NaN, 5]];
  assert.deepEqual(parseSilenceSpans(input), [{ start: 1, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(input[0], { start: 3, end: 4 });
});
test('非配列の無音一覧は空', () => assert.deepEqual(parseSilenceSpans({}), []));
test('窓に掛かる無音をクリップせず返す', () => assert.deepEqual(
  silencesInWindow([{ start: 1, end: 3 }, { start: 4, end: 5 }], { start: 2, end: 4 }),
  [{ start: 1, end: 3 }]
));
test('行間との重なりが最大の実無音を選ぶ', () => assert.deepEqual(
  findRowSilenceGaps([row('a', 0, 2), row('b', 3, 4)], [{ start: 1.5, end: 2.2 }, { start: 1.8, end: 2.8 }]),
  [{ prevId: 'a', nextId: 'b', start: 1.8, end: 2.8, span: 1, source: 'silence' }]
));
test('実無音が無い行間だけ語の隙間で補う', () => assert.deepEqual(
  rowGapsWithSilences([row('a', 0, 1), row('b', 2, 3), row('c', 5, 6)], [{ start: 0.8, end: 2.1 }]),
  [
    { prevId: 'a', nextId: 'b', start: 0.8, end: 2.1, span: 1.3, source: 'silence' },
    { prevId: 'b', nextId: 'c', start: 3, end: 5, span: 2, source: 'gap' }
  ]
));

test('オーナー実データは実無音のチップを返し、空なら語の隙間へ戻る', async () => {
  const fixture = new URL('./fixtures/daihon-cut-range-free/', import.meta.url);
  const silenceRaw = JSON.parse(await readFile(new URL('silences-owner.json', fixture), 'utf8'));
  const captionRaw = JSON.parse(await readFile(new URL('captions-owner.json', fixture), 'utf8'));
  const rows = captionRaw.captions.map(caption => ({ ...caption, outStart: caption.start }));
  const detected = rowGapsWithSilences(rows, parseSilenceSpans(silenceRaw.silences));
  assert.deepEqual(detected.find(gap => gap.prevId === 'c-0003'),
    { prevId: 'c-0003', nextId: 'c-0004', start: 8.61, end: 11.3, span: 2.69, source: 'silence' });
  assert.deepEqual(detected.find(gap => gap.prevId === 'c-0004'),
    { prevId: 'c-0004', nextId: 'c-0005', start: 13.99, end: 15.74, span: 1.75, source: 'silence' });
  assert.deepEqual(rowGapsWithSilences(rows, []).find(gap => gap.prevId === 'c-0003'),
    { prevId: 'c-0003', nextId: 'c-0004', start: 8.22, end: 8.87, span: 0.6499999999999986, source: 'gap' });
});

test('行ごとの素材から無音を解決し、配列 1 本を全行に使う従来入力との違いを保つ', () => {
  const rows = [
    { ...row('s1-a', 0, 2), src: 'src-1' },
    { ...row('s1-b', 3, 4), src: 'src-1' },
    { ...row('s2-a', 5, 6), src: 'src-2' },
    { ...row('s2-b', 9, 10), src: 'src-2' }
  ];
  const s1 = [{ start: 1.8, end: 3.2 }, { start: 3.8, end: 5.4 }, { start: 6.2, end: 8.2 }];
  const s2 = [{ start: 4.2, end: 5.3 }, { start: 6.5, end: 8.5 }];
  const resolved = rowGapsWithSilences(rows, candidate => candidate.src === 'src-2' ? s2 : s1);
  assert.deepEqual(resolved.find(gap => gap.prevId === 's2-a'),
    { prevId: 's2-a', nextId: 's2-b', start: 6.5, end: 8.5, span: 2, source: 'silence' });
  assert.deepEqual(rowGapsWithSilences(rows, s1).find(gap => gap.prevId === 's2-a'),
    { prevId: 's2-a', nextId: 's2-b', start: 6.2, end: 8.2, span: 2, source: 'silence' });
});

test('素材の境目は無音と重なっても語の隙間になり、隙間が無ければ出さない', () => {
  const silences = [{ start: 3.5, end: 5.5 }];
  const separated = [
    { ...row('s1', 0, 4), src: 'src-1' },
    { ...row('s2', 5, 6), src: 'src-2' }
  ];
  assert.deepEqual(rowGapsWithSilences(separated, () => silences), [
    { prevId: 's1', nextId: 's2', start: 4, end: 5, span: 1, source: 'gap' }
  ]);
  const touching = [
    { ...row('s1', 0, 4), src: 'src-1' },
    { ...row('s2', 4, 6), src: 'src-2' }
  ];
  assert.deepEqual(rowGapsWithSilences(touching, () => silences), []);
});

test('配列版のオーナー実データ出力はバイト一致し、関数版とも一致する', async () => {
  const fixture = new URL('./fixtures/daihon-cut-range-free/', import.meta.url);
  const silenceRaw = JSON.parse(await readFile(new URL('silences-owner.json', fixture), 'utf8'));
  const captionRaw = JSON.parse(await readFile(new URL('captions-owner.json', fixture), 'utf8'));
  const rows = captionRaw.captions.map(caption => ({ ...caption, outStart: caption.start }));
  const silences = parseSilenceSpans(silenceRaw.silences);
  const detected = '[{"prevId":"c-0003","nextId":"c-0004","start":8.61,"end":11.3,"span":2.69,"source":"silence"},{"prevId":"c-0004","nextId":"c-0005","start":13.99,"end":15.74,"span":1.75,"source":"silence"},{"prevId":"c-0005","nextId":"c-0006","start":18.54,"end":19.31,"span":0.77,"source":"silence"},{"prevId":"c-0006","nextId":"c-0007","start":22.38,"end":23.11,"span":0.73,"source":"silence"},{"prevId":"c-0007","nextId":"c-0008","start":23.76,"end":24.77,"span":1.01,"source":"silence"}]';
  const fallback = '[{"prevId":"c-0003","nextId":"c-0004","start":8.22,"end":8.87,"span":0.6499999999999986,"source":"gap"},{"prevId":"c-0004","nextId":"c-0005","start":14.14,"end":14.45,"span":0.3099999999999987,"source":"gap"}]';
  assert.equal(JSON.stringify(rowGapsWithSilences(rows, silences)), detected);
  assert.equal(JSON.stringify(rowGapsWithSilences(rows, [])), fallback);
  const sourcedRows = rows.map(candidate => ({ ...candidate, src: 'src-1' }));
  assert.equal(JSON.stringify(rowGapsWithSilences(sourcedRows, () => silences)), detected);
});

test('行ごとの解決結果が空なら語の隙間へ戻る', () => assert.deepEqual(
  rowGapsWithSilences([
    { ...row('a', 0, 1), src: 'src-1' },
    { ...row('b', 2, 3), src: 'src-1' }
  ], () => []),
  [{ prevId: 'a', nextId: 'b', start: 1, end: 2, span: 1, source: 'gap' }]
));
