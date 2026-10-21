import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildGpuPage } from '../src/page-builder.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = (name) => readFileSync(
  join(repoRoot, 'packages/edit-lint/test/fixtures/fragment-css-collision/overlays', name),
  'utf8',
);

const edit = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], overlays: [] };

function page(overlays) {
  return buildGpuPage({
    edit,
    captions: [],
    overlays,
    projectRoot: '/unused',
    duration: 2,
    frameEngineBundle: '',
    pageRuntime: '',
    slotParamsRuntime: '',
    itemKeyframesRuntime: '',
    itemMotionRuntime: '',
  });
}

test('GPU page scopes the later colliding fragment exactly once', () => {
  const built = page([
    { id: 'a', start: 0, duration: 2, html: fixture('a.html') },
    { id: 'b', start: 0, duration: 2, html: fixture('b.html') },
  ]);
  assert.match(built.html, /lbl-hashimoto__f2/u);
  assert.match(built.html, /@keyframes drift__f2/u);
  assert.match(built.html, /left: 10%/u);
  assert.doesNotMatch(built.html, /__f2__f2/u);
  // DOM ステージの断片も同じスコープ結果を運ぶ。
  assert.match(JSON.stringify(built.spriteManifest.dom), /lbl-hashimoto__f2/u);
});

test('GPU page leaves a collision-free fragment byte-identical', () => {
  const plain = fixture('plain.html');
  const built = page([{ id: 'plain', start: 0, duration: 2, html: plain }]);
  assert.match(built.html, /class=\\"plain-card\\"/u);
  assert.doesNotMatch(built.html, /__f1/u);
});
