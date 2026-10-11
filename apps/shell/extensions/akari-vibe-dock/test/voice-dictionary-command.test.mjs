import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
process.on('exit', () => setLanguage(undefined));
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { t } = require('../lib/browser/vibe-text.js');

test('辞書を開くコマンドが日本語ラベルで登録される', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../src/browser/voice-dictionary-frontend-module.ts'), 'utf8');
    assert.match(source, /registerCommand\(\{ id: 'akari\.voiceDictionary\.open', label: t\('vibe\.dictionary\.command\.openVoiceDictionaryAction'\) \}/u);
    assert.equal(t('vibe.dictionary.command.openVoiceDictionaryAction'), '声の辞書を開く');
    assert.match(source, /new VoiceDictionaryDialog\(this\.service, this\.preferences\)\.open\(\)/u);
    assert.match(source, /default: false/u);
});
