import assert from 'node:assert/strict'; import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'; import { tmpdir } from 'node:os';
import { join } from 'node:path'; import { pathToFileURL } from 'node:url';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
const uri = value => pathToFileURL(value).toString();
async function fixture(arrayRoot = false) {
  const root = await mkdtemp(join(tmpdir(), 'emphasis-words-')); const captionsPath = join(root, 'captions.json');
  const captions = [{ id: 'c-1', start: 0, end: 2, text: 'AB', speaker: null, sourceRef: null, edited: false,
    words: [{ text: 'A', start: 0, end: 1 }, { text: 'B', start: 1, end: 2 }] }];
  await writeFile(captionsPath, arrayRoot ? `${JSON.stringify(captions, null, 2)}\n`
    : `{\n  "meta": "KEEP",\n  "captions": ${JSON.stringify(captions)}\n}\n`);
  await writeFile(join(root, 'edit.json'), '{"version":1,"fps":30,"source":"x.mp4","cuts":[],"overlays":[],"audio":{"sfx":[],"narration":[]}}\n');
  return { root, captionsPath, request: { captionsUri: uri(captionsPath), projectRootUri: uri(root) } };
}
test('upserts two stable records, preserves captions bytes, removes and no-ops', async () => {
  const data = await fixture(); try {
    const before = await readFile(data.captionsPath, 'utf8'); const captionBytes = before.slice(before.indexOf('['), before.lastIndexOf(']') + 1);
    const service = new AkariAnnotationsServiceImpl();
    const first = await service.setEmphasisWords({ ...data.request, upserts: [
      { t_start: 0, t_end: 1, word: 'A', emotion: 'neutral', style_preset: 'neon' },
      { t_start: 1, t_end: 2, word: 'B', emotion: 'neutral', style_preset: 'neon' }
    ], removeIds: [] });
    assert.deepEqual(first.ids, ['e-0001', 'e-0002']);
    const written = await readFile(data.captionsPath, 'utf8'); assert.ok(written.includes(captionBytes));
    const second = await service.setEmphasisWords({ ...data.request, upserts: [
      { t_start: 0, t_end: 1, word: 'A', emotion: 'neutral', style_preset: 'neon' }
    ], removeIds: [] });
    assert.equal(second.changed, 0); assert.equal(await readFile(data.captionsPath, 'utf8'), written);
    await service.setEmphasisWords({ ...data.request, upserts: [], removeIds: ['e-0001', 'e-0002'] });
    assert.equal(JSON.parse(await readFile(data.captionsPath, 'utf8')).emphasis_words, undefined);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});
test('wraps array root without changing the captions array bytes', async () => {
  const data = await fixture(true); try {
    const before = (await readFile(data.captionsPath, 'utf8')).trim();
    await new AkariAnnotationsServiceImpl().setEmphasisWords({ ...data.request,
      upserts: [{ t_start: 0, t_end: 1, word: 'A', emotion: 'neutral', style_preset: 'neon' }], removeIds: [] });
    const after = await readFile(data.captionsPath, 'utf8'); assert.ok(after.includes(before)); assert.equal(JSON.parse(after).emphasis_words.length, 1);
  } finally { await rm(data.root, { recursive: true, force: true }); }
});
