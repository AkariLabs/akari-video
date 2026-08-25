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

test('種別選択・尺スライダー・削除は同じ宣言専用経路を使う', () => {
  const popup = method('protected openTransitionPopup', 'protected async applyTransitionOut');
  assert.match(popup, /type: option\.type,[\s\S]*\}\)\.then\(render\)/u);
  assert.match(popup, /type: currentType, duration: Number\(slider\.value\)[\s\S]*\}\)\.then\(render\)/u);
  assert.match(popup, /slider\.disabled = currentType === undefined/u);
  assert.doesNotMatch(popup, /autoHandle/u);
  assert.match(popup, /applyTransitionOut\(earlierIndex, null\)/u);
});

test('突き合わせ境界は単一定義で宣言尺だけをクランプし trim を書かない', () => {
  const apply = method('protected async applyTransitionOut', 'protected nextSameTrackSegment');
  assert.match(apply, /cutOverlapFrames\(earlier, later, this\.fps\) === 0/u);
  assert.match(apply, /transitionHandlePlan\(earlier, later, next\.duration\)/u);
  assert.match(apply, /roundTransitionDurationForWrite\(handle\.effectiveSeconds\)/u);
  assert.match(apply, /writtenNext = \{ \.\.\.next, duration: handle\.effectiveSeconds \}/u);
  assert.equal((apply.match(/commitEditMutation\(/gu) ?? []).length, 1);
  assert.doesNotMatch(apply, /setV2TransitionOutWithHandleInSource|autoHandle|maxExtendSeconds/u);
});

test('旧自動のりしろの削除救済だけが byte-preserving text commit を 1 回使う', () => {
  const apply = method('protected async applyTransitionOut', 'protected nextSameTrackSegment');
  assert.equal((apply.match(/commitEditTextMutation\(/gu) ?? []).length, 1);
  assert.match(apply, /areCutsAdjacent\(earlier, later, this\.fps\)/u);
  assert.match(apply, /removeV2TransitionOutWithHandleRetractInSource/u);
  assert.match(apply, /のりしろも戻しました/u);
  assert.match(apply, /クリップの重なりが残っています/u);
  assert.match(apply, /this\.showNotice\(message\)/u);
});

test('text commit は before/after 1 組を 1 history に積み、undo/redo が同じ組を往復する', () => {
  const commit = method('protected async commitEditTextMutation', 'protected async writeEditSnapshotGuarded');
  assert.equal((commit.match(/this\.pushHistory\(/gu) ?? []).length, 1);
  assert.match(commit, /undo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(before\)/u);
  assert.match(commit, /redo: async \(\) => \{[\s\S]*writeEditSnapshotGuarded\(after\)/u);
  assert.doesNotMatch(commit, /stringifyEditV2/u);
});

test('クランプ・不能は日本語通知され、不能と layers 退避は警告バッジ導線を持つ', () => {
  assert.match(source, /トランジションが \$\{seconds\} 秒に短くなります（素材の余りが足りません）/u);
  assert.match(source, /このトランジションは効きません: 素材に余りがありません/u);
  assert.match(source, /のりしろにできる素材の余りがない/u);
  assert.match(source, /zeroOverlapTransitionIndexes\.has\(cutIndex\)/u);
  assert.match(source, /dataset\.akariLayerTransitionWarning = layer\.id/u);
  assert.match(source, /他トラックのアイテム（\$\{cause\.causeItemId\}）.*PiP 経路へ退避/u);
});
