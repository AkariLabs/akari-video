import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { readInternalEdit } from '../lib/index.js';

const readerSource = readFileSync(new URL('../src/edit-v2.ts', import.meta.url), 'utf8');
const keysMatch = readerSource.match(/const ITEM_KEYS = new Set\(\[([\s\S]*?)\]\);/u);
assert.ok(keysMatch, 'edit-v2.ts の ITEM_KEYS 宣言を抽出できません');
const keyLiterals = [...keysMatch[1].matchAll(/'([^']+)'/gu)].map((match) => match[1]);
assert.ok(keyLiterals.length > 0, 'ITEM_KEYS が空です');
assert.equal(keysMatch[1].replace(/'[^']+'\s*,?\s*/gu, '').trim(), '', 'ITEM_KEYS に文字列以外があります');
assert.equal(new Set(keyLiterals).size, keyLiterals.length, 'ITEM_KEYS に重複があります');
const mediaItemKeys = new Set(keyLiterals);

const schema = JSON.parse(readFileSync(new URL('../../schemas/edit.schema.json', import.meta.url), 'utf8'));
const media = schema.$defs.itemV2Media;
const literalPatterns = Object.keys(media.patternProperties).map((pattern) => {
  const match = /^\^([A-Za-z_$][\w$]*)\$$/.exec(pattern);
  assert.ok(match, `literal pattern を解釈できません: ${pattern}`);
  return match[1];
});
// readInternalEdit は検証前に anchor を解決・除去し、有効な media captions を抜き出す。
const beforeValidation = new Set(['anchor', 'captions']);

test('schema の media item 語彙と edit-store の語彙が両方向で一致する', () => {
  const schemaKeys = new Set([...Object.keys(media.properties), ...literalPatterns]);
  const readerKeys = new Set([...mediaItemKeys, ...beforeValidation]);
  assert.deepEqual([...schemaKeys].filter((key) => !readerKeys.has(key)), [], 'schema のみのキー');
  assert.deepEqual([...readerKeys].filter((key) => !schemaKeys.has(key)), [], 'edit-store のみのキー');
});

test('抽出した ITEM_KEYS は readInternalEdit で未定義キーにならない', () => {
  const baseItem = {
    id: 'cut', at: 0, duration: 100,
    source: { kind: 'media', src: 'main', in: 0, out: 10 },
  };
  for (const key of mediaItemKeys) {
    const edit = {
      version: 2,
      output: { width: 320, height: 180, fps: 10 },
      sources: [{ id: 'main', path: 'assets/source.mp4' }],
      tracks: [{ id: 'v-main', lane: 'visual', items: [{
        ...baseItem,
        ...(!Object.hasOwn(baseItem, key) ? { [key]: key === 'audio' ? false : null } : {}),
      }] }],
    };
    try {
      readInternalEdit(edit);
    } catch (error) {
      assert.doesNotMatch(String(error), /未定義キーを使用できません/u, key);
    }
  }
});

test('検証前例外の anchor と captions は readInternalEdit で受理される', () => {
  const edit = {
    version: 2,
    output: { width: 320, height: 180, fps: 10 },
    sources: [{ id: 'main', path: 'assets/source.mp4' }],
    tracks: [{ id: 'v-main', lane: 'visual', items: [{
      id: 'cut', at: 0, duration: 100,
      source: { kind: 'media', src: 'main', in: 0, out: 10 },
      anchor: { caption: 'c-0001' }, captions: 'off',
    }] }],
  };
  assert.doesNotThrow(() => readInternalEdit(edit));
});
