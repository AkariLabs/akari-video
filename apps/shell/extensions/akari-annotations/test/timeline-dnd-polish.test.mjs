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

test('置いた文字は縦ドラッグで段を変えず、横の差分だけ時刻へ反映する', () => {
    const base = { originalStart: 3, originalEnd: 6, proposedStart: 5, originalTop: '680.9px' };
    for (const clientY of [680.9, 780.9, 480.9]) {
        assert.deepEqual(planPlacedTextMove({ ...base, clientY }),
            { start: 5, end: 8, top: '680.9px' });
    }
    assert.deepEqual(planPlacedTextMove({ ...base, proposedStart: -2, clientY: 780.9 }),
        { start: 0, end: 3, top: '680.9px' });
});
