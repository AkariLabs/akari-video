import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readLintSourceSync } from '../../edit-lint/test/helpers/read-lint-source.mjs';
import { readAllSourceText } from '../../../apps/shell/extensions/akari-annotations/test/helpers/widget-source.mjs';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('UI・lint・カーネル・レンダー投影は同じ planTransitionHandleWindow を import する', () => {
  const lintSource = readLintSourceSync();
  const consumers = [
    read('../src/timeline-map.ts'),
    read('../src/internal-model.ts'),
    lintSource,
    readAllSourceText(),
  ];
  for (const source of consumers) {
    assert.match(source, /planTransitionHandleWindow/u);
  }
  assert.doesNotMatch(lintSource, /IMAGE_CUT_SOURCE_PATTERN/u);
  assert.doesNotMatch(
    readAllSourceText(),
    /IMAGE_CUT_SOURCE_PATTERN/u,
  );
});
