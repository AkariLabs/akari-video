import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('辞書を開くコマンドが日本語ラベルで登録される', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/browser/voice-dictionary-frontend-module.ts'), 'utf8');
    assert.match(source, /registerCommand\(\{ id: 'akari\.voiceDictionary\.open', label: '声の辞書を開く' \}/u);
    assert.match(source, /new VoiceDictionaryDialog\(this\.service, this\.preferences\)\.open\(\)/u);
    assert.match(source, /default: false/u);
});
