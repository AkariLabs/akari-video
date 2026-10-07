import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

import { createEmptyEditV2 } from '../lib/index.js';
import { readEditV2 } from '../lib/edit-v2.js';
import { writeFallbackTemplate } from '../../project-scaffold/src/index.mjs';

function loadCommonModule(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const context = vm.createContext({
    exports,
    require(specifier) {
      assert.equal(specifier, '@akari-video/edit-store');
      return { createEmptyEditV2 };
    },
  });
  vm.runInContext(compiled, context, { filename: relativePath });
  return exports;
}

test('4 か所の空 v2 雛形は共有生成 API と同値で、各回が独立する', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-empty-v2-'));
  try {
    await writeFallbackTemplate(root);
    const scaffold = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    const timeline = loadCommonModule('../../../apps/shell/extensions/akari-annotations/src/common/timeline-empty-state.ts')
      .createTimelineEdit();
    const timelineFile = loadCommonModule('../../../apps/shell/extensions/akari-annotations/src/common/timeline-files.ts')
      .createTimelineEditContent({ width: 1920, height: 1080 });
    const onboarding = loadCommonModule('../../../apps/shell/extensions/akari-surfaces/src/onboarding/model.ts')
      .createEmptyOnboardingEdit();
    for (const edit of [scaffold, timeline, timelineFile]) {
      assert.deepEqual(JSON.parse(JSON.stringify(edit)), createEmptyEditV2());
      assert.doesNotThrow(() => readEditV2(edit));
    }
    // 案内用サンプルは 1280×720 を使い、残りの形は共有雛形に揃える。
    assert.deepEqual(JSON.parse(JSON.stringify(onboarding)), createEmptyEditV2({ width: 1280, height: 720 }));
    timeline.output.width = 1;
    assert.deepEqual(JSON.parse(JSON.stringify(loadCommonModule(
      '../../../apps/shell/extensions/akari-annotations/src/common/timeline-empty-state.ts'
    ).createTimelineEdit())), createEmptyEditV2());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
