import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const source = await readFile(path.resolve(import.meta.dirname, '../src/frame-engine-client.ts'), 'utf8');
const browserTestSource = await readFile(
  path.resolve(import.meta.dirname, 'frame-engine-preview-browser.l1.mjs'),
  'utf8',
);

test('frame engine evaluation table supplies edit layers without an unsupported banner', () => {
  assert.match(source, /layers:\s*\(Array\.isArray\(edit\?\.layers\)/u);
  assert.match(source, /if \(layer\.mask\)/u);
  assert.doesNotMatch(source, /frame-engine-unsupported-banner|未対応: layers/u);
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
  assert.match(browserTestSource, /for \(let run = 1; run <= 2; run \+= 1\)/u);
  assert.match(browserTestSource, /Math\.abs\(run\.driftMs\) <= 33/u);
});

test('frame engine browser L1 uses stable navigation, fps median, and a resolved LUT fixture', () => {
  assert.match(browserTestSource, /context\.setDefaultNavigationTimeout\(60_000\)/u);
  assert.match(browserTestSource, /for \(let sample = 0; sample < 10; sample \+= 1\)/u);
  assert.match(browserTestSource, /waitForTimeout\(250\)/u);
  assert.match(browserTestSource, /fpsMedian: median\(fpsSamples\)/u);
  assert.match(browserTestSource, /run\.fpsMedian >= 30/u);
  assert.match(browserTestSource, /look: \{ lut: '\.\/look\.cube'/u);
  assert.match(browserTestSource, /suppliedSummary\.videoFx\?\.look\?\.cubeText/u);
  assert.match(browserTestSource, /suppliedSummary\.indicators\?\.includes\('LUT'\), false/u);
});
