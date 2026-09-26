import assert from 'node:assert/strict';
import test from 'node:test';
import { editCorrectionVisible } from '../lib/browser/inspector/edit-correction-visibility.js';

const cases = [
  ['done の写真', 'tiles', 'still', 'done', true],
  ['ふつうの写真', 'tiles', 'still', undefined, true],
  ['空の枠', 'tiles', 'empty-frame', 'planned', false],
  ['状態なしの空の枠', 'tiles', 'empty-frame', undefined, false],
  ['空の音声枠', 'tiles', 'empty-audio-frame', undefined, false],
  ['生成中の静止画', 'tiles', 'still', 'generating', false],
  ['生成予定の静止画', 'tiles', 'still', 'planned', false],
  ['stale の静止画', 'tiles', 'still', 'stale', false],
  ['failed の静止画', 'tiles', 'still', 'failed', false],
  ['静止画パネル', 'still', 'still', 'done', false],
  ['動画パネル', 'video', 'still', 'done', false],
  ['ナレーションパネル', 'narration', 'audio', undefined, false],
  ['文字起こしパネル', 'transcribe', 'video', undefined, false],
  ['ふつうの動画', 'tiles', 'video', undefined, true],
  ['生成済み動画', 'tiles', 'generated-video', 'done', true],
  ['動画予定の下書きがある静止画', 'tiles', 'still', 'done', true]
];

for (const [name, aiView, targetKind, generationState, visible] of cases) {
  test(`編集の補正表示: ${name}`, () => {
    assert.equal(editCorrectionVisible({ aiView, targetKind, generationState }), visible);
  });
}
