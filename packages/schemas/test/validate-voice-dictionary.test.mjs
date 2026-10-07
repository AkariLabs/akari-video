import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateVoiceDictionary, runValidateVoiceDictionaryCli } from '../bin/validate-voice-dictionary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = name => JSON.parse(readFileSync(path.join(root, 'examples', name, 'voice-dictionary.json'), 'utf8'));

test('有効例と未知フィールドを受け入れる', () => {
  const result = validateVoiceDictionary(fixture('voice-dictionary-v0-valid'));
  assert.equal(result.valid, true);
  assert.match(result.info.join(' '), /unknown-field/);
});
test('新しい版は read-only 扱いで拒否する', () => {
  const result = validateVoiceDictionary(fixture('voice-dictionary-v0-invalid-version-1'));
  assert.equal(result.valid, false);
  assert.equal(result.tooNew, true);
});
test('fix と snippet の正規化キー衝突を拒否する', () => {
  assert.match(validateVoiceDictionary(fixture('voice-dictionary-v0-invalid-key-conflict')).errors.join(' '), /衝突/);
});
test('Jev scope を拒否する', () => {
  assert.match(validateVoiceDictionary(fixture('voice-dictionary-v0-invalid-jev-scope')).errors.join(' '), /jev/);
});
test('鍵と絶対パスは警告だけを出す', () => {
  const value = { version: 0, entries: [{ id: 'vd-1', kind: 'snippet', trigger: ['合言葉'], expand: 'Bearer ' + 'a'.repeat(41) + ' /' + 'Users/example/file' }] };
  const result = validateVoiceDictionary(value);
  assert.equal(result.valid, true);
  assert.equal(result.warnings.length, 2);
});
test('CLI の終了コード', () => {
  const io = { stdout() {}, stderr() {} };
  assert.equal(runValidateVoiceDictionaryCli([path.join(root, 'examples/voice-dictionary-v0-valid/voice-dictionary.json')], io), 0);
  assert.equal(runValidateVoiceDictionaryCli([path.join(root, 'examples/voice-dictionary-v0-invalid-jev-scope/voice-dictionary.json')], io), 1);
});
