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
import { readInternalEdit } from '../lib/internal-model.js';
import { normalizeGeometry } from '../lib/migrate/index.js';
import { writeFallbackTemplate } from '../../project-scaffold/src/index.mjs';
import { readRenderEdit } from '../../render-cut/src/internal-render.mjs';

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

test('4 か所の空 v2 雛形は共有生成 API の指定値と同値で、各回が独立する', async () => {
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
    for (const edit of [scaffold, timeline]) {
      assert.deepEqual(JSON.parse(JSON.stringify(edit)), createEmptyEditV2());
      assert.doesNotThrow(() => readEditV2(edit));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(timelineFile)),
      createEmptyEditV2({ geometry: 'omit' }));
    assert.doesNotThrow(() => readEditV2(timelineFile));
    // 案内用サンプルは 1280×720 を使い、残りの形は共有雛形に揃える。
    assert.deepEqual(JSON.parse(JSON.stringify(onboarding)),
      createEmptyEditV2({ width: 1280, height: 720, geometry: 'omit' }));
    timeline.output.width = 1;
    assert.deepEqual(JSON.parse(JSON.stringify(loadCommonModule(
      '../../../apps/shell/extensions/akari-annotations/src/common/timeline-empty-state.ts'
    ).createTimelineEdit())), createEmptyEditV2());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('geometry 未指定と source は正規化・プレビューで異なるため、新規編集では未指定を保つ', () => {
  const withMedia = edit => ({
    ...edit,
    sources: [{ id: 'main', path: 'main.mp4' }],
    tracks: [{ id: 'visual', lane: 'visual', items: [{
      id: 'cut', at: 0, duration: 30,
      source: { kind: 'media', src: 'main', in: 0, out: 1 },
    }] }],
  });
  const unmarked = withMedia(createEmptyEditV2({ width: 1280, height: 720, geometry: 'omit' }));
  const marked = withMedia(createEmptyEditV2({ width: 1280, height: 720 }));
  assert.equal(readEditV2(unmarked).output.geometry, undefined);
  assert.equal(readEditV2(marked).output.geometry, 'source');
  assert.deepEqual(readInternalEdit(unmarked), readInternalEdit(marked),
    '共通の内部モデルには marker が残らない');

  const dimensionsOf = () => ({ width: 1920, height: 1080 });
  const normalizedUnmarked = normalizeGeometry(unmarked, dimensionsOf);
  const normalizedMarked = normalizeGeometry(marked, dimensionsOf);
  assert.equal('blockers' in normalizedUnmarked, false);
  assert.equal('blockers' in normalizedMarked, false);
  assert.deepEqual(normalizedUnmarked.changes, [
    { itemId: 'cut', sourceId: 'main', fit: 2 / 3, before: 1, after: 0.666667 },
  ]);
  assert.equal(normalizedUnmarked.edit.tracks[0].items[0].transform.scale, 0.666667);
  assert.deepEqual(normalizedMarked.changes, []);
  assert.equal(normalizedMarked.edit.tracks[0].items[0].transform, undefined);

  const { cutLayerStyleEntryTransform } = loadCommonModule(
    '../../../apps/shell/extensions/akari-preview/src/common/cut-layer-style-entry.ts'
  );
  const identity = { x: 0, y: 0, scale: 1, rotate: 0 };
  assert.equal(cutLayerStyleEntryTransform(identity, 1920, 1080, 1280, 720,
    unmarked.output.geometry).scale, 2 / 3);
  assert.equal(cutLayerStyleEntryTransform(identity, 1920, 1080, 1280, 720,
    marked.output.geometry).scale, 1);

  const renderUnmarked = readRenderEdit(unmarked, '/unused/render-tmp');
  const renderMarked = readRenderEdit(marked, '/unused/render-tmp');
  assert.deepEqual(renderUnmarked.internal, renderMarked.internal);
  assert.deepEqual(renderUnmarked.edit.cuts, renderMarked.edit.cuts);
  assert.equal(renderUnmarked.edit.output.geometry, undefined);
  assert.equal(renderMarked.edit.output.geometry, 'source');
});
