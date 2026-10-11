import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { normalizeLanguage, packLanguage, resolveContentLanguage } from '../src/index.mjs';
import { readContentLanguage, readContentLanguageSync } from '../src/node.mjs';

test('normalizes valid tags and rejects empty or malformed tags', () => {
  for (const [input, expected] of [
    ['en-US', 'en'], ['JA', 'ja'], ['zh-Hant-CN', 'zh'],
    ['', null], ['english', null], ['en_US', null], ['en--US', null], [4, null],
  ]) assert.equal(normalizeLanguage(input), expected);
});

test('resolves every priority tier and skips invalid candidates', () => {
  const intake = { language: 'fr-CA' };
  const analysis = { transcript: [], transcript_language: 'ko-KR' };
  assert.deepEqual(resolveContentLanguage({ cliLang: 'EN-us', intake, analysis }), { language: 'en', source: 'cli' });
  assert.deepEqual(resolveContentLanguage({ cliLang: 'invalid', intake, analysis }), { language: 'fr', source: 'intake' });
  assert.deepEqual(resolveContentLanguage({ intake, analysis }), { language: 'fr', source: 'intake' });
  assert.deepEqual(resolveContentLanguage({ analysis }), { language: 'ko', source: 'transcript' });
  assert.deepEqual(resolveContentLanguage({ intake: { language: '' }, analysis }), { language: 'ko', source: 'transcript' });
  assert.deepEqual(resolveContentLanguage({ analysis: { transcript: [] } }), { language: 'ja', source: 'default' });
  assert.deepEqual(resolveContentLanguage({ analysis: { transcript: { language: 'en' } } }), { language: 'ja', source: 'default' });
  assert.deepEqual(resolveContentLanguage(), { language: 'ja', source: 'default' });
});

test('selects exact, Japanese, English, and first available packs', () => {
  assert.equal(packLanguage('fr', ['ja', 'en', 'fr']), 'fr');
  assert.equal(packLanguage('ja', ['en']), 'ja');
  assert.equal(packLanguage('ko', ['ja', 'en']), 'en');
  assert.equal(packLanguage('ko', ['fr', 'ja']), 'fr');
});

test('reads project files and falls through missing or malformed JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'content-language-'));
  try {
    assert.deepEqual(await readContentLanguage(root), { language: 'ja', source: 'default' });
    await writeFile(join(root, 'analysis.json'), '{"transcript":[],"transcript_language":"en-US"}');
    assert.deepEqual(await readContentLanguage(root), { language: 'en', source: 'transcript' });
    await writeFile(join(root, 'intake.json'), '{broken');
    assert.deepEqual(await readContentLanguage(root), { language: 'en', source: 'transcript' });
    await mkdir(join(root, '.akari'));
    await writeFile(join(root, '.akari', 'intake.json'), '{"language":"fr"}');
    assert.deepEqual(await readContentLanguage(root), { language: 'fr', source: 'intake' });
    await writeFile(join(root, 'intake.json'), '{"language":"ko"}');
    assert.deepEqual(await readContentLanguage(root), { language: 'fr', source: 'intake' });
    await writeFile(join(root, '.akari', 'intake.json'), '{broken');
    assert.deepEqual(await readContentLanguage(root), { language: 'ko', source: 'intake' });
    assert.deepEqual(await readContentLanguage(root, { cliLang: 'JA' }), { language: 'ja', source: 'cli' });
    await writeFile(join(root, 'analysis.json'), '{broken');
    assert.deepEqual(await readContentLanguage(root, { cliLang: 'bad tag' }), { language: 'ko', source: 'intake' });
    await writeFile(join(root, 'intake.json'), '{broken');
    await writeFile(join(root, '.akari', 'intake.json'), '{broken');
    assert.deepEqual(await readContentLanguage(root), { language: 'ja', source: 'default' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
import { captionLanguageDefaults } from '../src/index.mjs';

test('caption defaults use the primary language and English fallback', () => {
  assert.equal(captionLanguageDefaults('ja-JP').landscapeCharacters, 20);
  assert.equal(captionLanguageDefaults('en').landscapeCharacters, 42);
  assert.equal(captionLanguageDefaults('en-US').portraitCharacters, 24);
  assert.equal(captionLanguageDefaults('fr-FR').charactersPerSecond, 17);
  assert.equal(captionLanguageDefaults('ja').charactersPerSecond, null);
});

test('synchronous project language reader follows the asynchronous precedence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'content-language-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'analysis.json'), JSON.stringify({ transcript_language: 'en-US' }));
  assert.deepEqual(readContentLanguageSync(root), await readContentLanguage(root));
  assert.deepEqual(readContentLanguageSync(root, { cliLang: 'ja-JP' }),
    { language: 'ja', source: 'cli' });
});
