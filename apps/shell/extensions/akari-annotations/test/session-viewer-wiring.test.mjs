import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');

test('session viewer exposes the stable DOM and synchronization hooks without writes', async () => {
  const widget = await source('../src/browser/akari-session-viewer-widget.ts');
  for (const hook of [
    'data-viewer-play', 'data-viewer-seek', 'data-viewer-audio', 'data-viewer-utterance',
    'data-viewer-utterance-active', 'data-viewer-utterance-target', 'data-viewer-diff-row',
    'data-viewer-diff-legacy', 'data-viewer-transcript-empty'
  ]) assert.match(widget, new RegExp(hook));
  assert.match(widget, /akari\.review\.session\.viewer\.sync/);
  for (const phase of ["'attach'", "'tick'", "'detach'"]) assert.match(widget, new RegExp(phase));
  assert.doesNotMatch(widget, /\.write\(|writeFile|createFile/);
});

test('active utterance has a visible selection treatment and fully clears it when inactive', async () => {
  const widget = await source('../src/browser/akari-session-viewer-widget.ts');
  assert.match(widget, /row\.setAttribute\('data-viewer-utterance-active', ''\)/);
  assert.match(widget, /row\.style\.background = 'var\(--theia-list-activeSelectionBackground\)'/);
  assert.match(widget, /row\.style\.color = 'var\(--theia-list-activeSelectionForeground\)'/);
  assert.match(widget, /row\.style\.borderLeft = '3px solid var\(--theia-focusBorder\)'/);
  assert.match(widget, /row\.style\.fontWeight = '600'/);
  assert.match(widget, /row\.style\.background = ''/);
  assert.match(widget, /row\.style\.color = ''/);
  assert.match(widget, /row\.style\.borderLeft = ''/);
  assert.match(widget, /row\.style\.fontWeight = ''/);
});

test('panel keeps its grid and the preview handler receives seek ticks', async () => {
  const panel = await source('../src/browser/akari-review-panel-widget.ts');
  assert.match(panel, /data-review-session-viewer/);
  assert.match(panel, /gridTemplateColumns: 'auto minmax\(0, 1fr\) auto auto'/);
  const handler = await source('../../akari-preview/src/browser/akari-preview-open-handler.ts');
  assert.match(handler, /akari\.review\.session\.viewer\.sync/);
  assert.match(handler, /'akari-preview-seek'/);
});
