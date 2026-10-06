import assert from 'node:assert/strict';
import test from 'node:test';
import { readAllSourceText } from './helpers/daihon-source.mjs';

test('その他メニューから発話合わせ直し RPC と履歴へつなぐ', async () => {
    const source = readAllSourceText();
    assert.match(source, /this\.popButton\('⏱ 発話に合わせ直す…'/);
    assert.match(source, /buildCaptions\(\{ projectRoot, \.\.\.\{ editUri: this\.editUri!\.toString\(\) \}, source: source\.id, retime: true \}\)/);
    assert.match(source, /withHistory\('発話に合わせ直す'/);
    assert.match(source, /captionsRetimeLine\(moved, retimeSummary\)/);
});
