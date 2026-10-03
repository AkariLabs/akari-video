import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { libraryTextstyleApplyPayload } from '../lib/common/library-textstyle-apply.js';
import { planLibraryApply } from '../../akari-annotations/lib/browser/library-apply-plan.js';
import { replaceMyStylePartsInSource } from '../../akari-annotations/lib/browser/my-style-look.js';

test('既存字幕へ同梱スタイルを当てると大文字化と animation が captions.json に残る', () => {
    for (const id of ['glitch', 'neon', 'emphasis-red']) {
        const preset = JSON.parse(readFileSync(new URL(`../../../../../presets/textstyle/${id}.json`, import.meta.url)));
        const payload = libraryTextstyleApplyPayload({ kind: 'textstyle', id, name: preset.name,
            tags: [], style: preset.style });
        const plan = planLibraryApply(payload, { kind: 'caption', id: 'c-0001' });
        assert.equal(plan?.kind, 'caption');
        const source = JSON.stringify({ captions: [{ id: 'c-0001', start: 0, end: 2, text: 'sample',
            text_style: { color: '#333333', animation: { in: { id: 'old' } } } }] });
        const after = JSON.parse(replaceMyStylePartsInSource(source, ['c-0001'], plan.parts,
            { keepSize: plan.keepSize, catalog: plan.catalog }));
        const applied = after.captions[0].text_style;
        assert.equal(applied.text_transform, preset.style.text_transform);
        assert.deepEqual(applied.animation, preset.style.animation);
    }
});

test('ライブラリ由来のリッチスタイルは適用先のサイズを保ち fill と strokes を写す', () => {
    const fill = { type: 'gradient', angle_deg: 180,
        stops: [{ at: 0, color: '#111111' }, { at: 100, color: '#ffffff' }] };
    const strokes = [{ color: '#000000', width_px: 10 }, { color: '#ffffff', width_px: 4 }];
    const payload = libraryTextstyleApplyPayload({ kind: 'textstyle', id: 'custom-rich',
        name: 'リッチ', tags: [], style: { size_px: 168, fill, strokes } });
    const plan = planLibraryApply(payload, { kind: 'caption', id: 'one' });
    assert.equal(plan?.kind, 'caption');
    const source = JSON.stringify({ captions: [{ id: 'one', text_style: { size_px: 56 } }] });
    const applied = JSON.parse(replaceMyStylePartsInSource(source, ['one'], plan.parts,
        { keepSize: plan.keepSize, catalog: plan.catalog }))
        .captions[0].text_style;
    assert.equal(applied.size_px, 56);
    assert.deepEqual(applied.fill, fill);
    assert.deepEqual(applied.strokes, [{ color: '#000000', width_px: 10 * (56 / 168) },
        { color: '#ffffff', width_px: 4 * (56 / 168) }]);
});

test('左の合算カタログで置いたライブラリ字幕は別スタイルをかけても大きさを保つ', () => {
    const catalog = { 'library-original': { style: { size_px: 120 } } };
    const payload = libraryTextstyleApplyPayload({ kind: 'textstyle', id: 'subtitle-news',
        name: 'ニュース', tags: [], style: { size_px: 56, color: '#fff' } }, catalog);
    const plan = planLibraryApply(payload, { kind: 'caption', id: 'one' });
    assert.equal(plan?.kind, 'caption');
    const source = JSON.stringify({ captions: [{ id: 'one', style_preset: 'library-original', text_style: {} }] });
    const applied = JSON.parse(replaceMyStylePartsInSource(source, ['one'], plan.parts,
        { keepSize: plan.keepSize, catalog: plan.catalog })).captions[0];
    assert.equal(applied.style_preset, undefined);
    assert.equal(applied.text_style.size_px, 120);
});
