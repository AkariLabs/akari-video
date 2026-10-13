import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parsePresetShowcaseJsonl, presetShowcaseTooltip } from '../lib/common/preset-showcase.js';

const root = new URL('../../../../../', import.meta.url);
const kinds = ['luts', 'textanim', 'textstyle', 'transitions', 'shapes', 'looks'];
const displayFields = new Set(['name', 'category', 'description', 'sample_text', 'when_to_use']);

test('six preset kinds have English overlays for every Japanese display field', () => {
    for (const kind of kinds) {
        const rows = readFileSync(new URL(`presets/${kind}/index.jsonl`, root), 'utf8').trim().split(/\r?\n/u).map(JSON.parse);
        const missing = rows.flatMap(row => [...displayFields].filter(field =>
            typeof row[field] === 'string' && row[field].trim() && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(row[field])
            && !(typeof row.i18n?.en?.[field] === 'string' && row.i18n.en[field].trim())).map(field => `${row.id}.${field}`));
        assert.deepEqual(missing, [], `${kind}: ${missing.join(', ')}`);
        for (const row of rows) for (const field of displayFields) if (row.i18n?.en?.[field]) {
            assert.doesNotMatch(row.i18n.en[field], /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, `${kind}/${row.id}.${field}`);
        }
    }
});

test('English LUT tooltips retain translated usage and missing fields fall back to base', () => {
    const raw = readFileSync(new URL('presets/luts/index.jsonl', root), 'utf8');
    const english = parsePresetShowcaseJsonl(raw, 'lut', 'en');
    const japanese = parsePresetShowcaseJsonl(raw, 'lut', 'ja');
    assert.equal(english.length, 10);
    assert.ok(english.every(item => item.whenToUse && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(item.whenToUse)));
    assert.ok(japanese.every(item => item.whenToUse));
    const missing = JSON.stringify({ id: 'example', name: '基底', description: '説明', when_to_use: '使用場面',
        tags: ['lut'], i18n: { en: { name: 'Example', description: 'Description' } } });
    const [item] = parsePresetShowcaseJsonl(missing, 'lut', 'en');
    assert.equal(item.whenToUse, undefined);
    assert.equal(item.baseWhenToUse, '使用場面');
    assert.equal(presetShowcaseTooltip(item), 'Description\n使用場面');
});
