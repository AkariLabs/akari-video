import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('台本ヘッダは発話合わせ直しボタンから retime RPC・footer・履歴へつなぐ', async () => {
    const source = await readFile(fileURLToPath(new URL('../src/browser/daihon/akari-daihon-widget.ts', import.meta.url)), 'utf8');
    assert.match(source, /textContent = '⏱ 発話に合わせ直す'/);
    assert.match(source, /buildCaptions\(\{ projectRoot, source: source\.id, retime: true \}\)/);
    assert.match(source, /withHistory\('発話に合わせ直す'/);
    assert.match(source, /captionsRetimeLine\(moved, retimeSummary\)/);
});
