import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { scopeFragmentCss } from '../src/fragment-css-scope.mjs';
import { renderOverlaySheet } from '../../render-cut/src/rasterize.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
const fixture = (name) => readFileSync(
  join(repoRoot, 'packages/edit-lint/test/fixtures/fragment-css-collision/overlays', name),
  'utf8',
);

test('preview and both export surfaces import the same single implementation', () => {
  const relativeImport = '"../../overlay-runtime/src/fragment-css-scope.mjs"';
  assert.match(read('packages/render-cut/src/rasterize.mjs'),
    new RegExp(`import \\{ scopeFragmentCss \\} from ${relativeImport.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  assert.match(read('packages/gpu-export/src/page-builder.mjs'),
    new RegExp(`import \\{ scopeFragmentCss \\} from ${relativeImport.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u'));
  const preview = read('packages/preview-server/public/app.js');
  assert.match(preview, /import \{ scopeFragmentCss \} from '\/fragment-css-scope\.mjs';/u);
  assert.match(preview, /scopeFragmentCss\(/u);
  const server = read('packages/preview-server/src/server.mjs');
  assert.match(server, /'\/fragment-css-scope\.mjs': fileURLToPath\(new URL\('\.\.\/\.\.\/overlay-runtime\/src\/fragment-css-scope\.mjs'/u);
  // シェル（アプリ）のプレビューは runtimeJavaScript に同じファイルを同梱し、
  // overlay-runtime.js の mount が browser global 経由で同じ純関数を呼ぶ。
  const shell = read('apps/shell/extensions/akari-preview/src/node/akari-preview-service.ts');
  assert.match(shell, /readText\('fragment-css-scope\.mjs'\)\.replace\(\/\^export \/gmu, ''\)/u);
  const runtime = read('packages/overlay-runtime/src/overlay-runtime.js');
  assert.match(runtime, /window\.akari\.fragmentCssScope\?\.scopeFragmentCss/u);
  assert.match(runtime, /scopeOverlayCss\(overlays, options\)/u);
});

test('render-cut overlay sheet scopes the later fragment only', () => {
  const overlays = [
    { id: 'a', start: 0, duration: 1, z: 0, html: fixture('a.html') },
    { id: 'b', start: 0, duration: 1, z: 0, html: fixture('b.html') },
  ];
  const edit = { output: { width: 1280, height: 720, fps: 30 } };
  const sheet = renderOverlaySheet({ overlays, edit, projectRoot: repoRoot, duration: 1 });
  assert.match(sheet, /\.lbl-hashimoto \{ left: 10%/u);
  assert.match(sheet, /\.lbl-hashimoto__f2 \{ left: 60%/u);
  assert.match(sheet, /@keyframes drift__f2/u);
  assert.doesNotMatch(sheet, /\.lbl-hashimoto \{ left: 60%/u);
});

test('gpu-export pre-scoped overlays can skip the sheet scope (no double suffix)', () => {
  const overlays = [
    { id: 'a', start: 0, duration: 1, z: 0, html: fixture('a.html') },
    { id: 'b', start: 0, duration: 1, z: 0, html: fixture('b.html') },
  ];
  const edit = { output: { width: 1280, height: 720, fps: 30 } };
  const scoped = scopeFragmentCss(overlays.map((overlay) => ({ id: overlay.id, html: overlay.html })))
    .map((entry, index) => ({ ...overlays[index], html: entry.html }));
  const sheet = renderOverlaySheet({
    overlays: scoped, edit, projectRoot: repoRoot, duration: 1, scopeCss: false,
  });
  assert.match(sheet, /\.lbl-hashimoto__f2 \{ left: 60%/u);
  assert.doesNotMatch(sheet, /__f2__f2/u);
});

test('a collision-free sheet is byte-identical whether scoping is on or off', () => {
  const overlays = [{ id: 'plain', start: 0, duration: 1, z: 0, html: fixture('plain.html') }];
  const edit = { output: { width: 1280, height: 720, fps: 30 } };
  assert.equal(
    renderOverlaySheet({ overlays, edit, projectRoot: repoRoot, duration: 1 }),
    renderOverlaySheet({ overlays, edit, projectRoot: repoRoot, duration: 1, scopeCss: false }),
  );
});
