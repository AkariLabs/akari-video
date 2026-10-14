import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readHandlerSource } from '../../akari-preview/test/helpers/handler-source.mjs';

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

test('panel leaves the viewer command available while removing its recording button', async () => {
  const panel = await source('../src/browser/akari-review-panel-widget.ts');
  const contribution = await source('../src/browser/akari-annotations-contribution.ts');
  assert.doesNotMatch(panel, /data-review-session-viewer/);
  assert.match(panel, /flexDirection: 'column'/);
  assert.match(panel, /flex: '1 1 0', minHeight: '0', overflow: 'auto'/);
  assert.match(panel, /maxHeight: '35%', overflow: 'auto'/);
  assert.match(panel, /position: 'static', width: 'auto', maxHeight: '25%', flex: 'none'/);
  assert.match(panel, /this\.node\.append\(\s*this\.toolbar,\s*this\.recordingSection,\s*this\.sessionList,\s*this\.filterButtons,\s*this\.notice\.node,\s*this\.listContainer,\s*this\.batchBar,\s*this\.composerRow\s*\)/);
  assert.doesNotMatch(panel, /gridTemplateRows/);
  assert.match(contribution, /registerCommand\(OPEN_AKARI_SESSION_VIEWER/);
  const handler = readHandlerSource();
  assert.match(handler, /akari\.review\.session\.viewer\.sync/);
  assert.match(handler, /'akari-preview-seek'/);
});
