import assert from 'node:assert/strict';
import test from 'node:test';
import { outputRectInHost, hostToOutput, previewDropTransform, previewDropBox } from '../lib/common/preview-drop-geometry.js';

test('iframe 内の枠とホスト座標から出力 px を得る', () => {
    const rect = outputRectInHost({ x: 100, y: 50, width: 1000, height: 600,
        layoutWidth: 1000, layoutHeight: 600 }, { x: 20, y: 30, width: 800, height: 450 });
    assert.deepEqual(rect, { x: 120, y: 80, width: 800, height: 450 });
    assert.deepEqual(hostToOutput({ x: 720, y: 192.5 }, rect, { width: 1920, height: 1080 }), { x: 1440, y: 270 });
    assert.deepEqual(previewDropTransform({ x: 1440, y: 270 }, { width: 1920, height: 1080 },
        { width: 4000, height: 3000 }), { x: 480, y: -270, scale: 0.12 });
});

test('内側の content iframe の位置と倍率を含めてホスト座標へ写す', () => {
    const outer = { x: 283, y: 39, width: 780, height: 358.5,
        layoutWidth: 780, layoutHeight: 358.5 };
    const stage = { x: 150.9, y: 16, width: 478.2, height: 269 };
    assert.deepEqual(outputRectInHost(outer, stage, false, {
        rect: { x: 0, y: 0, width: 780, height: 358.5 }, viewport: { width: 780, height: 358.5 }
    }), { x: 433.9, y: 55, width: 478.2, height: 269 });
    assert.deepEqual(outputRectInHost({ ...outer, width: 800, layoutWidth: 800 },
        { x: 100, y: 20, width: 400, height: 200 }, false, {
            rect: { x: 10, y: 8, width: 760, height: 340 }, viewport: { width: 760, height: 340 }
        }), { x: 393, y: 67, width: 400, height: 200 });
});

test('仮枠は出力幅の 1/4、既知の縦横比を使い未知なら 16:9', () => {
    assert.deepEqual(previewDropBox({ width: 1920, height: 1080 }, { width: 4000, height: 3000 }),
        { width: 480, height: 360 });
    assert.deepEqual(previewDropBox({ width: 1920, height: 1080 }), { width: 480, height: 270 });
});

test('全画面・無効な座標・枠の外では何もしない', () => {
    const iframe = { x: 0, y: 0, width: 800, height: 450, layoutWidth: 800, layoutHeight: 450 };
    const inner = { x: 0, y: 0, width: 800, height: 450 };
    assert.equal(outputRectInHost(iframe, inner, true), undefined);
    assert.equal(outputRectInHost({ ...iframe, width: 0 }, inner), undefined);
    assert.equal(hostToOutput({ x: 801, y: 10 }, inner, { width: 1920, height: 1080 }), undefined);
    assert.equal(previewDropTransform({ x: 0, y: 0 }, { width: 1920, height: 1080 }, { width: 0, height: 1 }), undefined);
});
