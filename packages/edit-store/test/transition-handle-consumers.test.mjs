import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('UI・lint・カーネル・レンダー投影は同じ planTransitionHandleWindow を import する', () => {
  const consumers = [
    read('../src/timeline-map.ts'),
    read('../src/internal-model.ts'),
    read('../../edit-lint/src/edit-lint.mjs'),
    read('../../../apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts'),
  ];
  for (const source of consumers) {
    assert.match(source, /planTransitionHandleWindow/u);
  }
  assert.doesNotMatch(read('../../edit-lint/src/edit-lint.mjs'), /IMAGE_CUT_SOURCE_PATTERN/u);
  assert.doesNotMatch(
    read('../../../apps/shell/extensions/akari-annotations/src/browser/akari-annotations-widget.ts'),
    /IMAGE_CUT_SOURCE_PATTERN/u,
  );
});
