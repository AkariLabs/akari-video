import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('台本のカット失敗は理由を表示し生の例外名を見せない', async () => {
    const source = await readFile(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url), 'utf8');
    const start = source.indexOf('protected async applyCutEntries(');
    const end = source.indexOf('protected cutSpanFor(', start);
    const method = source.slice(start, end);
    assert.match(method, /this\.notifyError\(/);
    assert.match(method, /TypeError\|ReferenceError\|Error/);
});
