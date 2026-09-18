// 不具合メモ 第16項（シェル側）— 最終フレームの次の終端位置で右の人物だけ消える。
//
// 追加映像の表示判定は frame-engine の isLayerActiveAt が半開区間（frame < endFrame）なので、
// 総尺ぶんのフレーム番号（= 最後の有効フレームの次）を要求すると、ベース映像の最後の画だけが
// 残って追加レイヤーが消える。preview-server 側（packages/preview-server/test/
// preview-end-frame-request.test.mjs）と同じ症状で、シェルは open-handler 内のインライン実装
// （frameEngineClock）が同型の丸めをしていた。
//
// 実機の再現条件（案件 2026-09-15-new-video）: bookend-outro-left / bookend-outro-right が
// ともに開始 158401・長さ 281、総尺 158682 フレーム / 30fps = 5289.4 秒。最終有効フレーム
// 158681（88:09.366667）では左右とも表示され、終端 158682（88:09.40）で右が黒くなる。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const handlerPath = fileURLToPath(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url));
const source = await readFile(handlerPath, 'utf8');

const section = (text, start, end) => {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `${start} … ${end}`);
    return text.slice(from, to);
};

// requestSeek / renderPlayback は `const clock = {` より前に定義されているので、
// 検査範囲はヘルパー定義から clock の終わりまでを一続きに取る。
const clockSection = section(
    source,
    '                const renderableFrame = () =>',
    '                const summaryWithLivePreview ='
);

// open-handler から renderableSeconds / renderableFrame の本体を取り出して実行する。
// スタブではなく実装そのものを動かすことで、規律のずれを検知できる。
function loadRenderableSeconds(totalDuration, fps) {
    const body = section(
        source,
        '                const renderableFrame = () =>',
        '                const requestSeek = seconds =>'
    );
    const factory = new Function('totalDuration', 'fps', `
        ${body}
        return { renderableFrame, renderableSeconds };
    `);
    return factory(totalDuration, fps);
}

// frame-engine の可視判定（packages/frame-engine/src/timeline/plan.ts isLayerActiveAt）と同型。
// 半開区間であることが第16項の前提なので、ここも実装に合わせて書く。
function isLayerActiveAt(frame, layer, fps) {
    const startFrame = Math.max(0, Math.round(layer.t * fps));
    const endFrame = Math.max(startFrame, Math.ceil((layer.t + Math.max(0, layer.duration)) * fps - 1e-6));
    return frame >= startFrame && frame < endFrame;
}

const FPS = 30;
const TOTAL_FRAMES = 158682;
const TOTAL_DURATION = TOTAL_FRAMES / FPS;
// 実機の bookend 2 枚（左右とも同じ開始・同じ長さ）。
const OUTRO = { t: 158401 / FPS, duration: 281 / FPS };

test('第16項の再現: 終端位置のフレーム番号は追加映像の半開区間から外れる', () => {
    const lastValid = TOTAL_FRAMES - 1;
    assert.equal(isLayerActiveAt(lastValid, OUTRO, FPS), true, '最終有効フレームでは追加映像が見える');
    assert.equal(isLayerActiveAt(TOTAL_FRAMES, OUTRO, FPS), false, '終端位置では追加映像が消える（これが症状）');
});

test('renderableSeconds は終端位置の要求を最後の有効フレームへ揃える', () => {
    const { renderableFrame, renderableSeconds } = loadRenderableSeconds(TOTAL_DURATION, FPS);
    assert.equal(renderableFrame(), TOTAL_FRAMES - 1);

    // 総尺そのまま・総尺超え・総尺の半フレーム手前（自然再生の丸めで終端へ飛ぶ位置）。
    for (const requested of [TOTAL_DURATION, TOTAL_DURATION + 1, TOTAL_DURATION - 0.5 / FPS]) {
        const frame = Math.round(renderableSeconds(requested) * FPS);
        assert.equal(frame, TOTAL_FRAMES - 1, `要求 ${requested} が最終有効フレームへ揃う`);
        assert.equal(isLayerActiveAt(frame, OUTRO, FPS), true, `要求 ${requested} で追加映像が見える`);
    }
});

test('renderableSeconds は終端以外の時刻と 0 を変えない', () => {
    const { renderableSeconds } = loadRenderableSeconds(TOTAL_DURATION, FPS);
    for (const requested of [0, 1, 110, 5280, (TOTAL_FRAMES - 2) / FPS]) {
        assert.equal(Math.round(renderableSeconds(requested) * FPS), Math.round(requested * FPS));
    }
    assert.equal(renderableSeconds(-5), 0, '負の要求は 0 へ');
    assert.equal(renderableSeconds(Number.NaN), 0, '非数は 0 へ');
});

test('fps や総尺が未確定のときはクランプせず素の値を返す（初期化中に 0 へ落とさない）', () => {
    for (const [total, fps] of [[0, 30], [TOTAL_DURATION, 0], [0, 0]]) {
        const { renderableSeconds } = loadRenderableSeconds(total, fps);
        assert.equal(renderableSeconds(1.5), Math.max(0, Math.min(1.5, total)));
    }
});

test('描画要求の経路すべてが renderableSeconds を通る', () => {
    // requestSeek（scrub 経路の唯一の入口）と renderPlayback（自然再生）。
    assert.match(clockSection, /const requestSeek = seconds => \{\s*const frameNumber = Math\.round\(renderableSeconds\(seconds\) \* fps\);/u);
    assert.match(clockSection, /const renderPlayback = seconds => \{\s*const frameNumber = Math\.round\(renderableSeconds\(seconds\) \* fps\);/u);
    // 編集適用後の位置復元（尺が縮むと終端フレームになる経路）。clock の外側にあるので
    // ファイル全体から探す。
    assert.match(source, /position = Math\.round\(renderableSeconds\(position\) \* fps\) \/ fps;/u);
    // 旧実装の素の丸めが残っていないこと。
    assert.doesNotMatch(source, /Math\.round\(Math\.max\(0, Math\.min\(position, totalDuration\)\) \* fps\) \/ fps/u);
    assert.doesNotMatch(clockSection, /const clamped = Math\.max\(0, Math\.min\(seconds, totalDuration\)\);\s*const frameNumber/u);
});

test('尺そのもの（totalDuration・停止判定・時刻表示）は変えていない', () => {
    // 右クリップを 1 フレーム延ばして隠す対処をしていないこと = 停止は totalDuration 基準のまま。
    assert.match(clockSection, /setPlaying\(false, totalDuration\)/u);
    // renderableSeconds は totalDuration を書き換えず、要求時刻だけを丸める。
    const body = section(
        source,
        '                const renderableFrame = () =>',
        '                const requestSeek = seconds =>'
    );
    assert.doesNotMatch(body, /totalDuration\s*=/u, 'renderableSeconds は totalDuration へ代入しない');
});
