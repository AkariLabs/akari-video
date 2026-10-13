import assert from 'node:assert/strict';
import { test, after as afterI18nTest } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));


const require = createRequire(import.meta.url);
const { guideShowsChat, guideTargetsChat, guideNeedsPartner, shouldRevealPartner, guideInputCutouts, guideRequiredPanels,
    pointInGuideCutouts, guideBlockedRects, guideBlockerClipPath, shouldBlockGuidePointer,
    materialPreviewTransportRect, outputCaptionBandRect, captionCoachPosition, guideCoachBounds, guideCoachPlacement,
    heldGuideCoachTop, needsCaptionStyleSelection,
    partnerFallbackReady, askHighlightTarget,
    askConnectionCopy } = require('../../lib/onboarding/guide-ui-model.js');

test('STEP 4 の吹き出しとボタン行は 720–1080px の ja/en 8 通りで窓内に収まる', () => {
    // 1440×900 の記録画像: 打ち始め top は ja≈620/en≈635、打ち終わり bottom は 893/934 → 実寸相当 273/299px。
    for (const [language, coachHeight, initialTop] of [['ja', 273, 620], ['en', 299, 635]]) {
        for (const viewportHeight of [720, 800, 900, 1080]) {
            const viewport = { width: 1440, height: viewportHeight };
            const coach = { width: 390, height: coachHeight, actionsHeight: 42, actionsBottomInset: 16 };
            const anchor = { x: 1058, y: initialTop, width: 340, height: coachHeight };
            const bounds = guideCoachPlacement(viewport, coach, anchor,
                { step: 'prompt', sub: 0, previousTop: initialTop });
            const coachRect = { left: bounds.left, top: bounds.top,
                right: bounds.left + coach.width, bottom: bounds.top + Math.min(coach.height, bounds.maxHeight) };
            const buttonRect = { left: coachRect.left, right: coachRect.right,
                top: bounds.top + bounds.height - bounds.actionsBottomInset - bounds.actionsHeight,
                bottom: bounds.top + bounds.height - bounds.actionsBottomInset };
            for (const [name, rect] of [['coach', coachRect], ['buttons', buttonRect]]) {
                assert.ok(rect.left >= 0 && rect.right <= viewport.width, `${language}/${viewportHeight} ${name} x`);
                assert.ok(rect.top >= 0 && rect.bottom <= viewport.height, `${language}/${viewportHeight} ${name} y`);
            }
            if (language === 'ja' && viewportHeight === 900) {
                assert.equal(bounds.left, 654);
                assert.equal(bounds.top, initialTop);
            }
            if (language === 'en' && viewportHeight === 900) assert.ok(coachRect.bottom <= 900);
        }
    }
});

test('STEP 4 は打ち始めの top を保ち、収まらない英語だけ上へ寄せる', () => {
    const viewport = { width: 1440, height: 900 };
    for (const [language, height, initialTop, observedBottom] of [['ja', 273, 620, 893], ['en', 299, 635, 934]]) {
        assert.equal(initialTop + height, observedBottom);
        const anchor = { x: 1058, y: initialTop, width: 340, height };
        const bounds = guideCoachPlacement(viewport, { width: 390, height }, anchor,
            { step: 'prompt', sub: 0, previousTop: initialTop });
        if (language === 'ja') assert.equal(bounds.top, initialTop);
        else { assert.ok(bounds.top < initialTop); assert.ok(bounds.top + bounds.height <= viewport.height); }
    }
    const capped = guideCoachBounds({ width: 1440, height: 720 },
        { width: 390, height: 800, actionsHeight: 42, actionsBottomInset: 16 }, { x: 654, y: 620 });
    assert.equal(capped.maxHeight, 680);
    assert.equal(capped.height, 680);
    assert.ok(capped.top + capped.height - capped.actionsBottomInset <= 720);
});

test('別ステップの top を再利用せず、上限時は本文だけをスクロールする構造', () => {
    const controller = readFileSync(new URL('./controller.ts', import.meta.url), 'utf8');
    const style = readFileSync(new URL('./style.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(controller, /mountedCoachKey/u);
    assert.match(controller, /const serial = typingPrompt/u);
    assert.match(controller, /const previousTop = heldGuideCoachTop\(this\.coachHold, coach, basis/u);
    const markup = controller.slice(controller.indexOf('protected coachMarkup('), controller.indexOf('protected async loadVideo('));
    assert.ok(markup.includes('<h3>${spec.title}</h3><div class="ao-body">${spec.body}</div>'));
    assert.ok(markup.includes('<div class="ao-actions">${back}${actions}</div>'));
    assert.match(style, /\.ao-coach\.ao-coach-constrained \.ao-body \{ min-height:0; overflow-y:auto; \}/u);
    assert.match(style, /\.ao-coach\.ao-coach-constrained \.ao-actions \{ flex-shrink:0; \}/u);
    assert.match(style, /#akari-onboarding-v1 \* \{ box-sizing:border-box; \}/u);
    assert.doesNotMatch(style, /\.ao-coach\.ao-coach-constrained \{[^}]*box-sizing/u);
});

test('STEP 4 の top 保持は高さだけの変化に限り、的・窓・要素・段が変われば使わない', () => {
    const coach = {}, replacement = {};
    const hold = { element: coach, basis: 'prompt:0/1440x900/anchor-a', top: 620 };
    assert.equal(heldGuideCoachTop(hold, coach, hold.basis, 'prompt', 0), 620);
    assert.equal(heldGuideCoachTop(hold, coach, 'prompt:0/1440x900/anchor-b', 'prompt', 0), undefined);
    assert.equal(heldGuideCoachTop(hold, coach, 'prompt:0/800x900/anchor-a', 'prompt', 0), undefined);
    assert.equal(heldGuideCoachTop(hold, replacement, hold.basis, 'prompt', 0), undefined);
    assert.equal(heldGuideCoachTop(hold, coach, hold.basis, 'prompt', 1), undefined);
    assert.equal(heldGuideCoachTop(hold, coach, hold.basis, 'work', 0), undefined);
});

test('案内段の的から開くパネルを選ぶ', () => {
    assert.deepEqual(guideRequiredPanels(['assets']), ['left']);
    assert.deepEqual(guideRequiredPanels(['sample-card', 'assets']), ['left']);
    assert.deepEqual(guideRequiredPanels(['export-result']), ['left']);
    assert.deepEqual(guideRequiredPanels(['timeline']), ['bottom']);
    assert.deepEqual(guideRequiredPanels(['assets', 'timeline']), ['left', 'bottom']);
    assert.deepEqual(guideRequiredPanels(['output', 'partner']), []);
});

test('素材カードを読めない間も素材パネルの操作範囲を残す', () => {
    const assets = { x: 48, y: 44, width: 226, height: 830 };
    const cutouts = guideInputCutouts([], [assets], []);
    assert.equal(pointInGuideCutouts(100, 300, cutouts), true);
    assert.equal(pointInGuideCutouts(400, 300, cutouts), false);
});

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
