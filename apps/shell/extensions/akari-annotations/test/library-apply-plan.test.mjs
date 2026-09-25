import assert from 'node:assert/strict';
import test from 'node:test';
import { captionLibraryApplyFeedback, planLibraryApply, shouldShowTextPlaceBand, timelineApplyTarget } from '../lib/browser/library-apply-plan.js';

const caption = { kind: 'caption', id: 'caption-1' };
const cut = { kind: 'cut', id: 'cut-1' };

test('文字の動き、見た目、マイスタイル、フォントを位置情報なしで計画する', () => {
    const plans = [
        planLibraryApply({ kind: 'textanim', id: 'fade', slot: 'in' }, caption),
        planLibraryApply({ kind: 'textstyle', id: 'bold', style: { color: '#fff' } }, caption),
        planLibraryApply({ kind: 'mystyle', style: { parts: [{ kind: 'look', text_style: { color: '#eee' } },
            { kind: 'motion', animation: { in: { id: 'pop' } } }, { kind: 'fx' }] } }, caption),
        planLibraryApply({ kind: 'font', id: 'font-1', fontFamily: 'Zen Kaku' }, caption)
    ];
    assert.deepEqual(plans.map(plan => plan?.parts.map(part => part.kind)),
        [['motion'], ['look'], ['look', 'motion', 'fx'], ['look']]);
    for (const plan of plans) {
        assert.equal(plan.id, caption.id);
        assert.equal(JSON.stringify(plan).includes('position'), false);
        assert.equal(JSON.stringify(plan).includes('transform'), false);
    }
    assert.equal(plans[0].parts[0].animation.in.id, 'fade');
    assert.equal(plans[3].parts[0].text_style.font_family, 'Zen Kaku');
});

test('LUT は映像の item だけ、相手が無ければ書き込み計画なし', () => {
    assert.deepEqual(planLibraryApply({ kind: 'lut', id: 'warm' }, cut), { kind: 'lut', id: cut.id, lut: 'warm' });
    assert.equal(planLibraryApply({ kind: 'lut', id: 'warm' }, caption), undefined);
    assert.equal(planLibraryApply({ kind: 'font', fontFamily: 'A' }, cut), undefined);
    assert.equal(planLibraryApply({ kind: 'textanim', id: 'fade' }), undefined);
});

test('字幕チップは文字系、映像チップは LUT だけが光る対象になる', () => {
    assert.deepEqual(timelineApplyTarget('textanim', 'caption', 'caption-1'), caption);
    assert.deepEqual(timelineApplyTarget('textstyle', 'caption', 'caption-1'), caption);
    assert.deepEqual(timelineApplyTarget('mystyle', 'caption', 'caption-1'), caption);
    assert.equal(timelineApplyTarget('font', 'cut', '0', ['cut-1']), undefined);
    assert.deepEqual(timelineApplyTarget('lut', 'cut', '0', ['cut-1']), cut);
    assert.deepEqual(timelineApplyTarget('lut', 'layer', 'photo-1'), { kind: 'layer', id: 'photo-1' });
    assert.equal(timelineApplyTarget('lut', 'caption', 'caption-1'), undefined);
    assert.equal(timelineApplyTarget('textanim', undefined, undefined), undefined);
});

test('置く帯は文字を置く種類だけで、かける専用カードには出さない', () => {
    for (const kind of ['text', 'textstyle', 'mystyle']) assert.equal(shouldShowTextPlaceBand(kind), true);
    for (const kind of ['textanim', 'font', 'lut']) assert.equal(shouldShowTextPlaceBand(kind), false);
});

test('文字へかけた種類ごとの履歴と足元の言葉を返し、既存のマイスタイルには割り込まない', () => {
    assert.deepEqual(captionLibraryApplyFeedback('textanim'), { history: '動きを当てる', footer: '動きを当てました。' });
    assert.deepEqual(captionLibraryApplyFeedback('textstyle'), { history: 'スタイルを当てる', footer: 'スタイルを当てました。' });
    assert.deepEqual(captionLibraryApplyFeedback('font'), { history: 'フォントを変える', footer: 'フォントを変えました。' });
    assert.equal(captionLibraryApplyFeedback('mystyle'), undefined);
    assert.equal(captionLibraryApplyFeedback(undefined), undefined);
});
