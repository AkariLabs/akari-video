import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

const run = promisify(execFile);
const uri = path => pathToFileURL(path).toString();
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const caption = (id, start, texts) => ({ id, start, end: start + texts.length, text: texts.join(''), speaker: null,
  sourceRef: { segment: 0 }, edited: false, words: texts.map((text, index) => ({ text, start: start + index, end: start + index + .8 })) });
const editV2 = captionId => ({ version: 2, output: { width: 320, height: 180, fps: 30 }, sources: [{ id: 'main', path: 'main.mp4' }], tracks: [
  { id: 'main', lane: 'visual', items: [{ id: 'cut', at: 0, duration: 600, source: { kind: 'media', src: 'main', in: 0, out: 20 } }] },
  { id: 'overlay', lane: 'visual', items: [{ id: 'anchored', at: 0, duration: 1, source: { kind: 'html', path: 'box.html' }, anchor: { caption: captionId } }] }
] });

async function fixture(edit, captions, git = false) {
  const root = await mkdtemp(join(tmpdir(), 'daihon-split-merge-service-'));
  const editPath = join(root, 'edit.json'); const captionsPath = join(root, 'captions.json');
  await writeFile(editPath, json(edit)); await writeFile(captionsPath, json(captions)); await writeFile(join(root, 'box.html'), '<div>box</div>');
  if (git) {
    await run('git', ['init', '-q'], { cwd: root }); await run('git', ['add', '.'], { cwd: root });
    await run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial'], { cwd: root });
  }
  return { root, editPath, captionsPath, request: { editUri: uri(editPath), captionsUri: uri(captionsPath), projectRootUri: uri(root) } };
}
const cleanup = root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
const anchored = edit => edit.tracks[1].items[0];

test('splitCaption は anchor の duration を前半行境界へ追従させる', async () => {
  const f = await fixture(editV2('c-0001'), [caption('c-0001', 0, ['a', 'b'])]);
  try { await new AkariAnnotationsServiceImpl().splitCaption({ ...f.request, captionId: 'c-0001', wordIndex: 1, newCaptionId: 'c-0002' });
    assert.deepEqual({ at: anchored(JSON.parse(await readFile(f.editPath, 'utf8'))).at, duration: anchored(JSON.parse(await readFile(f.editPath, 'utf8'))).duration }, { at: 0, duration: 24 });
  } finally { await cleanup(f.root); }
});

test('mergeCaptions は anchor の duration を結合後行境界へ追従させる', async () => {
  const f = await fixture(editV2('c-0001'), [caption('c-0001', 0, ['a']), caption('c-0002', 2, ['b'])]);
  try { await new AkariAnnotationsServiceImpl().mergeCaptions({ ...f.request, captionIds: ['c-0001', 'c-0002'] });
    assert.equal(anchored(JSON.parse(await readFile(f.editPath, 'utf8'))).duration, 90);
  } finally { await cleanup(f.root); }
});

for (const [name, invoke] of [
  ['splitCaption', (service, request) => service.splitCaption({ ...request, captionId: 'c-0001', wordIndex: 1, newCaptionId: 'c-0003' })],
  ['mergeCaptions', (service, request) => service.mergeCaptions({ ...request, captionIds: ['c-0001', 'c-0002'] })]
]) test(`v1 edit.json は ${name} の前後でバイト同一`, async () => {
  const legacy = { version: 1, output: { fps: 30 }, sources: [], cuts: [], overlays: [] };
  const f = await fixture(legacy, [caption('c-0001', 0, ['a', 'b']), caption('c-0002', 3, ['c'])]);
  const before = await readFile(f.editPath, 'utf8');
  try { await invoke(new AkariAnnotationsServiceImpl(), f.request); assert.equal(await readFile(f.editPath, 'utf8'), before); }
  finally { await cleanup(f.root); }
});

for (const [name, invoke] of [
  ['splitCaption', (service, request) => service.splitCaption({ ...request, captionId: 'c-0001', wordIndex: 1, newCaptionId: 'c-0003' })],
  ['mergeCaptions', (service, request) => service.mergeCaptions({ ...request, captionIds: ['c-0001', 'c-0002'] })]
]) test(`${name} は 1 操作で commit を 1 件だけ増やす`, async () => {
  const f = await fixture(editV2('c-0001'), [caption('c-0001', 0, ['a', 'b']), caption('c-0002', 3, ['c'])], true);
  try { const before = Number((await run('git', ['rev-list', '--count', 'HEAD'], { cwd: f.root })).stdout.trim());
    const result = await invoke(new AkariAnnotationsServiceImpl(), f.request);
    const after = Number((await run('git', ['rev-list', '--count', 'HEAD'], { cwd: f.root })).stdout.trim());
    assert.equal(result.committed, true); assert.equal(after, before + 1);
  } finally { await cleanup(f.root); }
});
