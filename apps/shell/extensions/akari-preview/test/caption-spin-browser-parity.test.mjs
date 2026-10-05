import assert from 'node:assert/strict';
import test from 'node:test';
import { captionMotionAt } from '../../../../../packages/frame-engine/dist/timeline/caption-motion.js';
import { buildCaptionAnimation } from '../../../../../packages/render-cut/src/captions.mjs';
import { harness } from './caption-animator-webview-harness.mjs';
import { launchBrowser } from '../../../../../packages/overlay-runtime/test-harness/fixtures/browser.mjs';

test('frame-engine, render-cut CSS, and preview CSS agree on spin angle every 10 ms', async t => {
    const declaration = {
        in: { id: 'slide-up', duration_sec: 0.4 },
        loop: { id: 'spin-in' },
        out: { id: 'zoom-in-out' }
    };
    const expected = buildCaptionAnimation(declaration, 3);
    const preview = harness();
    preview.context.declaration = declaration;
    preview.context.duration = 3;
    const previewCss = preview.run('buildPreviewCaptionAnimation(declaration, duration)');
    assert.equal(previewCss.animationCss, expected.animationCss);
    assert.equal(previewCss.keyframesCss, expected.keyframesCss);

    // 他の実ブラウザのテストと同じ起動口を使い、Chrome の無い環境（必須 CI の L0）では skip する
    let browser;
    try {
        browser = await launchBrowser();
    } catch (error) {
        if (error?.message !== 'headless Chrome が見つかりません') throw error;
        t.skip('headless Chrome 不在（Chrome のある環境でのみ実行）');
        return;
    }
    t.after(() => browser.close());
    const page = await browser.newPage();
    await page.setContent(`<style>${expected.keyframesCss}</style><div id="plate" style="width:400px;height:100px;transform-origin:center">spin</div>`);
    const times = Array.from({ length: 301 }, (_, index) => index / 100);
    const browserAngles = await page.evaluate(({ animationCss, times }) => {
        const plate = document.getElementById('plate');
        plate.style.animation = animationCss;
        const animations = plate.getAnimations();
        if (animations.length !== 3) throw new Error(`expected three CSS animations, found ${animations.length}`);
        return times.map(time => {
            for (const animation of animations) animation.currentTime = time * 1000;
            const matrix = new DOMMatrix(getComputedStyle(plate).transform);
            let angle = Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
            if (angle > 90) angle -= 360; // CSS may report the starting -180° as +180°.
            return angle;
        });
    }, { animationCss: expected.animationCss, times });
    for (let index = 0; index < times.length; index += 1) {
        const time = times[index];
        const frameAngle = captionMotionAt(declaration, time, 3, 40).rotateDeg;
        assert.ok(Math.abs(browserAngles[index] - frameAngle) <= 5,
            `${time}s: CSS ${browserAngles[index]}°, frame-engine ${frameAngle}°`);
    }
});
