// 不具合メモ 第3項 — Web プレビューの極端なカクつき。
//
// Zoom 側の 620 秒付近で約 1fps になる区間を観測し、短いキーフレーム間隔の互換プレビュー用
// 動画へ替えたら同区間で約 30fps の継続再生になった。つまり症状の主因は「長い GOP の素材を
// そのまま復号していたこと」だが、**プレビューの素材選択はこれを見ていなかった**。
//
// chooseSource（packages/frame-engine/src/decode/source-selection.ts）はコーデックの復号可否
// だけで判定し、support.hw が立てば常に原本を選ぶ（reason: 'hardware-ok'）。ハードウェアで
// 復号できる長 GOP 原本はこの経路を通り、シークのたびに直前のキーフレームから復号し直すため
// 遅くなる。edit-lint の source.proxy-long-gop は閾値 2 秒で警告するが、**宣言済みプロキシ
// だけ**を見ており原本は対象外だった。
//
// 索引（keyframeTimesUs）は全ソースで既に作っているので、最大間隔の算出に追加の読み取りは
// 要らない。ここではその算出と、閾値超過で警告が出ることを固定する。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { LONG_GOP_WARNING_SECONDS, maxKeyframeIntervalSeconds } from '../dist/index.js';

// KeyframeIndex のうち、最大間隔の算出が読むものだけを持つ最小形。
function indexOf(keyframeSeconds, { durationSec, lastFrameStartSec } = {}) {
    return {
        keyframeTimesUs: keyframeSeconds.map(seconds => Math.round(seconds * 1e6)),
        presentationDurationUs: durationSec === undefined ? null : Math.round(durationSec * 1e6),
        lastFrameStartUs: lastFrameStartSec === undefined ? null : Math.round(lastFrameStartSec * 1e6),
    };
}

test('閾値は edit-lint の source.proxy-long-gop と同じ 2 秒', () => {
    assert.equal(LONG_GOP_WARNING_SECONDS, 2);
});

test('等間隔の GOP はその間隔を返す', () => {
    // 1 秒 GOP（製品のプロキシレシピ gop1s-v1 が出す形）は閾値以下。
    const short = maxKeyframeIntervalSeconds(indexOf([0, 1, 2, 3, 4], { durationSec: 5 }));
    assert.equal(short, 1);
    assert.ok(short <= LONG_GOP_WARNING_SECONDS, '1 秒 GOP は警告しない');

    // 現場の一眼プロキシ（GOP15 @ 約30fps = 0.5 秒）も閾値以下。
    const halfSecond = maxKeyframeIntervalSeconds(indexOf([0, 0.5, 1, 1.5], { durationSec: 2 }));
    assert.equal(halfSecond, 0.5);
});

test('カメラ原本のような長い GOP は閾値を超える（第3項の条件）', () => {
    // 10 秒間隔（民生カメラの長 GOP 相当）。
    const long = maxKeyframeIntervalSeconds(indexOf([0, 10, 20, 30], { durationSec: 40 }));
    assert.equal(long, 10);
    assert.ok(long > LONG_GOP_WARNING_SECONDS);
});

test('不均等なら最大の区間を返す（平均で薄めない）', () => {
    const value = maxKeyframeIntervalSeconds(indexOf([0, 1, 2, 12, 13], { durationSec: 14 }));
    assert.equal(value, 10);
});

test('末尾も 1 区間として数える（末尾に長い GOP がある素材を見逃さない）', () => {
    // キーフレームは 1 秒間隔なのに、最後のキーフレームから素材末尾まで 9 秒ある。
    const value = maxKeyframeIntervalSeconds(indexOf([0, 1, 2], { durationSec: 11 }));
    assert.equal(value, 9);
});

test('presentationDurationUs が無ければ lastFrameStartUs で代替する', () => {
    const value = maxKeyframeIntervalSeconds(indexOf([0, 1], { lastFrameStartSec: 8 }));
    assert.equal(value, 7);
});

test('測れないときは undefined（判定しない）', () => {
    assert.equal(maxKeyframeIntervalSeconds(indexOf([])), undefined, 'キーフレーム 0 枚');
    assert.equal(
        maxKeyframeIntervalSeconds(indexOf([0])),
        undefined,
        'キーフレーム 1 枚で素材尺も不明なら測れない'
    );
    // キーフレーム 1 枚でも素材尺が分かれば測れる。
    assert.equal(maxKeyframeIntervalSeconds(indexOf([0], { durationSec: 5 })), 5);
});

test('RangeMp4Source は索引を作った直後に閾値超過を onWarning へ出す（再発防止）', () => {
    const source = readFileSync(
        fileURLToPath(new URL('../src/decode/range-mp4-source.ts', import.meta.url)),
        'utf8'
    );
    const prepare = source.slice(source.indexOf('const [table, keyframes] = await Promise.all('));
    assert.match(prepare, /const gopSeconds = maxKeyframeIntervalSeconds\(keyframes\);/u);
    assert.match(prepare, /gopSeconds !== undefined && gopSeconds > LONG_GOP_WARNING_SECONDS/u);
    assert.match(prepare, /this\.options\.onWarning\?\.\(/u);
    // 直し方（GOP 1 秒以下へ焼き直す）を案内に含める。edit-lint の文面と同じ ffmpeg 引数。
    assert.match(prepare, /-g <fps> -keyint_min <fps> -sc_threshold 0 -bf 0/u);
});

test('索引の構築自体は警告の有無で変わらない（判定は読むだけ）', () => {
    // maxKeyframeIntervalSeconds は渡された索引を書き換えない。
    const index = indexOf([0, 10, 20], { durationSec: 30 });
    const before = JSON.stringify(index);
    maxKeyframeIntervalSeconds(index);
    assert.equal(JSON.stringify(index), before);
});
