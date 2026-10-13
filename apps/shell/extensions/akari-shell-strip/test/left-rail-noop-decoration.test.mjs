import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('左レールは同じフレームの要求をまとめ、値が同じ属性を書かない', async () => {
    const source = await readFile(new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'utf8');
    assert.match(source, /if \(this\.leftRailDecorateFrame\) return/);
    assert.match(source, /if \(element\.getAttribute\(name\) !== value\) element\.setAttribute\(name, value\)/);
    assert.match(source, /if \(element\.classList\.contains\(name\) !== on\) element\.classList\.toggle\(name, on\)/);
    assert.match(source, /if \(element\.title !== titleText\) element\.title = titleText/);
});
