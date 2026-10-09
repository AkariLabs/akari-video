import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const engineSource = readFileSync(new URL('../../frame-engine/src/timeline/caption-motion-tiles.ts', import.meta.url), 'utf8');
const engineCode = ts.transpileModule(engineSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const engineModule = { exports: {} };
new Function('module', 'exports', engineCode)(engineModule, engineModule.exports);
const FE = engineModule.exports;

const runtimeSource = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('page-runtime.js', runtimeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node)) functions.set(node.name.text, node.getText(syntax));
  ts.forEachChild(node, visit);
}
visit(syntax);
const { captionMotionDrawDisposition, captionBandDraws } = new Function('FE',
  `${functions.get('captionMotionDrawDisposition')}\n${functions.get('captionBandDraws')}
  return { captionMotionDrawDisposition, captionBandDraws };`)(FE);

const plateRect = { x: 100, y: 40, width: 300, height: 80 };
const textureRect = { x: 0, y: 0, width: 350, height: 200 };
const character = { rects: [{ x: 110, y: 50, width: 20, height: 30 }], inDelay: .2, outDelay: 1.5 };
const unit = { mode: 'typewriter', id: 'plate', secondaryId: 'text', z: 3, index: 2,
  plateRect, textureRect, originX: 250, originY: 80 };
const tilesAt = (seconds, clip) => FE.captionMotionTiles({ plateRect, textureRect, clip,
  characters: [character], typewriterIn: true, typewriterOut: true, localSeconds: seconds });

test('typewriter keeps the numeric plate draw while zero characters are visible at entry and exit', () => {
  for (const seconds of [.05, 1.6]) {
    const motionTiles = tilesAt(seconds);
    assert.deepEqual(motionTiles, []);
    const disposition = captionMotionDrawDisposition(unit, {}, seconds, motionTiles);
    assert.equal(disposition, 'plate');
    const draws = captionBandDraws(unit, {}, motionTiles, disposition);
    assert.deepEqual(draws.map(draw => draw.id), ['plate']);
    assert.deepEqual(draws[0].textureRect, textureRect);
    assert.deepEqual([draws[0].originX, draws[0].originY], [250, 80]);
  }

  const visible = tilesAt(.25);
  assert.deepEqual(visible.map(tile => [tile.x, tile.y, tile.width, tile.height]), [[110, 50, 20, 30]]);
  const disposition = captionMotionDrawDisposition(unit, {}, .25, visible);
  assert.equal(disposition, 'all');
  const draws = captionBandDraws(unit, {}, visible, disposition);
  assert.deepEqual(draws.map(draw => draw.id), ['plate', 'text']);
  assert.deepEqual(draws[1].tiles.map(tile => [tile.x, tile.y, tile.width, tile.height]),
    [[110, 50, 20, 30]]);
});

test('a fully clipped typewriter plate and a fully clipped geometry caption emit no draw', () => {
  const clip = { x: 1, y: 0, width: .1, height: 1 };
  const motionTiles = tilesAt(.25, clip);
  assert.deepEqual(motionTiles, []);
  assert.equal(captionMotionDrawDisposition(unit, { clip }, .25, motionTiles), 'none');
  assert.deepEqual(captionBandDraws(unit, { clip }, motionTiles, 'none'), []);
  assert.equal(captionMotionDrawDisposition({ ...unit, mode: 'geometry' }, { clip }, .25, motionTiles), 'none');
});
