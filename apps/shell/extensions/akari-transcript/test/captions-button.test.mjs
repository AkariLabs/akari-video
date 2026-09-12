import test from 'node:test';
import assert from 'node:assert/strict';
import { captionsAppliedLine, captionsApplyHistoryLabel, captionsApplyPreviewLine, captionsButtonLabel,
    daihonHistoryService, parseCaptionsApplyPreview, setDaihonHistoryService } from '../lib/common/captions-button.js';

test('処理済みの素材がなければ連続実行の文言を表示する', () => {
    for (const states of [[], ['none'], ['running'], ['none', 'running']]) {
        assert.equal(captionsButtonLabel(states), '文字起こしして字幕を作る');
    }
});
test('処理済みの素材があれば字幕生成の文言を表示する', () => {
    assert.equal(captionsButtonLabel(['done']), '字幕を作る');
    assert.equal(captionsButtonLabel(['none', 'done']), '字幕を作る');
});

test('差分要約は5つの有限数が揃ったときだけ受理する', () => {
    const preview = { added: 12, changed: 3, protected: 2, removed: 0, total: 17 };
    assert.deepEqual(parseCaptionsApplyPreview(preview), preview);
    for (const value of [null, {}, { ...preview, total: Infinity }, { ...preview, removed: '0' }]) {
        assert.equal(parseCaptionsApplyPreview(value), undefined);
    }
});

test('差分・反映済み・履歴の文言を組み立てる', () => {
    const preview = { added: 12, changed: 3, protected: 2, removed: 0, total: 17 };
    assert.equal(captionsApplyPreviewLine(preview), '新規 12 · 変更 3 · 手直し済み 2 行は保護 · 消える 0');
    assert.equal(captionsApplyPreviewLine({ ...preview, protected: 0 }), '新規 12 · 変更 3 · 消える 0');
    assert.equal(captionsAppliedLine(preview), '台本に反映した（新規 12 · 変更 3）');
    assert.equal(captionsApplyHistoryLabel(preview), '台本へ反映（新規 12 · 変更 3）');
});

test('台本履歴サービスをモジュール単位で保持する', () => {
    const service = { push() {} };
    setDaihonHistoryService(service);
    assert.equal(daihonHistoryService(), service);
    setDaihonHistoryService(undefined);
    assert.equal(daihonHistoryService(), undefined);
});
