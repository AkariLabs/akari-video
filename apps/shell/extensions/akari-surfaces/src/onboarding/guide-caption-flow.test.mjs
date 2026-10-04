import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ONBOARDING_STEPS, INITIAL_ONBOARDING_STATE } = require('../../lib/onboarding/model.js');
const { HELP_DELAY, CAPTION_GUIDE_COPY, DAIHON_GUIDE_COPY, MATERIAL_PREVIEW_SELECT_COPY,
    guideWaitingHint, guideOffersHelpNext } = require('../../lib/onboarding/guide-copy.js');
const { ONBOARDING_CSS } = require('../../lib/onboarding/style.js');

test('全段の補助は本文の言い直しを避け、残す補助は新しい場所の手がかりを足す', () => {
    const states = [];
    for (const step of ONBOARDING_STEPS) for (const imported of [false, true])
        for (let sub = 0; sub < 5; sub++) states.push({ ...INITIAL_ONBOARDING_STATE, step, sub, imported });
    // A repeated quoted control name or the same action target is redundant. Only the
    // material-preview hint adds both "left" and "card", absent from its title/body.
    for (const state of states) {
        const hint = guideWaitingHint(state);
        if (!hint) continue;
        assert.equal(state.step, 'matpreview');
        assert.equal(state.sub, 0);
        const copy = MATERIAL_PREVIEW_SELECT_COPY.title + MATERIAL_PREVIEW_SELECT_COPY.body;
        for (const token of hint.matchAll(/「([^」]+)」/g)) assert.ok(!copy.includes(token[1]));
        for (const clue of ['左', 'カード']) {
            assert.ok(hint.includes(clue), `hint must add ${clue}`);
            assert.ok(!copy.includes(clue), `coach already says ${clue}`);
        }
    }
    for (const step of ['drag', 'ask', 'prompt', 'play', 'caption', 'daihon', 'export'])
        for (const sub of [0, 1, 2]) assert.equal(guideWaitingHint({ ...INITIAL_ONBOARDING_STATE, step, sub }), undefined);
});

test('補助がなくても次へは1.5秒で出る', () => {
    assert.equal(HELP_DELAY.next, 1500);
    assert.ok(HELP_DELAY.next <= 2000);
    assert.equal(HELP_DELAY.hint, 4000);
    for (const [step, sub] of [['drag', 0], ['prompt', 1], ['play', 0], ['caption', 0],
        ['daihon', 0], ['daihon', 1], ['export', 0], ['export', 1], ['export', 2]]) {
        assert.equal(guideOffersHelpNext({ ...INITIAL_ONBOARDING_STATE, step, sub }), true, `${step} sub${sub}`);
    }
    assert.equal(guideOffersHelpNext({ ...INITIAL_ONBOARDING_STATE, step: 'drag', imported: true }), false);
});

test('字幕は選択・見た目・位置の三段で、台本の案内は短い', () => {
    assert.equal(CAPTION_GUIDE_COPY.length, 3);
    assert.deepEqual(CAPTION_GUIDE_COPY.map(copy => copy.title), [
        '字幕を押すと、その場で直せます', '見た目を変えてみましょう', '位置も動かせます'
    ]);
    assert.ok(CAPTION_GUIDE_COPY.every(copy => !/大きさ|つまみ/.test(copy.title + copy.body)));
    assert.equal(DAIHON_GUIDE_COPY.length, 3);
    for (const copy of DAIHON_GUIDE_COPY) {
        const body = copy.body.replace(/<[^>]+>/g, '');
        assert.ok(body.length <= 60, body);
        assert.ok((body.match(/。/g) ?? []).length <= 2, body);
    }
    assert.ok(DAIHON_GUIDE_COPY[0].body.replace(/<[^>]+>/g, '').length <= 40);
});

test('補助の CSS は本文より詳細度が高く、色と文字サイズが異なる', () => {
    const declaration = selector => {
        const at = ONBOARDING_CSS.indexOf(`${selector} {`);
        return at < 0 ? undefined : ONBOARDING_CSS.slice(at).split('}')[0];
    };
    const body = declaration('#akari-onboarding-v1 .ao-coach p');
    const hint = declaration('#akari-onboarding-v1 .ao-coach p.ao-help');
    assert.ok(body && hint);
    assert.notEqual(body.match(/color:([^;]+)/)?.[1], hint.match(/color:([^;]+)/)?.[1]);
    assert.ok(Number(hint.match(/font-size:(\d+)px/)?.[1]) < Number(body.match(/font-size:(\d+)px/)?.[1]));
    assert.ok('#akari-onboarding-v1 .ao-coach p.ao-help'.split('.').length
        > '#akari-onboarding-v1 .ao-coach p'.split('.').length);
});
