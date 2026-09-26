import assert from 'node:assert/strict';
import test from 'node:test';
import { materialGhostRejectLabel } from '../lib/common/timeline-material-insert.js';
import { planPlacedTextMove } from '../lib/common/placed-text-drag.js';

test('拒否の詳細理由を枠内用の短い語へ変換する', () => {
    for (const reason of ['映像のレーンには音を置けません。', '音のレーンには映像を置けません。',
        '音は音の段へドロップしてください。']) {
        assert.equal(materialGhostRejectLabel(reason), 'レーン違い');
    }
    assert.equal(materialGhostRejectLabel('「V1」はロック中です（鍵を外すと編集できます）'), 'ロック中');
    assert.equal(materialGhostRejectLabel('locked: reject'), '置けません');
    assert.equal(materialGhostRejectLabel(''), '置けません');
});

test('置いた文字の縦ドラッグは映像段・新しい段・文字の行を選び、音の行を拒否する', () => {
    const base = { originalStart: 3, originalEnd: 6, proposedStart: 5, originalTop: '680.9px',
        stripTop: 100, rows: [
            { id: 'v1', lane: 'visual', top: 0, height: 50 },
            { id: 'a1', lane: 'audio', top: 55, height: 50 },
            { id: 'text', lane: 'placed-text', top: 110, height: 50 }
        ] };
    assert.deepEqual(planPlacedTextMove({ ...base, clientY: 120,
        visualHit: { top: 0, targetTrackId: 'v1', rejected: false } }),
    { start: 5, end: 8, top: '0px', destination: { kind: 'track', trackId: 'v1' } });
    assert.equal(planPlacedTextMove({ ...base, clientY: 150,
        visualHit: { top: 50, insertIndex: 1, rejected: false } }).destination.kind, 'new-track');
    assert.equal(planPlacedTextMove({ ...base, clientY: 220 }).destination.kind, 'placed-text');
    assert.equal(planPlacedTextMove({ ...base, clientY: 170,
        visualHit: { top: 55, rejected: true } }).destination.kind, 'rejected');
    assert.equal(planPlacedTextMove({ ...base, proposedStart: -2, clientY: 220 }).start, 0);
});
