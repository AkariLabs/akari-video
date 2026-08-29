import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

async function readFlagExpression() {
  const app = await readFile(path.join(root, 'public/app.js'), 'utf8');
  const match = app.match(/const frameEngineEnabled = ([^;]+);/u);
  assert.ok(match, 'frameEngineEnabled expression is missing');
  return Function('location', `return (${match[1]});`);
}

test('frame engine defaults on when frameEngine is omitted', async () => {
  const enabled = await readFlagExpression();
  assert.equal(enabled({ search: '' }), true);
});

test('frameEngine=0 explicitly selects the legacy video preview', async () => {
  const enabled = await readFlagExpression();
  assert.equal(enabled({ search: '?frameEngine=0' }), false);
});

test('frameEngine=1 explicitly selects the frame engine', async () => {
  const enabled = await readFlagExpression();
  assert.equal(enabled({ search: '?frameEngine=1' }), true);
});

test('frame engine remains a dynamic bundle with no unconditional index DOM', async () => {
  const [app, html, packageJson, bundle, source] = await Promise.all([
    readFile(path.join(root, 'public/app.js'), 'utf8'),
    readFile(path.join(root, 'public/index.html'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'public/frame-engine.bundle.js'), 'utf8'),
    readFile(path.join(root, 'src/frame-engine-client.ts'), 'utf8'),
  ]);
  assert.match(app, /get\('frameEngine'\) !== '0'/u);
  assert.match(app, /await import\('\/frame-engine\.bundle\.js'\)/u);
  assert.doesNotMatch(html, /frame-engine-(?:preview|canvas|metrics|unsupported)/u);
  assert.doesNotMatch(source, /frame-engine-unsupported-banner/u);
  assert.match(source, /frameEngineMetrics/u);
  assert.match(source, /stage\.prepend\(root\)/u);
  assert.match(packageJson, /frame-engine-client\.ts[^\n]+frame-engine\.bundle\.js/u);
  assert.match(bundle, /ScrubController = class/u);
  assert.match(bundle, /function createPreviewScheduler/u);
  assert.match(bundle, /LookaheadFrameSource = class/u);
  assert.match(bundle, /async function evaluateFrame/u);
  assert.match(bundle, /uniform sampler3D lut/u);
  assert.match(source, /edit\?\.videoFx\?\.look/u);
  assert.match(source, /lut: parseCube\(projectedLook\.cubeText\)/u);
  assert.match(source, /Math\.max\(0, Math\.min\(1/u);
});
