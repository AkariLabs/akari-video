import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const app = await readFile(path.resolve(import.meta.dirname, '../public/app.js'), 'utf8');
const transition = await readFile(path.resolve(import.meta.dirname, '../public/transition-visual.js'), 'utf8');
const projection = await readFile(path.resolve(import.meta.dirname, '../src/preview-edit.mjs'), 'utf8');

test('Web UI receives resolved per-item LUTs through /api/summary and prefers the clip look', () => {
  assert.match(projection, /adjustLutCubeTexts\[id\] = resolveVideoFxLut\(projectRoot, ref\)/u);
  assert.match(projection, /Object\.keys\(adjustLutCubeTexts\)\.length > 0 \? \{ adjustLutCubeTexts \}/u);
  assert.match(app, /summary\?\.adjustLutCubeTexts\?\.\[String\(cut\.id\)\]/u);
  assert.match(app, /adjust\.sections\?\.lut === false/u);
  assert.match(app, /const look = clipLook \|\| config\?\.look/u);
  assert.match(app, /sourceEffectsForCut\(segment\.index, false\)/u);
});

test('sourceEffectsForCut returns the resolved clip LUT ahead of global look', () => {
  const start = app.indexOf('function clipLookForCut(cutIndex) {');
  const end = app.indexOf('\nfunction layerChromaEffects(layer) {', start);
  assert.ok(start >= 0 && end > start);
  const makeResolver = vm.runInNewContext(`(summary => { ${app.slice(start, end)}; return sourceEffectsForCut; })`);
  const globalLook = { cubeText: 'global cube', intensity: 0.4 };
  const summary = {
    cuts: [
      { id: 'clip-a', src: 'main', adjust: { lut: { lut: './a.cube', intensity: 0.75 } } },
      { id: 'clip-b', src: 'main', adjust: { lut: { lut: './b.cube' }, sections: { lut: false } } },
    ],
    adjustLutCubeTexts: { 'clip-a': 'clip cube', 'clip-b': 'disabled cube' },
    videoFx: { look: globalLook, sources: { main: { color: '#0f0' } } },
  };
  const resolve = makeResolver(summary);
  assert.deepEqual(
    { ...resolve(0), look: { ...resolve(0).look }, chromaKey: { ...resolve(0).chromaKey } },
    { look: { cubeText: 'clip cube', intensity: 0.75 }, chromaKey: { color: '#0f0' } },
  );
  assert.deepEqual({ ...resolve(1).look }, globalLook);
  assert.deepEqual({ ...resolve(0, false).look }, globalLook);
});

test('Web UI applies basic adjust only on the DOM rail and composes transition filters', () => {
  assert.match(app, /import \{ computeAdjustCssVisual \} from '\/edit-kernel\.bundle\.js'/u);
  assert.match(app, /if \(!frameEngineEnabled\)[\s\S]+computeAdjustCssVisual\(layer\.adjust\)/u);
  assert.match(app, /el\.style\.backdropFilter[\s\S]+setAdjustBaseFilter\(el, layer\.adjust\)/u);
  assert.match(app, /function setAdjustBaseFilter\(element, adjust\) \{\s+if \(frameEngineEnabled/u);
  assert.match(app, /for \(const el of \[video, img\]\)[\s\S]+clearAdjustBaseFilter\(el\);\s+setAdjustBaseFilter\(el, cut\?\.adjust\)/u);
  assert.match(app, /computeAdjustCssVisual\(outgoingCut\?\.adjust, outgoingTransitionFilter\)/u);
  assert.match(app, /computeAdjustCssVisual\(incomingCut\?\.adjust, incomingTransitionFilter\)/u);
  assert.match(app, /const outgoingFilter = !frameEngineEnabled/u);
  assert.equal((app.match(/if \(!frameEngineEnabled\) setupVideoFx\(\);/gu) ?? []).length, 2);
  assert.match(transition, /element\.style\.filter = element\.dataset\.akariAdjustFilter \|\| ''/u);
});

test('Web UI honest-preview indicators disclose approximation and one-LUT replacement only off-engine', () => {
  assert.match(app, /const adjustApproximation = !frameEngineEnabled[\s\S]+色調整は近似表示/u);
  assert.match(app, /const clipLutReplacement = !frameEngineEnabled[\s\S]+clip LUT はグローバル LUT を置換/u);
});
