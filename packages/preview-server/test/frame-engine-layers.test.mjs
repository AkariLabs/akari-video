import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');
const browserTestSource = await readFile(
  path.resolve(import.meta.dirname, 'frame-engine-preview-browser.l1.mjs'),
  'utf8',
);

test('frame engine evaluation table supplies edit layers and keeps unsupported scope accurate', () => {
  assert.match(source, /layers:\s*\(Array\.isArray\(edit\?\.layers\)/u);
  assert.match(source, /cuts \+ layers \+ matte/u);
  assert.match(source, /if \(layer\.mask\)/u);
  assert.doesNotMatch(source, /未対応: layers/u);
  assert.match(source, /plan\.base\.length === 0 && plan\.layers\.length === 0/u);
  assert.match(source, /CachedStillImageSource/u);
  assert.match(source, /get\('uploadPath'\) === 'copyTo'/u);
  assert.match(source, /uploadPath: requestedUploadPath/u);
  assert.match(source, /dataset\.uploadPath = this\.compositor\.uploadPath/u);
});

test('frame engine browser L1 covers default direct and forced copyTo upload paths', () => {
  assert.match(browserTestSource, /goto\(`\$\{base\}\/\?frameEngine=1`/u);
  assert.match(browserTestSource, /data-upload-path'[\s\S]+direct/u);
  assert.match(browserTestSource, /frameEngine=1&uploadPath=copyTo/u);
  assert.match(browserTestSource, /data-upload-path'[\s\S]+copyTo/u);
});
