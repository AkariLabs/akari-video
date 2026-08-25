import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

const method = (startNeedle, endNeedle) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  assert.ok(start >= 0 && end > start, `${startNeedle} .. ${endNeedle}`);
  return source.slice(start, end);
};

test('種別選択だけが autoHandle を要求し、尺スライダーと削除は既存経路を保つ', () => {
  const popup = method('protected openTransitionPopup', 'protected async applyTransitionOut');
  assert.match(popup, /type: option\.type,[\s\S]*\}, \{ autoHandle: true \}\)/u);
  assert.match(popup, /type: current\.type, duration: Number\(slider\.value\)[\s\S]*\}\)\.then\(render\)/u);
  assert.doesNotMatch(popup, /slider\.value\)[\s\S]{0,80}autoHandle/u);
  assert.match(popup, /applyTransitionOut\(earlierIndex, null\)/u);
});

test('突き合わせ境界は edit-store の宣言+延長手術を text commit 1 回だけで保存する', () => {
  const apply = method('protected async applyTransitionOut', 'protected nextSameTrackSegment');
  assert.match(apply, /cutOverlapFrames\(earlier, later, this\.fps\) === 0/u);
  assert.equal((apply.match(/commitEditTextMutation\(/gu) ?? []).length, 1);
  assert.equal((apply.match(/setV2TransitionOutWithHandleInSource\(/gu) ?? []).length, 1);
  assert.ok(
    apply.indexOf('setV2TransitionOutWithHandleInSource') > apply.indexOf('commitEditTextMutation'),
    apply,
  );
});

test('text commit は before/after 1 組を 1 history に積み、undo/redo が同じ組を往復する', () => {
  const commit = method('protected async commitEditTextMutation', 'protected async writeEditSnapshotGuarded');
  assert.equal((commit.match(/this\.pushHistory\(/gu) ?? []).length, 1);
  assert.match(commit, /undo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(before\)/u);
  assert.match(commit, /redo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(after\)/u);
  assert.doesNotMatch(commit, /stringifyEditV2/u);
});

test('部分・不能は日本語通知され、不能と layers 退避は警告バッジ導線を持つ', () => {
  assert.match(source, /トランジションが \$\{seconds\} 秒に短くなります（素材の余りが足りません）/u);
  assert.match(source, /このトランジションは効きません: 素材に余りがありません/u);
  assert.match(source, /zeroOverlapTransitionIndexes\.has\(cutIndex\)/u);
  assert.match(source, /dataset\.akariLayerTransitionWarning = layer\.id/u);
  assert.match(source, /他トラックのアイテム（\$\{cause\.causeItemId\}）.*PiP 経路へ退避/u);
});
