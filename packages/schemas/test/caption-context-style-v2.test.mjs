import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../captions.schema.json', import.meta.url), 'utf8'));

test('字幕 style v2 の取り消し線・箇条書き・透明度はスキーマにある', () => {
    const style = schema.$defs.textStyle.properties;
    assert.deepEqual(style.strikethrough, { type: 'boolean' });
    assert.deepEqual(style.list, { enum: ['bullet', null] });
    assert.deepEqual(style.opacity, { type: 'number', minimum: 0, maximum: 1 });
});
