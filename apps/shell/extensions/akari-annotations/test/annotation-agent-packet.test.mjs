import assert from 'node:assert/strict';
import test from 'node:test';

import { composeAnnotationAgentPacket } from '../lib/common/annotation-agent-packet.js';
import { composeBatchAnnotationHandoff } from '../lib/common/batch-annotation-handoff.js';

function packet(overrides = {}) {
    return composeAnnotationAgentPacket({
        id: 'a-0001',
        sourceT: 65,
        sourceRange: null,
        target: null,
        targetLabel: null,
        text: 'ここを直す',
        hasStrokes: false,
        ...overrides
    });
}

test('瞬間注釈は丸めた分秒と本文を組み立てる', () => {
    assert.equal(packet({ sourceT: 65.4 }),
        '【注釈】a-0001（1:05）について: ここを直す\nこの注釈に対応してください。');
});

test('区間注釈は開始と終了を表示する', () => {
    assert.equal(packet({ sourceRange: [5.2, 67.7] }),
        '【注釈】a-0001（0:05〜1:08）について: ここを直す\nこの注釈に対応してください。');
});

test('ドキュメントと画像の注釈は時刻なしの表示にする', () => {
    for (const target of ['doc:reports/result.html#summary', 'image:assets/sample.png']) {
        assert.match(packet({ sourceT: null, target }),
            new RegExp(`ドキュメント/画像上の注釈・対象 ${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    }
});

test('UI 対象は識別子と表示名を併記する', () => {
    assert.match(packet({ target: 'ui:timeline:clip:main', targetLabel: 'メインクリップ' }),
        /対象 ui:timeline:clip:main（メインクリップ）/);
});

test('ペン描画があることを詳細へ加える', () => {
    assert.match(packet({ hasStrokes: true }), /ペン描画あり/);
});

test('本文が空ならペン描画だけの依頼として示す', () => {
    assert.match(packet({ text: '   ', hasStrokes: true }), /\(本文なし。ペン描画のみ\)/);
});

test('region without strokes adds its centre to single and batch handoffs', () => {
    const region = { box: [0.64, 0.39, 0.02, 0.02] };
    assert.equal(packet({ region }),
        '【注釈】a-0001（1:05・位置: 65%, 40%）について: ここを直す\nこの注釈に対応してください。');
    const note = { id: 'a-0001', sourceT: 65, target: null, text: 'ここを直す',
        region, strokes: null };
    assert.equal(composeBatchAnnotationHandoff([note]),
        '未対応の注釈 1 件にまとめて対応して\n・a-0001 1:05 ここを直す（位置: 65%, 40%）');
});

test('strokes retain their exact wording and take precedence over region; no-region text is unchanged', () => {
    const stroke = { tool: 'pen', space: 'content-rect', points: [[0.65, 0.76], [0.85, 0.38]] };
    const region = { box: [0.64, 0.39, 0.02, 0.02] };
    const singleStroke = packet({ strokes: [stroke] });
    assert.equal(packet({ strokes: [stroke], region }), singleStroke);
    assert.doesNotMatch(singleStroke, /位置:/);
    const note = { id: 'a-0001', sourceT: 65, target: null, text: 'ここを直す', strokes: [stroke] };
    assert.equal(composeBatchAnnotationHandoff([{ ...note, region }]), composeBatchAnnotationHandoff([note]));
    assert.equal(packet(), '【注釈】a-0001（1:05）について: ここを直す\nこの注釈に対応してください。');
    assert.equal(composeBatchAnnotationHandoff([{ ...note, strokes: null, region: null }]),
        '未対応の注釈 1 件にまとめて対応して\n・a-0001 1:05 ここを直す');
});
