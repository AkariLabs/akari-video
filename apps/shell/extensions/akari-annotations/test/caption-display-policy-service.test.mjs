import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const uri = value => pathToFileURL(value).toString();
const policy = { mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
  unit_metric: 'ascii-half-other-one-v1', max_line_units: 12,
  minimum_fragment_duration_seconds: 0.72, locale: 'ja', lines: 2, wrap: 'multi' };

async function fixture(source) {
  const root = await mkdtemp(join(tmpdir(), 'caption-display-policy-'));
  const captionsPath = join(root, 'captions.json');
  await writeFile(captionsPath, source);
  await writeFile(join(root, 'edit.json'), '{"version":1,"fps":30,"source":"x.mp4","cuts":[],"overlays":[],"audio":{"sfx":[],"narration":[]}}\n');
  return { root, captionsPath, request: { captionsUri: uri(captionsPath), projectRootUri: uri(root), displayPolicy: policy } };
}

test('display_policy だけを 1 回書き、beforeSource を返す', async () => {
  const captions = '[{"id":"c-1","text":"KEEP","display_fragments":["KE","EP"]}]';
  const before = `{\n  "meta": "KEEP",\n  "captions": ${captions}\n}\n`;
  const data = await fixture(before);
  try {
    const result = await new AkariAnnotationsServiceImpl().setCaptionDisplayPolicy(data.request);
    const after = await readFile(data.captionsPath, 'utf8');
    assert.deepEqual(result, { committed: false, changed: 1, beforeSource: before });
    assert.ok(after.includes(captions));
    assert.equal(JSON.parse(after).display_policy.max_line_units, 12);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});

test('配列ルートを包み、同じ policy の再適用は no-op', async () => {
  const source = '[\n  {"id":"c-1","text":"KEEP"}\n]\n';
  const data = await fixture(source);
  try {
    const service = new AkariAnnotationsServiceImpl();
    await service.setCaptionDisplayPolicy(data.request);
    const written = await readFile(data.captionsPath, 'utf8');
    assert.ok(written.includes(source.trim()));
    const result = await service.setCaptionDisplayPolicy(data.request);
    assert.deepEqual(result, { committed: false, changed: 0, beforeSource: written });
  } finally { await rm(data.root, { recursive: true, force: true }); }
});
