import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const publicDir = new URL('../public/', import.meta.url);
const [html, app] = await Promise.all([
  readFile(new URL('index.html', publicDir), 'utf8'),
  readFile(new URL('app.js', publicDir), 'utf8'),
]);

test('zoom viewport keeps pane, wrapper, zoom layer, and output stage as separate roles', () => {
  assert.match(html, /\.preview-pane \{[^}]*position: relative;[^}]*overflow: hidden;[^}]*background: #090909;/s);
  assert.match(html, /#preview-wrapper \{[^}]*position: relative;[^}]*width: 100%;[^}]*height: 100%;[^}]*\}/s);
  assert.match(html, /#zoom-layer \{[^}]*position: absolute;[^}]*inset: 0;[^}]*transform-origin: 50% 50%;/s);
  assert.match(html, /#preview-stage \{[^}]*left: 50%;[^}]*top: 50%;[^}]*overflow: hidden;[^}]*background: #000;[^}]*translate\(-50%, -50%\)/s);
  assert.match(html, /<div id="zoom-layer">\s*<div id="preview-stage">[\s\S]*?<div id="overlay-stage">/);
});

test('minimap is a direct pane child and uses measured pane/stage geometry', () => {
  assert.match(html, /<div id="preview-message"[\s\S]*?<\/div>\s*<\/div>\s*<div id="zoom-minimap" hidden>[\s\S]*?<\/section>/);
  assert.match(html, /#zoom-minimap \{[^}]*bottom: 8px;[^}]*right: 8px;/s);
  assert.match(app, /const paneRect = previewPane\.getBoundingClientRect\(\);/);
  assert.match(app, /const stageRect = previewStage\.getBoundingClientRect\(\);/);
  assert.doesNotMatch(app, /const vpW = vw \/ zoom|const vpH = vh \/ zoom/);
});

test('pan is pixel-based, pane-clamped, and re-clamped by the pane observer', () => {
  assert.match(app, /previewStage\.clientWidth \* zoom - previewPane\.clientWidth/);
  assert.match(app, /previewStage\.clientHeight \* zoom - previewPane\.clientHeight/);
  assert.match(app, /translate\(\$\{pan\.x\}px, \$\{pan\.y\}px\) scale\(\$\{zoom\}\)/);
  assert.match(app, /new ResizeObserver\(\(\) => \{[\s\S]*?pan = clampPan\(pan\);[\s\S]*?\}\)\.observe\(previewPane\);/);
});

test('stage scale and saved zoom restoration keep their public contracts', () => {
  assert.match(app, /window\.akari\.stageScale = \(\) => frameScale;/);
  assert.match(app, /if \(savedSettings\.zoom && savedSettings\.zoom >= ZOOM_MIN && savedSettings\.zoom <= ZOOM_MAX\) \{\s*zoom = savedSettings\.zoom; updateZoom\(\);/);
  assert.match(app, /function layerEffectiveScale\(\) \{[\s\S]*?layerContainer\.getBoundingClientRect\(\)/);
  assert.match(app, /window\.addEventListener\('pointerdown',[\s\S]*?closest\('button, \[role="button"\], input, textarea, select, a\[href\]'\)[\s\S]*?if \(!e\.altKey && isDirectManipulationTarget\(e\)\) return;[\s\S]*?e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
  assert.match(app, /if \(!e\.altKey && isDirectManipulationTarget\(e\)\) return;/);
  assert.match(app, /window\.addEventListener\('pointermove',[\s\S]*?e\.stopPropagation\(\);/);
  assert.match(app, /function finishPan\(e\) \{[\s\S]*?e\.stopPropagation\(\);/);
});
