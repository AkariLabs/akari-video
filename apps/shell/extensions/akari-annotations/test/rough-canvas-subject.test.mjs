import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoughCanvasSubject, openingPlan, popupBounds, formatRoughCanvasPacket } from '../lib/browser/rough-canvas/rough-canvas-model.js';

test('開く瞬間の対象と送信文面', () => {
    const subject = buildRoughCanvasSubject(12.4, ['timeline:overlay:ov-7', 'bad'],
        { src: 's1', sourceT: 41.2, cutIndex: 3 });
    assert.deepEqual(subject, { playhead: { outputT: 12.4, src: 's1', sourceT: 41.2, cutIndex: 3 },
        selection: ['timeline:overlay:ov-7'], doc: 'edit.json' });
    const packet = formatRoughCanvasPacket('c-0003', subject, '言葉');
    assert.match(packet, /出力 0:12 \/ cut:3 \/ 選択: timeline:overlay:ov-7/);
    assert.match(packet, /話した言葉: 「言葉」/);
    assert.match(packet, /review\/canvas\/c-0003\/paper.png/);
});
test('プレビューの 45%、最小幅、画面内補正', () => {
    assert.equal(popupBounds(1600, 900, 1000, { w: 1920, h: 1080 }).width, 450);
    assert.equal(popupBounds(1200, 900, 400, { w: 1920, h: 1080 }).width, 320);
    const box = popupBounds(700, 500, 1000, { w: 1920, h: 1080 }, { left: 999, top: 999, width: 600 });
    assert.equal(box.left + box.width, 700); assert.ok(box.top + box.height <= 500);
});
test('再生中の停止と撮影は紙を出す前', () => {
    assert.deepEqual(openingPlan(true, true), ['pause', 'capture', 'open']);
    assert.deepEqual(openingPlan(true, false), ['capture', 'open']);
    assert.deepEqual(openingPlan(false, true), ['open']);
});
