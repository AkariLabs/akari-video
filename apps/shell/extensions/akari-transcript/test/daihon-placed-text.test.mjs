import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildDaihonRows } = require('../lib/common/daihon-row-model.js');
const { placedTextRanges, placedTextLanes, placedTextTiming, placedTextDropTiming } = require('../lib/common/daihon-placed-text.js');
const caption = (id, start, end, timeDomain) => ({ id, start, end, text: id, style: null, timeDomain });
const rows = buildDaihonRows(Array.from({ length: 8 }, (_, i) => caption(`r${i}`, i * 4, (i + 1) * 4)), null);
const captions = [caption('p1', 0, 32, 'output'), caption('p2', 4, 16, 'output'),
    caption('p3', 16, 20, 'output'), caption('p4', 20, 28, 'output')];

test('8 行 + 4 本: 全体/3 行/1 行/2 行を求め、同時最大 2 列に詰める', () => {
    const ranges = placedTextRanges(captions, rows);
    assert.deepEqual(ranges.map(({ first, last }) => [first, last]), [[0, 7], [1, 3], [4, 4], [5, 6]]);
    const { lanes, count, width } = placedTextLanes(ranges);
    assert.equal(count, 2);
    assert.equal(width, 10);
    assert.equal(lanes.get('p2'), lanes.get('p4'));
    assert.notEqual(lanes.get('p1'), lanes.get('p2'));
    assert.equal(lanes.has('p3'), false);
    assert.deepEqual(placedTextLanes([]), { lanes: new Map(), count: 0, width: 0 });
    assert.equal(placedTextLanes([ranges[2]]).width, 0);
});

test('半開区間と部分重なり、無音中の次行への札、末尾より後/空の行列を扱う', () => {
    const sparse = [{ outStart: 0, outEnd: 2 }, { outStart: null, outEnd: null }, { outStart: 5, outEnd: 8 }];
    const ranges = placedTextRanges([
        caption('a', 1, 5, 'output'), caption('b', 2, 3, 'output'), caption('c', 8, 9, 'output'),
        caption('source', 0, 8, 'source')
    ], sparse);
    assert.deepEqual(ranges.map(({ captionId, first, last }) => [captionId, first, last]), [['a', 0, 0], ['b', 2, 2]]);
    assert.deepEqual(placedTextRanges(captions, []), []);
});

test('素材秒ではなく速度変更後の出力秒と重ねる', () => {
    const mapped = buildDaihonRows([caption('r1', 10, 14), caption('r2', 14, 18)],
        [{ kind: 'src', in: 10, out: 18, outStart: 0, outEnd: 4, speed: 2, cutIndex: 0 }]);
    const [range] = placedTextRanges([caption('p', 1, 3, 'output')], mapped);
    assert.deepEqual([range.first, range.last], [0, 1]);
});

test('字幕の入力順に左右されず id 順の色・列になる。元配列は不変', () => {
    const reversed = captions.slice().reverse();
    assert.deepEqual(placedTextRanges(reversed, rows), placedTextRanges(captions, rows));
    assert.deepEqual(reversed.map(item => item.id), ['p4', 'p3', 'p2', 'p1']);
    const spans = placedTextRanges([caption('b', 12, 24, 'output'), caption('a', 0, 16, 'output')], rows);
    assert.equal(placedTextLanes(spans).count, 2);
});

test('範囲操作は 1 行ずつ出力境界へ動かし、反対側の秒は保持する', () => {
    const [range] = placedTextRanges([caption('p', 4.5, 15.5, 'output')], rows);
    assert.deepEqual(placedTextTiming(range, rows, 'expand-start'), { start: 0, end: 15.5 });
    assert.deepEqual(placedTextTiming(range, rows, 'shrink-start'), { start: 8, end: 15.5 });
    assert.deepEqual(placedTextTiming(range, rows, 'expand-end'), { start: 4.5, end: 20 });
    assert.deepEqual(placedTextTiming(range, rows, 'shrink-end'), { start: 4.5, end: 12 });
    assert.deepEqual(placedTextTiming(range, rows, 'all'), { start: 0, end: 32 });
    const [all] = placedTextRanges([captions[0]], rows);
    for (const action of ['expand-start', 'expand-end', 'all']) assert.equal(placedTextTiming(all, rows, action), null);
    const [single] = placedTextRanges([captions[2]], rows);
    for (const action of ['shrink-start', 'shrink-end']) assert.equal(placedTextTiming(single, rows, action), null);
});

test('カット行は範囲編集の時刻境界に使わない', () => {
    const cutRows = rows.map((row, index) => index === 4 ? { ...row, outStart: null, outEnd: null } : row);
    const range = placedTextRanges(captions, cutRows).find(item => item.captionId === 'p2');
    assert.deepEqual(placedTextTiming(range, cutRows, 'expand-end'), { start: 4, end: 24 });
});

test('札のドロップ先から出力区間を決める: 1 行・複数行・カット行・末尾', () => {
    const [one] = placedTextRanges([caption('one', 4, 8, 'output')], rows);
    assert.deepEqual(placedTextDropTiming(one, rows, 3), { start: 12, end: 16 });
    assert.equal(placedTextDropTiming(one, rows, 1), null);
    const [three] = placedTextRanges([caption('three', 4, 16, 'output')], rows);
    assert.deepEqual(placedTextDropTiming(three, rows, 4), { start: 16, end: 28 });
    assert.equal(placedTextDropTiming(three, rows, 6), null, '末尾に 3 行収まらない');
    const cutRows = rows.map((row, index) => index === 4 ? { ...row, outStart: null, outEnd: null } : row);
    assert.equal(placedTextDropTiming(three, cutRows, 4), null, 'カット行へは落とせない');
    assert.deepEqual(placedTextDropTiming(three, cutRows, 3), { start: 12, end: 28 }, 'カット行は行数に数えない');
    assert.equal(placedTextDropTiming(three, cutRows, -1), null);
});
