import assert from 'node:assert/strict';
import test from 'node:test';

import { hoverPopupGeometry, HOVER_POPUP_DELAY_MS, HOVER_POPUP_MAX_IMAGE_PX,
    HOVER_POPUP_MAX_WIDTH_RATIO, HOVER_POPUP_MAX_HEIGHT_RATIO } from '../lib/common/hover-popup-geometry.js';

const base = {
    naturalWidth: 1920, naturalHeight: 1080,
    bounds: { left: 600, right: 800, top: 700, bottom: 750 },
    innerWidth: 1600, innerHeight: 1000
};

function assertInside(result, input) {
    const frame = 2 * ((input.padding ?? 6) + (input.borderWidth ?? 1));
    assert.ok(result.left >= 0 && result.top >= 0);
    assert.ok(result.left + result.imageWidth + frame <= input.innerWidth + 1e-9);
    assert.ok(result.top + result.imageHeight + frame + (input.nameHeight ?? 16) <= input.innerHeight + 1e-9);
}

for (const [label, width, height, expectedWidth, expectedHeight] of [
    ['横長 16:9', 1920, 1080, 320, 180],
    ['縦長 9:16', 1080, 1920, 180, 320],
    ['正方形', 1000, 1000, 320, 320]
]) {
    test(`${label}: 自然サイズの縦横比を保ち長辺を上限まで広げて上に置く`, () => {
        const input = { ...base, naturalWidth: width, naturalHeight: height };
        const result = hoverPopupGeometry(input);
        assert.equal(result.imageWidth, expectedWidth);
        assert.equal(result.imageHeight, expectedHeight);
        assert.equal(result.placement, 'above');
        assert.equal(result.left, input.bounds.left);
        assert.equal(result.top + expectedHeight + 30 + 8, input.bounds.top);
        assertInside(result, input);
    });
}

test('小さなウィンドウでは innerHeight が長辺の上限を決める', () => {
    const input = { ...base, innerWidth: 800, innerHeight: 300,
        bounds: { left: 100, right: 200, top: 240, bottom: 270 } };
    const result = hoverPopupGeometry(input);
    assert.equal(result.imageWidth, 120);
    assert.equal(result.imageHeight, 67.5);
    assertInside(result, input);
});

test('幅の狭いウィンドウでは innerWidth が長辺の上限を決める', () => {
    const input = { ...base, innerWidth: 800 };
    const result = hoverPopupGeometry(input);
    assert.equal(result.imageWidth, 216);
    assertInside(result, input);
});

test('画面上端付近では below に落ちる', () => {
    const input = { ...base, bounds: { left: 600, right: 800, top: 5, bottom: 55 } };
    const result = hoverPopupGeometry(input);
    assert.equal(result.placement, 'below');
    assert.equal(result.top, 63);
    assertInside(result, input);
});

test('画面右端付近では名前行と枠を含む幅で left をクランプする', () => {
    const input = { ...base, bounds: { left: 1550, right: 1600, top: 700, bottom: 750 } };
    const result = hoverPopupGeometry(input);
    assert.equal(result.placement, 'above');
    assert.equal(result.left, 1600 - 320 - 14);
    assertInside(result, input);
});

for (const [placement, left, right, expectedLeft] of [
    ['left', 700, 900, 633],
    ['right', 10, 210, 218]
]) {
    test(`上下に入らない縦長画像は ${placement} に置く`, () => {
        const input = { ...base, naturalWidth: 1080, naturalHeight: 1920, innerHeight: 200,
            bounds: { left, right, top: 70, bottom: 130 } };
        const result = hoverPopupGeometry(input);
        assert.equal(result.placement, placement);
        assert.equal(result.imageHeight, 80);
        // 80 × 9/16 + 枠 14px + 隙間 8px。
        assert.equal(result.left, expectedLeft);
        assertInside(result, input);
    });
}

test('どの方向にも入らなければ最後に画面内へクランプする', () => {
    const input = { ...base, innerWidth: 200, innerHeight: 200,
        bounds: { left: 20, right: 180, top: 10, bottom: 190 } };
    const result = hoverPopupGeometry(input);
    assert.equal(result.placement, 'left');
    assert.equal(result.left, 0);
    assertInside(result, input);
});

test('未ロードでは output を使い、ロード後は自然サイズを優先する', () => {
    const input = { ...base, naturalWidth: 0, naturalHeight: 0, width: 1080, height: 1920 };
    const provisional = hoverPopupGeometry(input);
    assert.equal(provisional.imageWidth, 180);
    assert.equal(provisional.imageHeight, 320);
    const loaded = hoverPopupGeometry({ ...input, naturalWidth: 1920, naturalHeight: 1080 });
    assert.equal(loaded.imageWidth, 320);
    assert.equal(loaded.imageHeight, 180);
    assertInside(provisional, input);
    assertInside(loaded, input);
});

test('不完全・非有限な自然サイズは output の縦横比へフォールバックする', () => {
    for (const naturalWidth of [undefined, 0, -1, NaN, Infinity]) {
        const result = hoverPopupGeometry({ ...base, naturalWidth, width: 1000, height: 1000 });
        assert.equal(result.imageWidth, 320);
        assert.equal(result.imageHeight, 320);
    }
});

test('上限・パディング・隙間を指定しても全体が画面内に収まる', () => {
    const input = { ...base, maxImageSize: 600, padding: 10, gap: 12 };
    const result = hoverPopupGeometry(input);
    assert.equal(result.imageWidth, 600);
    assert.equal(result.top + result.imageHeight + 22 + 16 + 12, base.bounds.top);
    assertInside(result, input);
});

test('指定上限がウィンドウを超えても名前行を残して画像を縮小する', () => {
    const input = { ...base, naturalWidth: 1000, naturalHeight: 1000, maxImageSize: 1000,
        innerWidth: 120, innerHeight: 100, bounds: { left: 20, right: 80, top: 40, bottom: 60 } };
    const result = hoverPopupGeometry(input);
    assert.equal(result.imageWidth, 70);
    assert.equal(result.imageHeight, 70);
    assert.equal(result.top, 0);
    assertInside(result, input);
});

test('ホバーの遅延と既定サイズ上限を固定する', () => {
    assert.equal(HOVER_POPUP_DELAY_MS, 2000);
    assert.equal(HOVER_POPUP_MAX_IMAGE_PX, 320);
    assert.equal(HOVER_POPUP_MAX_WIDTH_RATIO, 0.27);
    assert.equal(HOVER_POPUP_MAX_HEIGHT_RATIO, 0.4);
});
