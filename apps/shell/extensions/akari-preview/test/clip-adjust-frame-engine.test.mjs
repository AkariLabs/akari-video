import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(
  import.meta.dirname,
  '../src/browser/akari-preview-open-handler.ts',
), 'utf8');

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
