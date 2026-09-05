import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(path.resolve(
  import.meta.dirname,
  '../src/browser/akari-preview-open-handler.ts',
), 'utf8');

test('shell summary and LUT resolution preserve every v1 adjust section', () => {
  const declaration = source.match(/interface EditSummaryAdjust \{([\s\S]*?)\n\}/u)?.[1];
  assert.ok(declaration);
  for (const [key, type] of [['curves', 'AdjustCurvesV1'], ['wheels', 'AdjustWheelsV1'], ['hue', 'AdjustHueCurvesV1']]) {
    assert.ok(declaration.includes(key + '?: ' + type));
    assert.ok(declaration.includes(key + '?: boolean'));
  }
  assert.equal((source.match(/adjust: value\.adjust as EditSummaryAdjust/gu) ?? []).length, 2);
  assert.match(source, /adjust: item\.declaration\.adjust as EditSummaryAdjust/u);
  const start = source.indexOf('const resolveSummaryItemAdjust =');
  const end = source.indexOf('const normalizeSummaryCuts =', start);
  assert.ok(start >= 0 && end > start);
  const resolve = vm.runInNewContext(source.slice(start, end) + '; resolveSummaryItemAdjust', {
    engine: { parseCube: text => ({ text }) },
  });
  const adjust = {
    curves: { r: [{ in: 0, out: 0.1 }, { in: 1, out: 1 }] },
    wheels: { lift: { r: 0.1 } }, hue: { sat: [{ hue: 0, value: 0 }] },
    sections: { curves: true, wheels: false, hue: true },
  };
  for (const lut of [undefined, { lut: 'mono', intensity: 0.5 }]) {
    const resolved = resolve({ id: 'item', adjust: { ...adjust, lut } }, { adjustLutCubeTexts: { item: 'cube' } });
    for (const key of Object.keys(adjust)) assert.deepEqual(resolved.adjust[key], adjust[key]);
    if (lut) assert.equal(resolved.adjust.lut.lut.text, 'cube');
  }
});

test('shell frame-engine summary resolves and carries per-item adjust LUTs', () => {
  assert.match(source, /const adjustLutCubeTexts: Record<string, string> = \{\}/u);
  assert.match(source, /adjustLutCubeTexts\[item\.id\] = await this\.previewService\.readVideoFxLut/u);
  assert.match(source, /await resolveItemAdjustLut\(item\)/u);
  assert.match(source, /\{ adjust: value\.adjust as EditSummaryAdjust \}/u);
  assert.match(source, /Object\.keys\(adjustLutCubeTexts\)\.length > 0 \? \{ adjustLutCubeTexts \}/u);
});

test('shell frame-engine parses item cube text before planning cuts and layers', () => {
  assert.match(source, /const resolveSummaryItemAdjust = \(item, summary\) =>/u);
  assert.match(source, /lut: engine\.parseCube\(cubeText\)/u);
  assert.match(source, /return resolveSummaryItemAdjust\(\{[\s\S]+?\}, value\);/u);
  assert.match(source, /const layer = resolveSummaryItemAdjust\(rawLayer, value\)/u);
  assert.match(source, /engine\.buildResolvedTimelinePlan\(nextCuts, \{\s+fps,\s+layers: nextLayers/u);
});
