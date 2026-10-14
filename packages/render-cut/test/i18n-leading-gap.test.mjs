import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('leading-gap messages resolve from the packaged render-cut src subtree', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'render-cut-i18n-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const src = join(root, 'src');
  await mkdir(join(src, 'locales'), { recursive: true });
  await copyFile(new URL('../src/i18n.mjs', import.meta.url), join(src, 'i18n.mjs'));
  for (const language of ['en', 'ja']) {
    await copyFile(new URL(`../src/locales/${language}.json`, import.meta.url),
      join(src, 'locales', `${language}.json`));
  }
  const { renderText } = await import(pathToFileURL(join(src, 'i18n.mjs')).href);
  for (const language of ['en', 'ja']) {
    for (const key of ['render.verify.leadingGap.early', 'render.verify.leadingGap.ok']) {
      const message = renderText(key, { gap: '2.00', expected: '11.1', early: '3.2' }, language);
      assert.notEqual(message, key);
      assert.ok(message.includes('2.00') && message.includes('11.1') && message.includes('3.2'));
      assert.doesNotMatch(message, /\{(?:gap|expected|early)\}/u);
    }
  }
  assert.notEqual(renderText('render.verify.leadingGap.ok', { gap: '2.00' }, 'en'),
    renderText('render.verify.leadingGap.ok', { gap: '2.00' }, 'ja'));
});
