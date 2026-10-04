import assert from 'node:assert/strict';
import { readAllSourceText } from './helpers/daihon-source.mjs';
import test from 'node:test';

const source = readAllSourceText();

test('台本の語 span は emphasis preset の属性・色変数・薄い下線を持つ', () => {
  assert.match(source, /span\.dataset\.emphasisPreset = preset/u);
  assert.match(source, /--daihon-word-preset-color/u);
  assert.match(source, /\.akari-daihon-word\[data-emphasis-preset\]/u);
  assert.match(source, /text-decoration:underline solid rgba\(83,209,188,\.55\) 1\.5px/u);
});

test('台本は source 秒の重なりと src 一致で語プリセットを選ぶ', () => {
  assert.match(source, /caption\.timeDomain === 'output'/u);
  assert.match(source, /emphasis\.src === caption\.src/u);
  assert.match(source, /Math\.min\(word\.end, emphasis\.t_end\) - Math\.max\(word\.start, emphasis\.t_start\) > 0\.000001/u);
});
