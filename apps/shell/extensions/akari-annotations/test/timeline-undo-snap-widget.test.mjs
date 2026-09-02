import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// task 2026-09-02-timeline-undo-snap-fixes: widget 側の配線を文字列で固定する（既存テストの流儀）。
const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
const protocol = readFileSync(join(here, '..', 'src', 'common', 'akari-annotations-protocol.ts'), 'utf8');

function between(source, startNeedle, endNeedle) {
    const start = source.indexOf(startNeedle);
    assert.notEqual(start, -1, `${startNeedle} が見つかりません`);
    const end = source.indexOf(endNeedle, start);
    assert.notEqual(end, -1, `${endNeedle} が見つかりません`);
    return source.slice(start, end);
}

test('スナップは 0.25 秒グリッドへ落ちない（グリッド定数と snapToGrid の残存 0 件）', () => {
    assert.doesNotMatch(widget, /SNAP_GRID_SECONDS/);
    assert.doesNotMatch(widget, /snapToGrid\(/);
    assert.match(widget, /import \{[\s\S]*resolveSnapRange,[\s\S]*resolveSnapTime,[\s\S]*\} from '\.\.\/common\/timeline-snap'/);
});

test('吸着候補は見えている端だけ（単語境界・直前クリック位置は候補に入れない）', () => {
    const output = between(widget, 'protected outputSnapCandidates(', 'protected sourceSnapCandidates(');
    assert.doesNotMatch(output, /wordBoundaries/);
    assert.doesNotMatch(output, /selectedSourceT/);
    assert.match(output, /this\.segments/);
    assert.match(output, /this\.timelineTreeRows/);
    assert.match(output, /captionRangeToOutputRanges\(caption\.id/);
    assert.match(output, /this\.audioSfx/);
    assert.match(output, /this\.audioNarration/);
    assert.match(output, /isPlayhead: true/);
    const source = between(widget, 'protected sourceSnapCandidates(', 'protected snapExclusionsFor(');
    assert.doesNotMatch(source, /wordBoundaries/);
    assert.doesNotMatch(source, /selectedSourceT/);
    // cut-trim の呼び出しでも単語境界を出力秒へ射影して混ぜない
    const cutTrim = between(widget, 'const movingEdge = state.edge === \'left\' ? rawSpanStart : rawSpanEnd;', 'snapped = snap.snapped;');
    assert.doesNotMatch(cutTrim, /wordBoundaries/);
});

test('ガイド線は吸着したときだけ出す', () => {
    const reflect = between(widget, 'protected reflectSnapGuide(', 'protected outputSnapCandidates(');
    assert.match(reflect, /if \(result\.snapped && result\.candidate && showGuide\)/);
    assert.match(reflect, /else \{\s*this\.hideSnapGuide\(\);/);
});

test('マグネットの既定は保存値（未設定なら OFF）で、切替は永続化する', () => {
    assert.match(widget, /protected snapEnabled = readStoredSnapEnabled\(/);
    assert.doesNotMatch(widget, /protected snapEnabled = true;/);
    const setter = between(widget, 'protected setSnapEnabled(value: boolean): void {', 'protected updateSnapButton(');
    assert.match(setter, /writeStoredSnapEnabled\(/);
});

test('字幕削除の undo は time_domain / text_style を含む行を丸ごと戻す', () => {
    const remove = between(widget, 'protected async performDeleteSelected(): Promise<void> {', 'protected async performDeleteMultiSelected(');
    assert.match(remove, /timeDomain: caption\.timeDomain/);
    assert.match(remove, /textStyle: caption\.textStyle/);
    assert.match(protocol, /export interface CaptionWritePayload \{[\s\S]*timeDomain\?: 'source' \| 'output';[\s\S]*textStyle\?: CaptionTextStyle;[\s\S]*\}/);
    assert.match(protocol, /import type \{[^}]*CaptionTextStyle[^}]*\} from '@akari-video\/edit-store'/);
});

test('右クリック削除は captions 袋の写し（tree item）を captions.json の行として削除する', () => {
    const remove = between(widget, 'protected async performDeleteSelected(): Promise<void> {', 'protected async performDeleteMultiSelected(');
    assert.match(remove, /selection\.kind === 'item' && selection\.itemKind === 'caption'/);
    assert.match(remove, /captionIdForTreeSelection\(selection/);
    assert.match(remove, /this\.rawV2Item\(selection\.id\) === undefined/);
});

test('undo / redo の失敗は理由つきで知らせる', () => {
    const apply = between(widget, 'protected applyHistoryExecution(execution: HistoryExecution): void {', 'protected copySelectedItem(');
    assert.match(apply, /this\.errorMessage\(execution\.error\)/);
    assert.match(apply, /this\.showNotice\(message\)/);
    assert.doesNotMatch(apply, /元に戻せませんでした（対象が変更されています）/);
});
