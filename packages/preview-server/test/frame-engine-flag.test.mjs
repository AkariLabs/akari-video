import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('frame engine is a query-gated dynamic bundle with no unconditional index DOM', async () => {
  const [app, html, packageJson, bundle] = await Promise.all([
    readFile(path.join(root, 'public/app.js'), 'utf8'),
    readFile(path.join(root, 'public/index.html'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'public/frame-engine.bundle.js'), 'utf8'),
  ]);
  assert.match(app, /get\('frameEngine'\) === '1'/u);
  assert.match(app, /await import\('\/frame-engine\.bundle\.js'\)/u);
  assert.doesNotMatch(html, /frame-engine-(?:preview|canvas|metrics|unsupported)/u);
  assert.match(packageJson, /frame-engine-client\.ts[^\n]+frame-engine\.bundle\.js/u);
  assert.match(bundle, /ScrubController = class/u);
  assert.match(bundle, /WarmupManager = class/u);
  assert.match(bundle, /LookaheadFrameSource = class/u);
  assert.match(bundle, /async function evaluateFrame/u);
});
