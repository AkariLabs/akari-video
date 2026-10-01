import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guideShowsChat, guideTargetsChat, guideNeedsPartner, shouldRevealPartner, guideInputCutouts,
    pointInGuideCutouts, guideBlockedRects, guideBlockerClipPath, shouldBlockGuidePointer,
    materialPreviewTransportRect, outputCaptionBandRect, captionCoachPosition, needsCaptionStyleSelection,
    partnerFallbackReady, askHighlightTarget,
    askConnectionCopy } = require('../../lib/onboarding/guide-ui-model.js');

test('ask は本物のパートナーを見せ、その他の実演段にはチャットを出す', () => {
    for (const step of ['tour3', 'prompt', 'work', 'play', 'caption']) assert.equal(guideShowsChat(step), true);
    for (const step of ['welcome', 'invite', 'drag', 'export', 'ask']) assert.equal(guideShowsChat(step), false);
    assert.equal(guideNeedsPartner('ask'), true);
    assert.equal(askHighlightTarget('chatgpt'), 'partner-codex');
    assert.match(askConnectionCopy('chatgpt'), /つなぐのは「Codex CLI」です（光っているところ）/);
});

test('チャットを霧の上に出して枠を付ける段だけを選ぶ', () => {
    for (const [step, sub] of [['tour0', 0], ['tour0', 1], ['tour1', 0], ['tour2', 0],
        ['tour2', 1], ['tour3', 1], ['ask', 0], ['drag', 0], ['play', 0], ['play', 1],
        ['caption', 0], ['caption', 1], ['caption', 2], ['caption', 3]]) {
        assert.equal(guideTargetsChat(step, sub), false, `${step} sub${sub}`);
    }
    for (const [step, sub] of [['tour3', 0], ['prompt', 0], ['prompt', 1], ['work', 0]]) {
        assert.equal(guideTargetsChat(step, sub), true, `${step} sub${sub}`);
    }
});

test('チャットが目当てでない案内段の入力くり抜きにチャットは入らない', () => {
    const chat = { x: 700, y: 40, width: 250, height: 500 };
    const targets = [
        ['tour0', 0, []], ['tour0', 1, []],
        ['tour1', 0, [{ x: 20, y: 40, width: 200, height: 400 }]],
        ['tour2', 0, [{ x: 250, y: 40, width: 400, height: 300 }]],
        ['tour2', 1, [{ x: 20, y: 500, width: 620, height: 100 }]],
        ['tour3', 1, []]
    ];
    for (const [step, sub, holes] of targets) {
        assert.equal(guideTargetsChat(step, sub), false);
        const cutouts = guideInputCutouts(holes, [], []);
        assert.equal(pointInGuideCutouts(chat.x + chat.width / 2, chat.y + chat.height / 2, cutouts), false,
            `${step} sub${sub}`);
    }
});

test('caption に戻ったときも前回と異なる入場番号なら再びパートナーを開く', () => {
    assert.equal(shouldRevealPartner('caption', 14, 9), true);
    assert.equal(shouldRevealPartner('caption', 14, 14), false);
    assert.equal(shouldRevealPartner('daihon', 15, 14), false);
    assert.equal(partnerFallbackReady(3, 0, 10000), false);
    assert.equal(partnerFallbackReady(4, 9000, 9700), true);
});

test('別オリジンの出力プレビュー枠から字幕の表示帯を推定する', () => {
    const band = outputCaptionBandRect({ x: 395, y: 71, width: 659, height: 592 });
    const contains = (rect) => band.x <= rect.x && band.y <= rect.y
        && band.x + band.width >= rect.x + rect.width
        && band.y + band.height >= rect.y + rect.height;
    assert.ok(contains({ x: 576, y: 447, width: 295, height: 43 }), '1 行の字幕');
    assert.ok(contains({ x: 617.2, y: 401.5, width: 214, height: 88.6 }), '2 行の字幕');
    assert.ok(band.y > 339 && band.y + band.height < 520);
});

test('字幕のコーチは1920と1366の画面でメニュー・色窓・字幕帯を覆わない', () => {
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    for (const sample of [
        { viewport: { width: 1920, height: 1080 }, output: { x: 395, y: 71, width: 659, height: 592 },
            bar: { x: 440, y: 76, width: 580, height: 48 }, window: { x: 455, y: 125, width: 270, height: 168 } },
        { viewport: { width: 1366, height: 768 }, output: { x: 270, y: 70, width: 650, height: 550 },
            bar: { x: 320, y: 75, width: 570, height: 48 }, window: { x: 350, y: 125, width: 270, height: 168 } }
    ]) {
        const size = { width: 338, height: 181 };
        const band = outputCaptionBandRect(sample.output);
        const position = captionCoachPosition(sample.viewport, size, sample.output,
            [sample.bar, sample.window, band]);
        const coach = { ...position, ...size };
        assert.ok(coach.x >= 8 && coach.y >= 8);
        assert.ok(coach.x + coach.width <= sample.viewport.width - 8);
        assert.ok(coach.y + coach.height <= sample.viewport.height - 32);
        for (const obstacle of [sample.bar, sample.window, band]) assert.equal(overlap(coach, obstacle), 0);
    }
});

test('見た目の段へ戻ったときだけ、色メニューが無ければ字幕を選び直す', () => {
    assert.equal(needsCaptionStyleSelection('caption', 1, false), true);
    assert.equal(needsCaptionStyleSelection('caption', 1, true), false);
    assert.equal(needsCaptionStyleSelection('caption', 0, false), false);
    assert.equal(needsCaptionStyleSelection('daihon', 1, false), false);
});

test('遮断層のくり抜きは spec の holes・clear・rings の矩形と一致する', () => {
    const holes = [{ x: 30, y: 40, width: 90, height: 80 }];
    const clear = [{ x: 200, y: 50, width: 60, height: 40 }];
    const rings = [{ x: 400, y: 70, width: 20, height: 20 }];
    const cutouts = guideInputCutouts(holes, clear, rings);
    assert.deepEqual(cutouts, [...holes, ...clear, ...rings]);
    assert.equal(pointInGuideCutouts(50, 50, cutouts), true);
    assert.equal(pointInGuideCutouts(350, 70, cutouts), false);
    assert.ok(guideBlockerClipPath(800, 600, cutouts).startsWith('path("'));
    assert.ok(!guideBlockerClipPath(800, 600, cutouts).includes('evenodd'));
    assert.equal(guideBlockerClipPath(100, 100, [{ x: 0, y: 0, width: 100, height: 100 }]), 'inset(100%)');
});

test('入れ子・同一・一部重なりでも、くり抜きの和集合は通り外側だけ塞がる', () => {
    const blockedAt = (x, y, rects) => rects.some(rect =>
        x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height);
    const cases = [
        { cutouts: [{ x: 10, y: 10, width: 70, height: 70 }, { x: 20, y: 20, width: 20, height: 20 }], open: [[30, 30], [70, 70]] },
        { cutouts: [{ x: 10, y: 10, width: 70, height: 70 }, { x: 10, y: 10, width: 70, height: 70 }], open: [[30, 30]] },
        { cutouts: [{ x: 10, y: 10, width: 40, height: 40 }, { x: 30, y: 30, width: 40, height: 40 }], open: [[20, 20], [35, 35], [60, 60]] }
    ];
    for (const { cutouts, open } of cases) {
        const blocked = guideBlockedRects(100, 100, cutouts);
        for (const [x, y] of open) assert.equal(blockedAt(x, y, blocked), false, `${x},${y} should pass`);
        for (const [x, y] of [[5, 5], [90, 90]]) assert.equal(blockedAt(x, y, blocked), true, `${x},${y} should block`);
        for (let i = 0; i < blocked.length; i++) for (let j = i + 1; j < blocked.length; j++) {
            const a = blocked[i], b = blocked[j];
            assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x
                || a.y + a.height <= b.y || b.y + b.height <= a.y, 'blocked rectangles must not overlap');
        }
    }
});

test('ガイドの合成クリックは座標が 0,0 でも通し、実クリックだけ遮断する', () => {
    const cutouts = [{ x: 50, y: 50, width: 100, height: 100 }];
    assert.equal(shouldBlockGuidePointer(false, 0, 0, cutouts), false);
    assert.equal(shouldBlockGuidePointer(true, 0, 0, cutouts), true);
    assert.equal(shouldBlockGuidePointer(true, 100, 100, cutouts), false);
});

test('素材プレビュー下端の操作列は広い画面でも狭い画面でも ▶ を含む', () => {
    const contains = (outer, inner) => outer.x <= inner.x && outer.y <= inner.y
        && outer.x + outer.width >= inner.x + inner.width
        && outer.y + outer.height >= inner.y + inner.height;
    const cases = [
        { frame: { x: 500, y: 36, width: 448.4, height: 628 }, play: { x: 708.2, y: 630, width: 32, height: 32 } },
        { frame: { x: 300, y: 36, width: 432.8, height: 436 }, play: { x: 455.9, y: 438, width: 32, height: 32 } }
    ];
    for (const { frame, play } of cases) {
        const row = materialPreviewTransportRect(frame);
        assert.deepEqual(row, { x: frame.x, y: frame.y + frame.height - 42, width: frame.width, height: 42 });
        assert.ok(contains(row, play));
    }
    const narrow = cases[1];
    const oldCenterGuess = { x: narrow.frame.x + narrow.frame.width / 2 - 16,
        y: narrow.frame.y + narrow.frame.height - 33, width: 32, height: 32 };
    assert.equal(contains(oldCenterGuess, narrow.play), false);
});
