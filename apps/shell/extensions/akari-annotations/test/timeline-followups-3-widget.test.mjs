import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// task 2026-09-02-timeline-followups-3: オーナー実機 2 回目の報告 3 点の配線を文字列で固定する。
const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

function between(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} が見つかりません`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `${endNeedle} が見つかりません`);
    return source.slice(start, end);
}

test('字幕は 0 秒より前へ置けない（source 時間軸の move / start 端も max(0)）', () => {
    const branch = between(widget, "let timeDomain: 'source' | 'output' = state.originalTimeDomain ?? 'source';", "if (state.kind === 'layer') {");
    assert.doesNotMatch(branch, /\n\s*start = snap\.time;/);
    assert.match(branch, /start = Math\.max\(0, snap\.time\);[\s\S]*start = Math\.max\(0, snap\.time\);/);
    assert.match(branch, /\n\s*start = Math\.max\(0, start\);/);
    // 正当な位置が作れないときはドラッグ前の区間へ戻す
    assert.match(branch, /fallback: timeDomain === 'output' && state\.originalTimeDomain !== 'output'/);
});

test('音声クリップの端トリム（IN / OUT）もマグネットを通す', () => {
    const branch = between(widget, "if (state.kind === 'audio-trim') {", "if (state.kind === 'audio-slip') {");
    assert.equal(branch.split('this.snapTimeInOutputSpaceWithResult(').length - 1, 2);
    assert.match(branch, /\{ kind: 'audio', id: state\.id \}/);
    assert.match(branch, /this\.setGhostSnapped\(state\.ghost, snapped\)/);
    // 吸着後に実尺・最小尺の制約を掛け直す
    assert.match(branch, /const rawInput = state\.originalIn \+ \(snap\.time - state\.originalT\);[\s\S]*MINIMUM_SFX_TRIM_DURATION/);
    assert.match(branch, /const rawOutput = state\.originalIn \+ \(snap\.time - state\.originalT\);[\s\S]*maxOutSeconds !== undefined \? Math\.min\(rawOutput, maxOutSeconds\)/);
});

test('source 時間軸の字幕は出力時間軸に置かれた物の端（セグメント内）へも吸着する', () => {
    const helper = between(widget, 'protected sourceSnapCandidates(', 'protected snapExclusionsFor(');
    assert.match(helper, /this\.outputSnapCandidates\(\[\], exclude\)/);
    assert.match(helper, /!candidate\.isPlayhead/);
    assert.match(helper, /this\.outputToSource\(candidate\.time\)/);
});

test('captions 袋の帯チップと目盛りは描かない（html 袋だけ）', () => {
    assert.doesNotMatch(widget, /tree-bag:/);
    assert.doesNotMatch(widget, /akari-timeline-tree-bag/);
    assert.match(widget, /this\.timelineTreeRows\.filter\(row => row\.hasChildren && row\.sourceKind === 'html'\)/);
    assert.doesNotMatch(widget, /row\.sourceKind === 'captions' \|\| row\.sourceKind === 'html'\)\)\) \{/);
});
