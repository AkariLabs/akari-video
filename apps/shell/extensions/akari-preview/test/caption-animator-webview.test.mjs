import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { harness } from './caption-animator-webview-harness.mjs';
import { cutFixture, captionHost } from './caption-animator-cut-fixture.mjs';
import { applyCaptionAnimatorDom } from '../../../../../packages/frame-engine/dist/timeline/caption-animator-dom.js';

test('停止中の frameEngineClock.seek 単独でも実データの字幕を更新する', async () => {
    const fixture = cutFixture();
    const model = await captionHost(fixture).load();
    const view = harness({ cues: model.captions, applyAnimator: applyCaptionAnimatorDom, output: model.summary.output });
    const clock = view.installEngineSeek();
    view.tick(0);
    const opacity = () => chars(view).map(node => Number(node.style.opacity));
    assert.deepEqual(opacity(), Array(9).fill(0));
    const before = view.calls.length;
    clock.seek(0.2);
    assert.equal(view.calls.length, before + 1, 'low-level seek must render without a playing rAF or caller tick');
    assert.deepEqual(opacity(), [1, 1, 0.807407, 0.437037, 0.066667, 0, 0, 0, 0]);
    // The accepted ramp evaluator gives two fully visible chars, two partial chars,
    // then < 0.1. Making every char after the first two < 0.1 would change its contract.
    assert.ok(opacity().slice(0, 2).every(value => value > 0.5));
    assert.ok(opacity().slice(4).every(value => value < 0.1));
    clock.seek(0.6);
    assert.ok(opacity().every(value => value >= 0.99));
    assert.ok(chars(view).every(node => node.style.transform.includes('0.000000px, 0.000000px')));
    clock.seek(1);
    assert.deepEqual(opacity(), Array(9).fill(1));
    clock.seek(0.2);
    assert.deepEqual(opacity(), [1, 1, 0.807407, 0.437037, 0.066667, 0, 0, 0, 0]);
    assert.deepEqual(view.calls.slice(1).map(call => call.declaration.cueLocalSeconds), [0.2, 0.6, 1, 0.2]);
    assert.ok(view.calls.every(call => call.declaration.keyframeOffsetSeconds === 0));
});

test('cut 射影後の cue 開始と袋開始は output 秒であり、後半でも点の時計をリセットしない', () => {
    const fixture = cutFixture({ at: 60, sourceDomain: true });
    const view = harness({ cues: fixture.projected, applyAnimator: applyCaptionAnimatorDom, output: fixture.edit.output });
    for (const time of [2.2, 2.6, 3.2]) view.seek(time);
    assert.deepEqual(view.calls.map(call => call.declaration.keyframeOffsetSeconds), [0, 0, 1]);
    for (const [index, time] of [2.2, 2.6, 3.2].entries()) {
        const d = view.calls[index].declaration;
        assert.ok(Math.abs(d.cueLocalSeconds + d.keyframeOffsetSeconds - (time - 2)) < 1e-9);
        assert.deepEqual(d.keyframes, fixture.bag.keyframes);
    }
    assert.ok(chars(view).every(node => Number(node.style.opacity) >= 0.99));
});

const animator = [{ id: 'a1', basis: 'chars', amount: { opacity: -1, y: 24 } }];
const cue = { id: 'c1', start: 3, end: 8, text: 'が👨‍👩‍👧‍👦<&', animator,
    animatorStart: 1, animatorKeyframes: [{ t: 0 }, { t: 15, animator: { a1: { offset: 1 } } }] };
const chars = view => view.plate.querySelectorAll('.akari-caption__char');

for (const style of ['text', 'plain', 'resolved', 'karaoke', 'pop', 'reveal', 'reveal-word']) {
    test(`${style}: #caption-plate の書記素 span と cue 全体の連番`, () => {
        const styled = style === 'text' ? {} : style === 'plain' ? { textStyle: { color: '#fff' } }
            : style === 'resolved' ? { resolvedTimeline: true }
            : { style, words: [{ text: 'が', start: 3, end: 4 }, { text: '👨‍👩‍👧‍👦<&', start: 4, end: 5 }] };
        const view = harness({ cues: [{ ...cue, ...styled }] });
        view.tick(3.2);
        assert.deepEqual(chars(view), [{ index: 0, html: 'が' }, { index: 1, html: '👨‍👩‍👧‍👦' },
            { index: 2, html: '&lt;' }, { index: 3, html: '&amp;' }]);
        assert.equal(view.calls[0].root, view.plate);
        const writes = view.writes;
        view.tick(3.4);
        assert.equal(view.writes, writes, 'tick must reuse existing char nodes');
    });
}

test('plain の行折り返しでも ZWJ/結合文字を割らず char 番号を継続する', () => {
    const text = 'が'.repeat(19) + '👨‍👩‍👧‍👦' + '次';
    const view = harness({ cues: [{ ...cue, text, textStyle: { color: '#fff' } }] });
    view.tick(4);
    assert.equal(chars(view).length, 21);
    assert.equal(chars(view)[19].html, '👨‍👩‍👧‍👦');
    assert.equal(chars(view)[20].index, 20);
    assert.equal((view.plate.innerHTML.match(/<p class="akari-caption__line">/g) ?? []).length, 2);
});

test('emphasis one-char-bang の内側も書記素単位で、複数 token の連番を保つ', () => {
    const view = harness({ cues: [{ ...cue, style: 'pop', words: [
        { text: 'が', start: 3, end: 4 }, { text: '👨‍👩‍👧‍👦', start: 4, end: 5 }
    ] }], emphasisWords: [{ id: 'e1', word: 'が', t_start: 3, t_end: 4, style_hint: 'one-char-bang' }] });
    view.tick(3.2);
    assert.deepEqual(chars(view).map(char => char.html), ['が', '👨‍👩‍👧‍👦']);
    assert.match(view.plate.innerHTML, /akari-caption__emphasis-char/);
});

for (const engine of [true, false]) {
    test(`${engine ? 'frame-engine' : 'DOM video'} tick / seek は WAAPI の後で item 相対時刻を渡す`, () => {
        const view = harness({ engine, cues: [{ ...cue, resolvedTimeline: true }] });
        view.tick(3.25);
        view.seek(4.5);
        view.seek(3.25);
        assert.equal(view.calls.length, 3);
        for (const [i, time] of [3.25, 4.5, 3.25].entries()) {
            const { declaration, animationTime } = view.calls[i];
            assert.equal(animationTime, (time - cue.start) * 1000);
            assert.equal(declaration.cueLocalSeconds, time - cue.start);
            assert.equal(declaration.keyframeOffsetSeconds, 2);
            assert.equal(declaration.cueDurationSec, 5);
            assert.equal(declaration.outputWidth, 1920);
            assert.equal(declaration.fps, 30);
            assert.equal(declaration.animators, animator);
            assert.equal(declaration.keyframes, cue.animatorKeyframes);
        }
        view.seek(8);
        assert.equal(view.calls.length, 3, 'cue end is exclusive');
    });
}

test('item 開始秒省略では offset 0、cue 切替で古い char span を残さない', () => {
    const view = harness({ cues: [{ ...cue, animatorStart: undefined },
        { id: 'plain', start: 8, end: 10, text: '<次>' }] });
    view.tick(4);
    assert.equal(view.calls[0].declaration.keyframeOffsetSeconds, 0);
    view.tick(8);
    assert.equal(view.plate.innerHTML, '&lt;次&gt;');
    assert.equal(chars(view).length, 0);
    assert.equal(view.calls.length, 1);
    const writes = view.writes;
    view.tick(9);
    assert.equal(view.writes, writes);
});

test('バンドルが無い場合は例外なし・webview 全体で 1 回だけ警告', () => {
    const view = harness({ engine: false, available: false, cues: [cue, { ...cue, id: 'next', start: 8, end: 10 }] });
    for (const time of [3.2, 3.4, 8.5, 3.2]) view.tick(time);
    assert.equal(view.warnings.length, 1);
    assert.match(view.warnings[0][0], /frame-engine bundle is not loaded/);
    view.context.window.AkariFrameEngine = {};
    view.tick(4);
    assert.equal(view.warnings.length, 1);
});

test('chars 無宣言では従来の HTML が同じで char span なし（styled/plain/resolved/emphasis）', () => {
    for (const extra of [{}, { textStyle: { color: '#fff', background: { mode: 'block' } } },
        { resolvedTimeline: true }, ...['karaoke', 'pop', 'reveal', 'reveal-word'].map(style => ({ style,
            words: [{ text: '字幕', start: 3, end: 4 }, { text: '<&', start: 4, end: 5 }] }))]) {
        const { animator: _animator, ...plain } = cue;
        const render = animation => {
            const view = harness({ cues: [{ ...plain, ...extra, animator: animation }] });
            view.tick(4);
            assert.equal(chars(view).length, 0);
            return view.plate.innerHTML;
        };
        const original = render(undefined);
        assert.equal(render([]), original);
        assert.equal(render([{ id: 'w', basis: 'words' }]), original);
        assert.equal(render([{ id: 'l', basis: 'lines' }]), original);
    }
});

test('animator 無宣言 cue は評価器も warning も呼ばず、tick で DOM を触らない', () => {
    for (const animation of [undefined, []]) {
        const view = harness({ available: false, cues: [{ ...cue, animator: animation }] });
        view.tick(4);
        const writes = view.writes;
        view.tick(5);
        assert.equal(view.writes, writes);
        assert.equal(view.warnings.length, 0);
        assert.equal(view.calls.length, 0);
    }
});

test('無宣言の HTML は r2 前の基底のバイト列を保持する', () => {
    // Recorded by executing the baseline open-handler webview in the same bare VM.
    const expected = [
        '68c6c1af208310fcd29febf704dcf072a57fd5b2ca74b575cfb1eb7004dadb02',
        'bd45c7f2d5472a5b85780f513a1386522c65fd6f6c8b314dbf38a7b8768ee021',
        '7a31707c3788a3bf3f32a360ce54834662d9a202389eb0d2d914949ee0766146',
        'da49aff2010bde987f91707683c5993833d48ae48f8e3eae71f3c4ec2757d6d5',
        '242a551aede48d7de2f2e59df697df3313447445ae87c834ebc5c9d17f706429',
        '4b33b61fb3e18120e4a00a807b34838328f1b1b5829b58d655b73da9d992c0b2',
        '98618842a458a10f82d98286e57faa10192b475957384d8f2bbd6b5becfffe7c'
    ];
    const fixtures = [{}, { textStyle: { color: '#fff', background: { mode: 'block' } } },
        { resolvedTimeline: true }, ...['karaoke', 'pop', 'reveal', 'reveal-word'].map(style => ({ style,
            words: [{ text: '字幕', start: 3, end: 4 }, { text: '<&', start: 4, end: 5 }] }))];
    for (const [i, extra] of fixtures.entries()) {
        const view = harness({ cues: [{ id: 'c1', start: 3, end: 8, text: '字幕<&が👨‍👩‍👧‍👦', ...extra }] });
        view.tick(4);
        assert.equal(createHash('sha256').update(view.plate.innerHTML).digest('hex'), expected[i]);
    }
});

test('chars の HTML エスケープは render-cut の captionCharRenderer と同じ', () => {
    const view = harness({ cues: [{ ...cue, text: `"'<>&` }] });
    view.tick(4);
    assert.equal(view.plate.innerHTML,
        '<span class="akari-caption__char" data-akari-char="0">&quot;</span>'
        + '<span class="akari-caption__char" data-akari-char="1">&#39;</span>'
        + '<span class="akari-caption__char" data-akari-char="2">&lt;</span>'
        + '<span class="akari-caption__char" data-akari-char="3">&gt;</span>'
        + '<span class="akari-caption__char" data-akari-char="4">&amp;</span>');
});
