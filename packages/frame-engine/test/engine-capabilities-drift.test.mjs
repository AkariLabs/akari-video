import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  KNOWN_CUT_KEYS,
  KNOWN_KEYFRAME_KEYS,
  KNOWN_LAYER_KEYS,
} from '../dist/index.js';

const table = JSON.parse(readFileSync(
  new URL('../../schemas/engine-capabilities.json', import.meta.url),
  'utf8',
));
const planSource = readFileSync(new URL('../src/timeline/plan.ts', import.meta.url), 'utf8');
const layerVisualSource = readFileSync(new URL('../src/timeline/layer-visual.ts', import.meta.url), 'utf8');
const frameEngineTimelineSource = `${planSource}\n${layerVisualSource}`;

function trailingKey(path) {
  return path.slice(path.lastIndexOf('.') + 1);
}

function identifierPattern(identifier) {
  return new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u');
}

test('every consumed cuts/layers capability names an identifier in frame-engine timeline sources', () => {
  const audited = [];
  for (const row of table.fields) {
    if (!row.applies_to.some((value) => value === 'cuts' || value === 'layers')) continue;
    for (const engine of table.engines) {
      if (row[engine] !== 'consumed') continue;
      const key = trailingKey(row.path);
      assert.match(frameEngineTimelineSource, identifierPattern(key), `${engine} ${row.path}`);
      audited.push(`${engine}:${row.path}`);
    }
  }
  assert.ok(audited.length > 0);
});

test('runtime-warning ignored rows have explicit perspective/animator or generic unknown-key warnings', () => {
  assert.match(planSource, /field "\$\{key\}" is not consumed by the frame-engine/u);
  for (const row of table.fields.filter((field) => field.runtime_warning === true
    && field.gpu === 'ignored' && field.osr === 'ignored')) {
    const key = trailingKey(row.path);
    const isKeyframe = row.path.includes('.keyframes[].');
    for (const appliesTo of row.applies_to.filter((value) => value === 'cuts' || value === 'layers')) {
      if (key === 'perspective' && appliesTo === 'cuts') {
        assert.match(planSource, /perspective is not applied by the frame-engine base path/u);
        continue;
      }
      if (key === 'animator') {
        assert.match(planSource, /animator is ignored on non-text items/u);
        assert.ok(KNOWN_KEYFRAME_KEYS.has(key));
        assert.ok((appliesTo === 'cuts' ? KNOWN_CUT_KEYS : KNOWN_LAYER_KEYS).has(key));
        continue;
      }
      const known = isKeyframe ? KNOWN_KEYFRAME_KEYS
        : appliesTo === 'cuts' ? KNOWN_CUT_KEYS : KNOWN_LAYER_KEYS;
      assert.equal(known.has(key), false, `${row.path} (${appliesTo}) must reach warnUnknownFields`);
    }
  }
});

// 「consumed と書いた行」だけを検査していたので、実装が消費しているのに "ignored" と書かれた
// 行は空振りで通り続けていた（不具合メモ 第17項: layers の source.in が plan.ts で消費されて
// いるのに ignored のまま。表を見た書き出し前検査が「効かない」と誤って案内していた）。
// エンジンの許可キーに載っている = そのキーを認識しているということなので、"ignored" を名乗る
// なら warnUnknownFields に届く未知キーか、意図的無視として runtime_warning を立てた行のどちらか
// でなければならない。
test('ignored cuts/layers rows are either unknown to the engine or declared as a deliberate ignore', () => {
  for (const row of table.fields) {
    const kinds = row.applies_to.filter((value) => value === 'cuts' || value === 'layers');
    if (kinds.length === 0) continue;
    if (row.runtime_warning === true) continue;
    const key = trailingKey(row.path);
    const isKeyframe = row.path.includes('.keyframes[].');
    for (const engine of table.engines) {
      if (row[engine] !== 'ignored') continue;
      for (const appliesTo of kinds) {
        const known = isKeyframe ? KNOWN_KEYFRAME_KEYS
          : appliesTo === 'cuts' ? KNOWN_CUT_KEYS : KNOWN_LAYER_KEYS;
        assert.equal(
          known.has(key),
          false,
          `${engine} ${row.path} (${appliesTo}): エンジンが知っているキーを ignored と書いている。`
          + ' 消費しているなら consumed / partial へ、意図的に無視するなら runtime_warning: true へ',
        );
      }
    }
  }
});

test('consumed cuts/layers rows never claim runtime_warning', () => {
  for (const row of table.fields) {
    if (!row.applies_to.some((value) => value === 'cuts' || value === 'layers')) continue;
    if (row.gpu !== 'consumed' && row.osr !== 'consumed') continue;
    assert.notEqual(row.runtime_warning, true, row.path);
  }
});
