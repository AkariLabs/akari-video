import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEGIN, END, renderDocument } from '../gen-generation-models-doc.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repoRoot, 'scripts/gen-generation-models-doc.mjs');
const catalog = JSON.parse(readFileSync(join(repoRoot, 'packages/schemas/gen-models.json'), 'utf8'));
const paths = {
  ja: join(repoRoot, 'docs/guides/generation-models.ja.md'),
  en: join(repoRoot, 'docs/guides/generation-models.md')
};
const documents = Object.fromEntries(Object.entries(paths).map(([locale, path]) => [locale, readFileSync(path, 'utf8')]));
const pattern = new RegExp(`${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const generatedBlock = (document) => document.match(pattern)?.[0] ?? '';
const outsideBlock = (document) => document.replace(pattern, `${BEGIN}\n${END}`);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('生成結果が現ファイルと一致する', () => {
  const result = spawnSync(process.execPath, [script, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('2 回生成して同一になる', () => {
  for (const locale of ['ja', 'en']) {
    const once = renderDocument(documents[locale], catalog.models, locale);
    const twice = renderDocument(once, catalog.models, locale);
    assert.equal(sha256(twice), sha256(once));
  }
});

test('14 行すべての id が日英両方の生成ブロックに出る', () => {
  assert.equal(catalog.models.length, 14);
  for (const locale of ['ja', 'en']) {
    const block = generatedBlock(documents[locale]);
    for (const model of catalog.models) assert.ok(block.includes(model.id), `${locale}: ${model.id}`);
  }
});

test('price が null の行に em dash が出る', () => {
  const nullPriceIds = catalog.models.filter((model) => model.price === null).map((model) => model.id);
  assert.deepEqual(nullPriceIds, [
    'fal:kling-v3-standard-i2v',
    'fal:seedance-2.5-i2v',
    'fal:grok-imagine-i2v',
    'fal:vidu-q3-i2v',
    'codex:image',
    'fal:nano-banana-pro-edit'
  ]);
  for (const locale of ['ja', 'en']) {
    const lines = generatedBlock(documents[locale]).split('\n');
    for (const id of nullPriceIds) {
      const row = lines.find((line) => line.includes(`| ${id} |`));
      assert.ok(row, `${locale}: ${id}`);
      assert.ok(row.includes('| — |'), `${locale}: ${id}`);
    }
  }
});

test('生成の前後でマーカー外の手書き部分が変わらない', () => {
  for (const locale of ['ja', 'en']) {
    const rendered = renderDocument(documents[locale], catalog.models, locale);
    assert.equal(outsideBlock(rendered), outsideBlock(documents[locale]));
  }
});
