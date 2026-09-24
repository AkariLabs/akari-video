import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './caption-animator-webview-harness.mjs';

const require = createRequire(import.meta.url);
const { parsePreviewCaptions, parseResolvedPreviewCaptions } = require('../lib/browser/akari-preview-captions.js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('legacy and resolved preview payloads retain run ranges', () => {
  const run = { from: 1, to: 2, role: 'emphasis', style: { color: '#f00' } };
  const caption = { id: 'c-0001', start: 0, end: 2, text: 'raw', display_text: '最高',
    speaker: null, sourceRef: null, edited: false, runs: [run] };
  const legacy = parsePreviewCaptions(JSON.stringify([caption]));
  assert.equal(legacy[0].text, '最高');
  assert.deepEqual(legacy[0].runs, [run]);
  const resolved = parseResolvedPreviewCaptions({ schema: 'caption-layout/v1', captions: [{
    id: 'c-0001', source_cue_id: 'c-0001', start: 0, end: 2, text: '最高', runs: [run]
  }] });
  assert.deepEqual(resolved[0].runs, [run]);
});

test('webview injects the self-contained run HTML renderer at both layout sites', async () => {
  const source = await readFile(join(root, 'src/browser/akari-preview-open-handler.ts'), 'utf8');
  assert.match(source, /applyCaptionRunsToHtml\.toString\(\)/);
  assert.match(source, /measuringPlate\.innerHTML = candidate\.runs\?\.length/);
  assert.match(source, /captionPlate\.innerHTML = caption\.runs\?\.length/);
});

test('webview DOM marks only run graphemes and preserves plain captions', () => {
  const cue = { id: 'c-0001', start: 0, end: 2, text: '最高です',
    runs: [{ from: 0, to: 2, role: 'emphasis', style: { color: '#ff5a5f', scale: 1.3 } }] };
  const styled = harness({ cues: [cue] });
  styled.tick(1);
  assert.equal((styled.plate.innerHTML.match(/data-role="emphasis"/g) ?? []).length, 2);
  assert.match(styled.plate.innerHTML, /color:#ff5a5f/);
  const plain = harness({ cues: [{ ...cue, runs: undefined }] });
  plain.tick(1);
  assert.doesNotMatch(plain.plate.innerHTML, /akari-caption__run/);
});
