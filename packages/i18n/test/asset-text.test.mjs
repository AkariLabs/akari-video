import assert from 'node:assert/strict';
import test from 'node:test';
import { localizedAssetText, localizedKnobLabel, translatedKnobLabel, localizedPresetText } from '../index.mjs';

const meta = { id: 'sample', title: '基底', aliases: ['別名'], description: '基底の説明',
    knobs: [{ cssVar: '--tone', label: '色調' }, { param: 'speed', label: '速さ' }],
    i18n: { en: { title: 'Sample', aliases: ['Example'], knobs: { '--tone': 'Tone', speed: 'Speed' } },
        fr: { description: 'Description française' } } };

test('asset text resolves each field independently', () => {
    assert.equal(localizedAssetText(meta, 'title', 'ja'), '基底');
    assert.equal(localizedAssetText(meta, 'title', 'en'), 'Sample');
    assert.equal(localizedAssetText(meta, 'title', 'fr'), 'Sample');
    assert.equal(localizedAssetText(meta, 'description', 'fr'), 'Description française');
    assert.equal(localizedAssetText(meta, 'description', 'en'), '基底の説明');
    assert.deepEqual(localizedAssetText(meta, 'aliases', 'en'), ['Example']);
    assert.deepEqual(localizedAssetText(meta, 'aliases', 'ja'), ['別名']);
    assert.equal(localizedAssetText({ id: 'bare' }, 'title', 'en'), 'bare');
    assert.equal(localizedAssetText({ id: 'bare', title: '基底' }, 'title', 'en'), '基底');
});

test('knob labels resolve cssVar and param independently', () => {
    assert.equal(localizedKnobLabel(meta, meta.knobs[0], 'ja'), '色調');
    assert.equal(localizedKnobLabel(meta, meta.knobs[0], 'en'), 'Tone');
    assert.equal(localizedKnobLabel(meta, meta.knobs[1], 'fr'), 'Speed');
    assert.equal(localizedKnobLabel({ id: 'sample' }, { param: 'speed' }, 'en'), 'speed');
    assert.equal(translatedKnobLabel(meta, { cssVar: '--tone' }, 'en'), 'Tone');
    assert.equal(translatedKnobLabel(meta, { cssVar: '--tone' }, 'ja'), undefined);
    assert.equal(translatedKnobLabel(meta, { cssVar: '--missing' }, 'en'), undefined);
});

test('preset fields use the same fallback order', () => {
    const row = { id: 'fade', name: '基底', category: '切替', i18n: { en: { name: 'Fade' }, fr: { category: 'Transition' } } };
    assert.equal(localizedPresetText(row, 'name', 'ja'), '基底');
    assert.equal(localizedPresetText(row, 'name', 'fr'), 'Fade');
    assert.equal(localizedPresetText(row, 'category', 'fr'), 'Transition');
    assert.equal(localizedPresetText(row, 'description', 'en'), undefined);
});


test('only asset title and preset name fall back to id', () => {
    const asset = { id: 'bare-id' };
    const preset = { id: 'fade' };
    for (const language of ['ja', 'en']) {
        assert.equal(localizedAssetText(asset, 'title', language), 'bare-id');
        for (const field of ['description', 'when_to_use', 'aliases']) {
            assert.equal(localizedAssetText(asset, field, language), undefined);
        }
        assert.equal(localizedPresetText(preset, 'name', language), 'fade');
        for (const field of ['category', 'description', 'sample_text']) {
            assert.equal(localizedPresetText(preset, field, language), undefined);
        }
    }
});

test('malformed translations and base values fall through without leaking invalid values', () => {
    for (const bad of ['', '   ', 5, null, {}, []]) {
        assert.equal(localizedAssetText({ id: 'asset', title: 'Base', i18n: { en: { title: bad } } }, 'title', 'en'), 'Base');
        assert.equal(localizedAssetText({ id: 'asset', title: bad }, 'title', 'ja'), 'asset');
        assert.equal(localizedKnobLabel({ i18n: { en: { knobs: { '--a': bad } } } },
            { cssVar: '--a', label: 'Base label' }, 'en'), 'Base label');
    }
    const meta = { id: 'asset', title: 'Base', aliases: ['Base alias'],
        i18n: { fr: { title: '  ', aliases: ['', 4] }, en: { title: 'English', aliases: [null, 'Alias', ''] } } };
    assert.equal(localizedAssetText(meta, 'title', 'fr'), 'English');
    assert.deepEqual(localizedAssetText(meta, 'aliases', 'fr'), ['Alias']);
    assert.deepEqual(localizedAssetText({ ...meta, i18n: { en: { aliases: ['', 3] } } }, 'aliases', 'en'), ['Base alias']);
    for (const i18n of [null, [], 'broken', { en: null }, { en: { knobs: [] } }]) {
        assert.equal(localizedAssetText({ id: 'asset', title: 'Base', i18n }, 'title', 'en'), 'Base');
        assert.equal(localizedKnobLabel({ i18n }, { cssVar: '--a', label: 'Base label' }, 'en'), 'Base label');
    }
    assert.equal(localizedKnobLabel({ i18n: { en: { knobs: { '--a': 'English' } } } },
        { cssVar: '--a', label: 3 }, 'ja'), '--a');
});
