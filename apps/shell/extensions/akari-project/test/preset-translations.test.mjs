import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kinds = ['luts', 'textanim', 'textstyle', 'transitions', 'shapes', 'looks'];
const japanese = /[぀-ヿ㐀-鿿＀-￯]/u;

for (const kind of kinds) test(`${kind} has complete English display fields`, () => {
    const rows = readFileSync(new URL(`../../../../../presets/${kind}/index.jsonl`, import.meta.url), 'utf8')
        .trim().split('\n').map(JSON.parse);
    assert.ok(rows.length > 0);
    for (const row of rows) {
        assert.equal('ja' in (row.i18n ?? {}), false, row.id);
        assert.equal(typeof row.i18n?.en?.name, 'string', row.id);
        for (const field of ['name', 'category', 'description', 'sample_text']) {
            if (field in row) assert.equal(typeof row.i18n.en[field], 'string', `${row.id}.${field}`);
        }
        for (const [field, value] of Object.entries(row.i18n.en)) {
            assert.ok(value.length > 0, `${row.id}.${field}`);
            assert.equal(japanese.test(value), false, `${row.id}.${field}: ${value}`);
        }
    }
});
