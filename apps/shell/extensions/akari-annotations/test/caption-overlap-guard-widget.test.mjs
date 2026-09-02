import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// task 2026-09-02-timeline-caption-overlap-guard: widget 側の配線を文字列で固定する（既存テストの流儀）。
const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

function between(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} が見つかりません`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `${endNeedle} が見つかりません`);
    return source.slice(start, end);
}

test('字幕ドラッグは move / start / end のすべてで隣の字幕へのクランプを通る', () => {
    const branch = between(widget, "let timeDomain: 'source' | 'output' = state.originalTimeDomain ?? 'source';", "if (state.kind === 'layer') {");
    assert.match(branch, /clampCaptionRangeToNeighbors\(\{[\s\S]*mode: state\.mode,[\s\S]*neighbors: this\.captionOverlapNeighbors\(state\.id, timeDomain\),[\s\S]*minDuration: MINIMUM_ITEM_DURATION/);
    // クランプは出力秒クランプ（clampCaptionOutputRange）の後・ゴースト描画の前に 1 回だけ
    const outputClamp = branch.indexOf('clampCaptionOutputRange(');
    const guard = branch.indexOf('clampCaptionRangeToNeighbors(');
    const ghost = branch.indexOf('this.setGhostRange(state.ghost, outputStart, outputEnd)');
    assert.ok(outputClamp < guard && guard < ghost);
    assert.equal(branch.split('clampCaptionRangeToNeighbors(').length - 1, 1);
    // source 時間軸はクランプ後に出力秒へ写し直す
    assert.match(branch, /outputStart = undefined;\s*outputEnd = undefined;/);
});

test('止まったことはドラッグ表示に出し、ゴーストは赤にしない', () => {
    const branch = between(widget, "let timeDomain: 'source' | 'output' = state.originalTimeDomain ?? 'source';", "if (state.kind === 'layer') {");
    assert.match(branch, /（隣の字幕で止まりました）/);
    assert.doesNotMatch(branch, /setGhostRejected\(state\.ghost, (true|blockedByNeighbor)\)/);
    assert.match(branch, /this\.setGhostSnapped\(state\.ghost, snapped && !blockedByNeighbor\)/);
});

test('隣の字幕は lint と同じ時間群で選ぶ（output 同士 / 同じ src 同士・自分は除く）', () => {
    const helper = between(widget, 'protected captionOverlapNeighbors(', 'protected captionRangeToOutputRanges(');
    assert.match(helper, /candidate\.id !== captionId && candidate\.timeDomain === 'output'/);
    assert.match(helper, /candidate\.timeDomain !== 'output'[\s\S]*this\.captionSourceForMapping\(candidate\.id\) === source/);
});
