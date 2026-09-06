import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretCaptionsResult } from '../lib/common/captions-result.js';

test('標準エラーに案内があっても成功時の字幕 JSON を返す', () => {
    assert.deepEqual(interpretCaptionsResult(0, '{"captions":3,"path":"/tmp/captions.json"}\n', '字幕トラックを宣言してください'), { captions: 3, path: '/tmp/captions.json' });
});
test('手直し済み字幕による終了コード1の場合だけ上書き確認を求める', () => {
    assert.deepEqual(interpretCaptionsResult(1, '', '手直し済みの字幕があります'), { needsForce: true });
    assert.throws(() => interpretCaptionsResult(2, '', '手直し済み'), /手直し済み/);
});
test('その他の失敗と不正な JSON はエラーにする', () => {
    assert.throws(() => interpretCaptionsResult(1, '', '発話がありません'), /発話がありません/);
    for (const stdout of ['', 'null', '[]', 'broken']) assert.throws(() => interpretCaptionsResult(0, stdout, ''));
});
