import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Ajv = require('ajv');
const root = new URL('../../../../../', import.meta.url);
const directory = new URL('presets/textstyle/', root);
const schema = JSON.parse(readFileSync(new URL('packages/schemas/captions.schema.json', root)));
const validateStyle = new Ajv({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/textStyle' });

test('同梱 36 スタイルは index・ファイル・captions textStyle スキーマで一致する', () => {
    const rows = readFileSync(new URL('index.jsonl', directory), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length, 36);
    assert.equal(new Set(rows.map(row => row.id)).size, 36);
    for (const row of rows) {
        assert.equal(row.kind, 'textstyle', row.id);
        const preset = JSON.parse(readFileSync(new URL(`${row.id}.json`, directory)));
        assert.equal(preset.format, 'akari-textstyle');
        assert.equal(preset.id, row.id);
        assert.deepEqual(preset.style, row.style);
        assert.ok(validateStyle(row.style), `${row.id}: ${JSON.stringify(validateStyle.errors)}`);
    }
    const added = rows.slice(12);
    assert.equal(added.length, 24);
    for (const row of added) {
        assert.equal(Object.hasOwn(row.style, 'font_family'), false,
            `${row.id}: 追加スタイルは OSR / GPU で効かない書体指定を持たない`);
    }
});
