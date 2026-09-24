import assert from 'node:assert/strict';
import test from 'node:test';
import { centeredPreviewTextPlacement } from '../lib/common/preview-text-placement.js';
import { placeTextCaption } from '../lib/common/place-text.js';

const output = { width: 1280, height: 720 };

test('T タイルは見た目の半幅を x から引き、mc で y を中心にする', () => {
    const point = { x: 383.5 / 1280, y: 215.7 / 720 };
    const placement = centeredPreviewTextPlacement({ point, output });
    const width = 7 * 38 + 2 * 0.42 * 38;
    assert.equal(placement.textAnchor, 'mc');
    assert.ok(Math.abs((placement.position.x * 1280 + width / 2) - 383.5) < 0.01);
    assert.equal(placement.position.y, point.y);
    const caption = placeTextCaption({ ...placement, start: 3 }, 0, 12, []);
    assert.deepEqual(caption.textStyle, { position: placement.position, textAnchor: 'mc' });
    assert.equal(placeTextCaption({}, 0, 12, []).textStyle.textAnchor, 'tc', '既存の＋は変えない');
});

test('ニュース風スタイルは板の余白を含めて中心を合わせる', () => {
    const placement = centeredPreviewTextPlacement({
        point: { x: 0.5, y: 288.6 / 720 }, output, stylePreset: 'subtitle-news'
    });
    const width = 7 * 56 + 2 * 16;
    assert.equal(placement.textAnchor, 'mc');
    assert.equal(placement.position.x, (640 - width / 2) / 1280);
    assert.equal(placement.position.y, 288.6 / 720);
});

test('マイスタイルは参照高さに合わせた文字寸法で配置する', () => {
    const placement = centeredPreviewTextPlacement({
        point: { x: 0.5, y: 0.4 }, output,
        myStyleLook: { size_px: 64, reference_height_px: 1080, background: { padding_px: 12 } }
    });
    const width = 7 * (64 * 720 / 1080) + 2 * (12 * 720 / 1080);
    assert.ok(Math.abs(placement.position.x * 1280 + width / 2 - 640) < 0.01);
    assert.equal(placement.textAnchor, 'mc');
});
