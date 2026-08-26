import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const read = path => readFile(path, 'utf8');

test('shell と Web UI は edit-store の同一 transition recipe module だけを使う', async () => {
  const [kernel, shellFacade, shellConsumer, webConsumer, webApplicator, bundle] = await Promise.all([
    read(join(repositoryRoot, 'packages/edit-store/src/transition-visual.ts')),
    read(join(repositoryRoot, 'apps/shell/extensions/akari-preview/src/common/transition-visual.ts')),
    read(join(repositoryRoot, 'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts')),
    read(join(packageRoot, 'public/app.js')),
    read(join(packageRoot, 'public/transition-visual.js')),
    read(join(packageRoot, 'public/edit-kernel.bundle.js')),
  ]);

  assert.match(kernel, /export function computeTransitionVisual\(/u);
  assert.equal((kernel.match(/function computeTransitionVisual\(/gu) ?? []).length, 1);
  assert.match(shellFacade, /export \{ computeTransitionVisual \} from '@akari-video\/edit-store';/u);
  assert.doesNotMatch(shellFacade, /function computeTransitionVisual\(/u);
  assert.match(shellConsumer, /computeTransitionVisual\.toString\(\)/u);
  assert.match(webConsumer, /computeTransitionVisual[\s\S]*from '\/edit-kernel\.bundle\.js';/u);
  assert.match(webConsumer, /createTransitionVisualApplicator/u);
  assert.match(bundle, /\.\.\/edit-store\/src\/transition-visual\.ts/u);
  assert.doesNotMatch(webApplicator, /transitionVisualState|previewKind ===|fade-black|wipe-left|slide-left/u);
  assert.equal((`${shellFacade}\n${webConsumer}\n${webApplicator}`.match(/function computeTransitionVisual\(/gu) ?? []).length, 0);
});
