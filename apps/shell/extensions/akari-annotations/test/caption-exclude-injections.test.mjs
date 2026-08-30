import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  collectExcludedCaptionIds,
  filterCaptionRootByExcludedIds,
} from '../../../../../packages/edit-store/lib/index.js';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
const edit = { tracks: [{ items: [{
  source: { kind: 'group' },
  children: [{ source: { kind: 'captions', exclude: ['c-2'] }, items: [] }]
}] }] };
const arrayRoot = [{ id: 'c-1' }, { id: 'c-2' }];
const objectRoot = { captions: arrayRoot, default_text_style: { color: '#fff' } };

for (const [name, relativePath, marker] of [
  ['render-cut', 'packages/render-cut/src/render-cut.mjs', 'collectExcludedCaptionIds(edit)'],
  ['osr-export', 'packages/osr-export/src/page-builder.mjs', 'collectExcludedCaptionIds(edit)'],
  ['gpu-export', 'packages/gpu-export/src/page-builder.mjs', 'collectExcludedCaptionIds(prepared.edit)'],
  ['shell live preview', 'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts',
    'collectExcludedCaptionIds(internal)'],
]) {
  test(`${name} は共有純関数で字幕 root を濾過する`, async () => {
    const source = await readFile(`${repository}/${relativePath}`, 'utf8');
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const excluded = collectExcludedCaptionIds(edit);
    assert.deepEqual(filterCaptionRootByExcludedIds(arrayRoot, excluded), [{ id: 'c-1' }]);
    assert.deepEqual(filterCaptionRootByExcludedIds(objectRoot, excluded), {
      captions: [{ id: 'c-1' }], default_text_style: { color: '#fff' }
    });
  });
}

test('WebUI のローカル複製も array / object root と再帰 children を同じ規則で扱う', async () => {
  const source = await readFile(`${repository}/packages/preview-server/public/app.js`, 'utf8');
  const start = source.indexOf('function collectExcludedCaptionIds(edit)');
  const end = source.indexOf('function getActiveCaptions()', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}; this.api={collectExcludedCaptionIds,filterCaptionRootByExcludedIds};`, context);
  const excluded = context.api.collectExcludedCaptionIds(edit);
  assert.deepEqual([...excluded], ['c-2']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.api.filterCaptionRootByExcludedIds(arrayRoot, excluded))),
    [{ id: 'c-1' }]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.api.filterCaptionRootByExcludedIds(objectRoot, excluded))),
    { captions: [{ id: 'c-1' }], default_text_style: { color: '#fff' } }
  );
});
