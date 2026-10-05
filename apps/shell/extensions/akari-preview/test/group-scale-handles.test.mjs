import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bootstrap = readFileSync(new URL('../src/browser/preview-script-bootstrap.ts', import.meta.url), 'utf8');
const interaction = readFileSync(new URL('../../../../../packages/overlay-runtime/src/interaction.js', import.meta.url), 'utf8');

test('canvas group corner resize commits a uniform scale pose', () => {
  const body = interaction.slice(interaction.indexOf('  function beginGroupResize('),
    interaction.indexOf('  function beginRotate(', interaction.indexOf('  function beginGroupResize(')));
  const finish = interaction.slice(interaction.indexOf('  function finishGroupTransform('),
    interaction.indexOf('  function moveGroupDrag(', interaction.indexOf('  function finishGroupTransform(')));
  assert.match(body, /group: true/u);
  assert.match(finish, /scale: gesture\.pose\.scale/u);
  assert.doesNotMatch(finish, /scaleX|scaleY/u);
});

test('canvas group edge handles are hidden while corner handles remain', () => {
  const rule = bootstrap.match(/groupEdgeStyle\.textContent = ([\s\S]*?);\s*document\.head\.appendChild\(groupEdgeStyle\)/u);
  assert.ok(rule, 'group selection frame has a local edge visibility rule');
  assert.match(rule[1], /data-akari-selection-kind=\\?"group\\?"/u);
  assert.match(rule[1], /\.akari-interaction-handle\.is-edge/u);
  assert.match(rule[1], /display: none !important/u);
  assert.doesNotMatch(rule[1], /is-nw|is-ne|is-sw|is-se/u);
});
