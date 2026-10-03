import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  collectExcludedCaptionIds,
  filterCaptionRootByExcludedIds,
} from '../../../../../packages/edit-store/lib/index.js';
import {
  collectExcludedCaptionIds as collectWebUiExcludedCaptionIds,
  filterCaptionRootByExcludedIds as filterWebUiCaptionRootByExcludedIds,
} from '../../../../../packages/preview-server/public/caption-markup.js';

const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
const edit = { tracks: [{ items: [{
  source: { kind: 'group' },
  children: [{ source: { kind: 'captions', exclude: ['c-2'] }, items: [] }]
}] }] };
const arrayRoot = [{ id: 'c-1' }, { id: 'c-2' }];
const objectRoot = { captions: arrayRoot, default_text_style: { color: '#fff' } };

for (const [name, relativePath, marker] of [
  ['render-cut', 'packages/render-cut/src/caption-resolve.mjs', 'collectExcludedCaptionIds(edit)'],
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

test('WebUI（caption-markup.js）も array / object root と再帰 children を同じ規則で扱う', () => {
  const excluded = collectWebUiExcludedCaptionIds(edit);
  assert.deepEqual([...excluded], ['c-2']);
  assert.deepEqual(
    JSON.parse(JSON.stringify(filterWebUiCaptionRootByExcludedIds(arrayRoot, excluded))),
    [{ id: 'c-1' }]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(filterWebUiCaptionRootByExcludedIds(objectRoot, excluded))),
    { captions: [{ id: 'c-1' }], default_text_style: { color: '#fff' } }
  );
});
