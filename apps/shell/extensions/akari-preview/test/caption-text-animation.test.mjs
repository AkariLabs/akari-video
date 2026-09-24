import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createRequire } from 'node:module';
import { CAPTION_ANIMATION_RECIPES, buildCaptionAnimation } from '../../../../../packages/render-cut/src/captions.mjs';
import { harness, source } from './caption-animator-webview-harness.mjs';

const require = createRequire(import.meta.url);
const { PREVIEW_CAPTION_ANIMATION_RECIPES } = require('../lib/common/caption-text-animation-recipes.js');
const plain = value => JSON.parse(JSON.stringify(value));
const htmlHash = html => createHash('sha256').update(html).digest('hex');

function cue(overrides = {}) {
    return {
        id: 'textanim-1', start: 10, end: 14, text: '字幕',
        ...overrides
    };
}

test('render-cut の 47 レシピと webview の宣言は全スロットで一致する', () => {
    assert.equal(Object.keys(CAPTION_ANIMATION_RECIPES).length, 47);
    assert.deepEqual(PREVIEW_CAPTION_ANIMATION_RECIPES, CAPTION_ANIMATION_RECIPES);
    const app = harness();
    const cases = [
        [{ in: { id: 'fade-up' } }, 4],
        [{ loop: { id: 'float', duration_sec: 2.25, amp: 1.7 } }, 4],
        [{ out: { id: 'pop', duration_sec: 0.9, ease: 'ease-in' } }, 4],
        [{ in: { id: 'typewriter', duration_sec: 2 }, out: { id: 'wipe-left', duration_sec: 2 } }, 0.3],
        [{ in: { id: 'unknown' } }, 4],
        [{ in: { id: 'unknown' }, loop: { id: 'float' } }, 4],
        [null, 4]
    ];
    for (const id of Object.keys(CAPTION_ANIMATION_RECIPES)) {
        cases.push([{ in: { id }, loop: { id }, out: { id } }, 4]);
    }
    for (const [declaration, duration] of cases) {
        const expectedWarnings = [];
        const actualWarnings = [];
        const expected = buildCaptionAnimation(declaration, duration, message => expectedWarnings.push(message));
        app.context.declaration = declaration;
        app.context.duration = duration;
        app.context.actualWarnings = actualWarnings;
        const actual = app.run('buildPreviewCaptionAnimation(declaration, duration, message => actualWarnings.push(message))');
        assert.deepEqual(plain(actual), expected, JSON.stringify(declaration));
        assert.deepEqual(actualWarnings, expectedWarnings);
    }
});

test('字幕の板に paused textanim を置き、tick・seek・選択を同じ時計に結ぶ', () => {
    const animation = {
        in: { id: 'fade-up', duration_sec: 0.8, amp: 1.5 },
        loop: { id: 'float' },
        out: { id: 'pop', duration_sec: 0.8 }
    };
    const app = harness({ cues: [cue({ textStyle: { animation } })] });
    app.tick(10.4);
    assert.match(app.plate.innerHTML, /<div class="akari-caption__plate" data-akari-textanim style="--akari-anim-amp: 1\.5;animation:akari-anim-fade-up 0\.8s ease-out 0s 1 normal both paused/u);
    assert.match(app.plate.innerHTML, /akari-anim-float 1\.6s linear 0s infinite both paused/u);
    assert.match(app.plate.innerHTML, /akari-anim-pop 0\.8s ease-out 3\.2s 1 reverse forwards paused/u);
    assert.match(app.plate.innerHTML, /@keyframes akari-anim-fade-up/u);
    assert.ok(Math.abs(app.animations[0].currentTime - 400) < 1e-6);
    app.run('isPlaying = true;');
    app.tick(11);
    assert.equal(app.animations[0].currentTime, 1000);
    app.run('isPlaying = false;');
    app.tick(11);
    assert.equal(app.animations[0].currentTime, 1000);
    app.seek(13.5);
    assert.equal(app.animations[0].currentTime, 3500);
    assert.match(source, /\.caption-row-plate\[data-selected\] \.akari-caption__plate\[data-akari-textanim\], \.caption-row-plate\.akari-caption-host--editing \.akari-caption__plate\[data-akari-textanim\] \{ animation: none !important; opacity: 1 !important; transform: none !important; clip-path: none !important; \}/u);
    app.run("selectedCaptionIds.add('textanim-1'); applyCaptionSelectionAttrs();");
    assert.equal(app.plate.hasAttribute('data-selected'), true);
    assert.equal(app.hitRegions.length > 0, true);
    app.run('selectedCaptionIds.clear(); applyCaptionSelectionAttrs();');
    assert.equal(app.plate.hasAttribute('data-selected'), false);
    assert.equal(app.animations[0].currentTime, 3500);
});

test('同時表示の 2 行で textanim 宣言は各板のインライン属性だけに閉じる', () => {
    const fade = cue({ id: 'fade', textStyle: { animation: { in: { id: 'fade-up' } } } });
    const still = cue({ id: 'still' });
    const mixed = harness({ cues: [fade, still], selectedIds: ['still'] });
    mixed.tick(10.5);
    assert.equal(mixed.plates.length, 2);
    const [fadeHtml, stillHtml] = mixed.plates.map(plate => plate.innerHTML);
    const plateTag = html => html.match(/<div class="akari-caption__plate"[^>]*>/u)?.[0];
    const plateRule = html => html.match(/\.akari-caption__plate\{[^}]*\}/u)?.[0];
    assert.match(plateTag(fadeHtml), /data-akari-textanim style="animation:akari-anim-fade-up 0\.6s ease-out 0s 1 normal both paused;"/u);
    assert.equal(plateTag(stillHtml), '<div class="akari-caption__plate">');
    assert.equal(plateRule(fadeHtml), plateRule(stillHtml));
    assert.doesNotMatch(plateRule(fadeHtml), /animation:|--akari-anim-amp/u);
    assert.equal(mixed.plates[1].hasAttribute('data-selected'), true);
    assert.doesNotMatch(stillHtml, /data-akari-textanim|akari-anim-/u);

    const pop = cue({ id: 'pop', textStyle: { animation: { in: { id: 'pop', amp: 2 } } } });
    const twoAnimated = harness({ cues: [fade, pop] });
    twoAnimated.tick(10.5);
    assert.equal(twoAnimated.plates.length, 2);
    const [fadePlate, popPlate] = twoAnimated.plates.map(plate => plate.innerHTML);
    assert.match(plateTag(fadePlate), /animation:akari-anim-fade-up/u);
    assert.doesNotMatch(plateTag(fadePlate), /akari-anim-pop|--akari-anim-amp/u);
    assert.match(plateTag(popPlate), /--akari-anim-amp: 2;animation:akari-anim-pop/u);
    assert.doesNotMatch(plateTag(popPlate), /akari-anim-fade-up/u);
    assert.equal(plateRule(fadePlate), plateRule(popPlate));
    assert.doesNotMatch(plateRule(popPlate), /animation:|--akari-anim-amp/u);
});

test('resolved 経路と無宣言字幕に textanim を足さず、runs は板内に保つ', () => {
    const animation = { in: { id: 'fade-up' } };
    const resolved = harness({ cues: [cue({ resolvedTimeline: true, textStyle: { animation } })] });
    resolved.tick(10.5);
    assert.doesNotMatch(resolved.plate.innerHTML, /akari-anim-/u);

    const still = harness({ cues: [cue()] });
    still.tick(10.5);
    assert.doesNotMatch(still.plate.innerHTML, /akari-anim-/u);
    assert.doesNotMatch(still.plate.innerHTML, /animation:none!important/u);

    const withRuns = harness({ cues: [cue({
        textStyle: { animation },
        runs: [{ from: 0, to: 1, role: 'emphasis', style: { color: '#ff0000' } }]
    })] });
    withRuns.tick(10.5);
    assert.match(withRuns.plate.innerHTML, /akari-caption__plate/u);
    assert.match(withRuns.plate.innerHTML, /akari-anim-fade-up/u);
    assert.match(withRuns.plate.innerHTML, /akari-caption__run/u);
    assert.doesNotMatch(withRuns.plate.innerHTML, /akari-caption__run[^>]*animation:/u);

    const wordCue = cue({
        style: 'karaoke', words: [{ text: '字幕', start: 10, end: 11 }],
        textStyle: { animation }
    });
    const styled = harness({ cues: [wordCue] });
    styled.tick(10.5);
    assert.match(styled.plate.innerHTML, /akari-caption__tok--karaoke/u);
    assert.match(styled.plate.innerHTML, /akari-anim-fade-up 0\.6s ease-out 0s 1 normal both paused/u);
    assert.ok(Math.abs(styled.animations[0].currentTime - 500) < 1e-6);
});

test('動きの無い字幕の HTML/CSS は変更前の 4 経路とバイト一致する', () => {
    const cases = [
        [cue({ id: 'p', start: 0, end: 2 }), '1fde8dcfb30e440c5161c379f55130b3647e0e575cbaa16a79feed45eab2f8f4'],
        [cue({ id: 's', start: 0, end: 2, style: 'karaoke',
            words: [{ text: '字幕', start: 0, end: 1 }] }), '5847129ed049d14c06ce610fad73f5060a882c89619f4c967c7021d58f9fc6b4'],
        [cue({ id: 'r', start: 0, end: 2, resolvedTimeline: true }), '0cb8dbca289f4d77ad405d54341100c55112196d69629ebea12e4e7c8b2d576f'],
        [cue({ id: 'x', start: 0, end: 2, runs: [
            { from: 0, to: 1, role: 'emphasis', style: { color: '#f00' } }
        ] }), '8d3a5f9b00b64e43758ccd4bf487e6d41be25aec628df1b64c6d10127b77121a']
    ];
    for (const [caption, expectedHash] of cases) {
        const app = harness({ cues: [caption] });
        app.tick(1);
        assert.equal(htmlHash(app.plate.innerHTML), expectedHash, caption.id);
    }
});
