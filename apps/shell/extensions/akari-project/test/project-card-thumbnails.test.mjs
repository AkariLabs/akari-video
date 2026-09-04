import test from 'node:test';
import assert from 'node:assert/strict';
import {
    deriveEditTimelineSamples,
    deriveProjectCardTimestamps,
    parseProjectCardFrameIndex,
    projectCardFrameFileName,
    projectCardFrameRelativePath,
    PROJECT_CARD_CACHE_DIRECTORY,
    readContactSheetTimestamps,
    readPlannedDurationSeconds,
    selectRenderedOutputPath
} from '../lib/node/project-card-thumbnails.js';

// プロジェクトカードのサムネ（ポスター + ホバーでループするコマ）の純ロジック。
// 「素材だけ → edit.json で編集済み → 書き出し済み」の 3 段のうち、
// 「どの動画の・どの時刻を抜くか」を決める部分だけをここで固定する。

test('selectRenderedOutputPath: artifacts[].path を最優先で返す', () => {
    const state = {
        artifacts: [{ path: 'exports/final.mp4', sha256: 'abc' }],
        plan: { output: 'exports/planned.mp4' }
    };
    assert.equal(selectRenderedOutputPath(state), 'exports/final.mp4');
});

test('selectRenderedOutputPath: artifacts が空なら plan.output へ落ちる', () => {
    assert.equal(selectRenderedOutputPath({ artifacts: [], plan: { output: 'exports/planned.mp4' } }), 'exports/planned.mp4');
});

test('selectRenderedOutputPath: 何も無ければ undefined（呼び出し側が次の段へ落ちる）', () => {
    assert.equal(selectRenderedOutputPath(undefined), undefined);
    assert.equal(selectRenderedOutputPath({}), undefined);
    assert.equal(selectRenderedOutputPath({ artifacts: [{ path: '' }], plan: { output: 42 } }), undefined);
});

test('readContactSheetTimestamps: 数値だけを昇順で拾い、壊れた値は捨てる', () => {
    const state = { contact_sheet: { timestamps_seconds: [12.5, 'x', 0, null, 3.25, NaN, -1] } };
    assert.deepEqual(readContactSheetTimestamps(state), [0, 3.25, 12.5]);
    assert.deepEqual(readContactSheetTimestamps({}), []);
    assert.deepEqual(readContactSheetTimestamps({ contact_sheet: { timestamps_seconds: 'nope' } }), []);
});

test('readPlannedDurationSeconds: 正の数だけを尺として認める', () => {
    assert.equal(readPlannedDurationSeconds({ plan: { predicted_duration_seconds: 100.9 } }), 100.9);
    assert.equal(readPlannedDurationSeconds({ plan: { predicted_duration_seconds: 0 } }), undefined);
    assert.equal(readPlannedDurationSeconds({}), undefined);
});

test('deriveProjectCardTimestamps: contact sheet の代表時刻を最優先で使う', () => {
    const timestamps = deriveProjectCardTimestamps({ contactSheetTimestamps: [2, 5, 9], durationSeconds: 100 });
    assert.deepEqual(timestamps, [2, 5, 9]);
});

test('deriveProjectCardTimestamps: contact sheet が多すぎれば端を残して等間隔に間引く', () => {
    const timestamps = deriveProjectCardTimestamps({ contactSheetTimestamps: [1, 2, 3, 4, 5, 6, 7, 8, 9], count: 5 });
    assert.equal(timestamps.length, 5);
    assert.equal(timestamps[0], 1);
    assert.equal(timestamps[timestamps.length - 1], 9);
});

test('deriveProjectCardTimestamps: 冒頭 0 秒（黒コマになりがち）は他に候補があれば落とす', () => {
    assert.deepEqual(deriveProjectCardTimestamps({ contactSheetTimestamps: [0, 4, 8] }), [4, 8]);
    // 唯一の候補なら残す（絵が 1 枚も無くなるほうが悪い）。
    assert.deepEqual(deriveProjectCardTimestamps({ contactSheetTimestamps: [0] }), [0]);
});

test('deriveProjectCardTimestamps: contact sheet が無ければ尺を等分割する（冒頭と末尾を避ける）', () => {
    const timestamps = deriveProjectCardTimestamps({ durationSeconds: 60, count: 5 });
    assert.deepEqual(timestamps, [10, 20, 30, 40, 50]);
});

test('deriveProjectCardTimestamps: 尺も分からなければ 1 枚だけ（1.0 秒地点）', () => {
    assert.deepEqual(deriveProjectCardTimestamps({}), [1]);
});

test('deriveEditTimelineSamples: v1（sources[] + cuts[].src）で組んだ順・組んだ範囲の絵になる', () => {
    const edit = {
        version: 1,
        sources: [
            { id: 'base', path: 'assets/base.mp4' },
            { id: 'endcard', path: 'assets/endcard.mp4' }
        ],
        cuts: [
            { src: 'base', in: 10, out: 90 },
            { src: 'endcard', in: 0, out: 20 }
        ]
    };
    // 出力尺は 80 + 20 = 100 秒。等分割の 5 点は 16.67 / 33.3 / 50 / 66.7 / 83.3 秒。
    const samples = deriveEditTimelineSamples(edit, 5);
    assert.equal(samples.length, 5);
    // 冒頭 4 点は base（0〜80 秒）で、in=10 のぶんだけ元動画側がずれる。
    assert.equal(samples[0].sourcePath, 'assets/base.mp4');
    assert.ok(Math.abs(samples[0].sourceSeconds - 26.667) < 0.01);
    // 末尾は endcard 側（80〜100 秒）へ渡る。
    assert.equal(samples[4].sourcePath, 'assets/endcard.mp4');
    assert.ok(Math.abs(samples[4].sourceSeconds - 3.333) < 0.01);
});

test('deriveEditTimelineSamples: v0（トップレベル source・cuts に src 無し）も引ける', () => {
    const edit = {
        version: 0,
        source: { path: 'source/recording.mp4' },
        cuts: [{ in: 100, out: 200 }]
    };
    const samples = deriveEditTimelineSamples(edit, 3);
    assert.equal(samples.length, 3);
    assert.ok(samples.every(sample => sample.sourcePath === 'source/recording.mp4'));
    // 出力 0〜100 秒 → 25 / 50 / 75 秒。元動画では in=100 を足した位置。
    assert.deepEqual(samples.map(sample => sample.sourceSeconds), [125, 150, 175]);
});

test('deriveEditTimelineSamples: speed は元動画側の進みに効く', () => {
    const edit = {
        version: 0,
        source: { path: 'a.mp4' },
        cuts: [{ in: 0, out: 40, speed: 2 }]
    };
    // 出力尺は 40 / 2 = 20 秒。出力 10 秒地点 = 元動画 20 秒地点。
    const samples = deriveEditTimelineSamples(edit, 1);
    assert.deepEqual(samples, [{ sourcePath: 'a.mp4', sourceSeconds: 20 }]);
});

test('deriveEditTimelineSamples: track が上のカットが重なりに勝つ', () => {
    const edit = {
        version: 1,
        sources: [{ id: 'bg', path: 'bg.mp4' }, { id: 'pip', path: 'pip.mp4' }],
        cuts: [
            { src: 'bg', in: 0, out: 20, track: 0, at: 0 },
            { src: 'pip', in: 0, out: 20, track: 1, at: 0 }
        ]
    };
    const samples = deriveEditTimelineSamples(edit, 1);
    assert.equal(samples[0].sourcePath, 'pip.mp4');
});

test('deriveEditTimelineSamples: freeze の停止尺だけ後続カットの位置が後ろへずれる', () => {
    const edit = {
        version: 1,
        sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
        cuts: [
            { src: 'a', in: 0, out: 10, freeze: { at_sec: 5, duration_sec: 10 } },
            { src: 'b', in: 0, out: 10 }
        ]
    };
    // a のセグメントは 10 + 10 = 20 秒ぶん占める。出力尺 30 秒の中点 15 秒はまだ a の中。
    const samples = deriveEditTimelineSamples(edit, 1);
    assert.equal(samples[0].sourcePath, 'a.mp4');
});

test('deriveEditTimelineSamples: カットが無い（素材を入れただけ）なら空 = 次の段へ落ちる', () => {
    assert.deepEqual(deriveEditTimelineSamples({ version: 1, sources: [], cuts: [] }, 5), []);
    assert.deepEqual(deriveEditTimelineSamples(undefined, 5), []);
    assert.deepEqual(deriveEditTimelineSamples({ version: 1, cuts: [{ in: 0, out: 0 }] }, 5), []);
});

test('deriveEditTimelineSamples: ソース参照が解けないカットは黙って落とす', () => {
    const edit = { version: 1, sources: [{ id: 'a', path: 'a.mp4' }], cuts: [{ src: 'missing', in: 0, out: 10 }] };
    assert.deepEqual(deriveEditTimelineSamples(edit, 3), []);
});

test('コマのファイル名と相対パスは 1 始まりの連番で往復する', () => {
    assert.equal(projectCardFrameFileName(0), 'frame-1.jpg');
    assert.equal(projectCardFrameRelativePath('abc123', 0), `${PROJECT_CARD_CACHE_DIRECTORY}/abc123/frame-1.jpg`);
    assert.equal(parseProjectCardFrameIndex('frame-1.jpg'), 0);
    assert.equal(parseProjectCardFrameIndex('frame-5.jpg'), 4);
    assert.equal(parseProjectCardFrameIndex('frame-0.jpg'), undefined);
    assert.equal(parseProjectCardFrameIndex('.tmp-123-frame-1.jpg'), undefined);
    assert.equal(parseProjectCardFrameIndex('poster.png'), undefined);
});
