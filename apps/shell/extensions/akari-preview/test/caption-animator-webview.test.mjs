import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { harness, frameEngine } from './caption-animator-webview-harness.mjs';
import { cutFixture, captionHost } from './caption-animator-cut-fixture.mjs';
const { applyCaptionAnimatorDom } = frameEngine;

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
    assert.match(view.plate.innerHTML, /<p class="akari-caption__line">&lt;次&gt;<\/p>/);
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

test('無宣言の HTML は caption transform 規則を含む基底のバイト列を保持する', () => {
    // Recorded after the caption plate scale/rotate contract was added to every styled fragment,
    // and after plain (unstyled) captions started rendering through the same fragment path.
    const expected = [
        '202c60f99ed93d846212ce844e55062b9279ce4d447b8989cafaa82f9df58493',
        'e76192da9e083a9f58361c4092a3772c1d1197da57d55863152e2835a4d216ea',
        '1062b1e3bf49c6df29a039e941f853e92316f04f9a04bb860f6854990b24f51e',
        'a1d132b35aad29a165bcdd932df37bb0bd5061e0fc76008db6fcf03f8ec73245',
        '739c7d583399fe5c0d789d15ab34b4c1eed9160f71322ee35eb7a268b21a2850',
        'f333c8a196553b83c3cdad333505c21b906e7c804bd20ad3d23ee4e64af5ef0e',
        'e240e36bf483a6b9ed12d94f3762810c9667a53bf7329c074cc662668c175b1e'
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
    assert.ok(view.plate.innerHTML.includes(
        '<span class="akari-caption__char" data-akari-char="0">&quot;</span>'
        + '<span class="akari-caption__char" data-akari-char="1">&#39;</span>'
        + '<span class="akari-caption__char" data-akari-char="2">&lt;</span>'
        + '<span class="akari-caption__char" data-akari-char="3">&gt;</span>'
        + '<span class="akari-caption__char" data-akari-char="4">&amp;</span>'));
});

for (const engine of [true, false]) {
    test(`${engine ? 'frame-engine' : 'DOM video'}: tick/seek は実際の選択関数で字幕・cut・layer と HTML を排他化する`, () => {
        const view = harness({ engine, cues: [cue] });
        let selected = null;
        const events = [];
        const microtasks = [];
        const overlay = {
            children: [], style: { visibility: 'visible' },
            getAttribute: name => name === 'data-overlay-id' ? 'html-1' : null,
            getBoundingClientRect: () => ({ left: 40, top: 20, width: 120, height: 60 }),
            dispatchEvent(event) { events.push(event); selected = this; }
        };
        Object.assign(view.context, {
            stage: {
                querySelector: selector => selector.includes('data-overlay-id') ? selected : selected && {},
                querySelectorAll: () => [overlay]
            },
            getComputedStyle: element => element.style,
            MouseEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
            KeyboardEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
            queueMicrotask: task => microtasks.push(task)
        });
        view.context.window.addEventListener('keydown', event => {
            events.push(event);
            if (event.key === 'Escape') selected = null;
        });
        view.context.summary.layers = [{ id: 'layer-1' }];
        view.context.video.dataset = { akariCutId: 'cut-1' };
        const selectHtml = () => {
            view.run("requestedOverlayId = 'html-1';");
            view.tick(4);
            assert.equal(selected, overlay);
            assert.equal(view.run('applyingOverlaySelection'), 'html-1');
            microtasks.shift()();
            assert.equal(view.run('applyingOverlaySelection'), undefined);
            assert.deepEqual([events.at(-1).type, events.at(-1).clientX, events.at(-1).clientY], ['click', 100, 50]);
        };
        selectHtml();
        view.tick(4.2);
        assert.equal(events.length, 1, 'already selected HTML is not clicked again');
        view.context.requestedCutId = 'cut-1';
        view.context.cutSelected = true;
        view.context.selectedLayerId = 'layer-1';
        view.selectionEffects.length = 0;
        view.run("selectCaption('c1', { report: false });");
        assert.equal(view.context.selectedCaptionId, 'c1');
        assert.equal(view.context.requestedCutId, undefined);
        assert.equal(view.context.cutSelected, false);
        assert.equal(view.context.selectedLayerId, null);
        assert.deepEqual(view.selectionEffects, ['cut-box', 'caption-box']);
        assert.equal(view.run('requestedOverlayId'), null);
        view.seek(4.5);
        assert.equal(selected, null);
        assert.equal(events.at(-1).key, 'Escape');
        const count = events.length;
        view.tick(4.6);
        assert.equal(events.length, count, 'cleared HTML is not cleared again');
        for (const kind of ['Cut', 'Layer']) {
            selectHtml();
            view.run(kind === 'Cut' ? 'selectCut({ report: false });'
                : "selectLayer('layer-1', { report: false });");
            assert.equal(view.context.selectedCaptionId, null);
            assert.equal(view.context.cutSelected, kind === 'Cut');
            assert.equal(view.context.selectedLayerId, kind === 'Layer' ? 'layer-1' : null);
            assert.equal(view.run('requestedOverlayId'), null);
            if (engine) view.installEngineSeek().seek(4.5);
            else view.seek(4.5);
            assert.equal(selected, null);
            assert.equal(events.at(-1).key, 'Escape');
        }
    });
}
