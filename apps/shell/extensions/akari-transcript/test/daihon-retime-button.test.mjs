import assert from 'node:assert/strict';
import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';

test('台本ヘッダは発話合わせ直しボタンから retime RPC・footer・履歴へつなぐ', async () => {
    const source = readAllSourceText();
    assert.match(source, /textContent = '⏱ 発話に合わせ直す'/);
    assert.match(source, /buildCaptions\(\{ projectRoot, \.\.\.\{ editUri: this\.editUri!\.toString\(\) \}, source: source\.id, retime: true \}\)/);
    assert.match(source, /withHistory\('発話に合わせ直す'/);
    assert.match(source, /captionsRetimeLine\(moved, retimeSummary\)/);
});
