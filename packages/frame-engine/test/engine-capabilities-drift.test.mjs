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

test('runtime-warning ignored rows are either the explicit perspective warning or generic unknown-key warnings', () => {
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
      const known = isKeyframe ? KNOWN_KEYFRAME_KEYS
        : appliesTo === 'cuts' ? KNOWN_CUT_KEYS : KNOWN_LAYER_KEYS;
      assert.equal(known.has(key), false, `${row.path} (${appliesTo}) must reach warnUnknownFields`);
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
