import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { describeNextDraft } from '@akari-video/edit-store';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'akari-frame-rpc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [] });
  await writeFile(join(root, 'edit.json'), before);
  return { root, before, request: { projectRootUri: pathToFileURL(root).toString(), durationSeconds: 2.5 } };
}
async function cardModule(service, root, body) {
  // Runtime injection through the same asset resolver used by packaged Resources.
  const modulePath = join(root, 'text-card-test.mjs');
  await writeFile(modulePath, body);
  const original = service.findGenerationAsset.bind(service);
  service.findGenerationAsset = target => target.endsWith('/text-card.mjs') ? Promise.resolve(modulePath) : original(target);
}
test('RPC creates a real canvas PNG and valid planned empty meta, with unique paths', async t => {
  const f = await fixture(t), service = new AkariAnnotationsServiceImpl();
  const cardUrl = new URL('../../../../../packages/generate/src/cli/text-card.mjs', import.meta.url).href;
  await cardModule(service, f.root, `import { renderTextCard as render } from ${JSON.stringify(cardUrl)};
    export const renderTextCard = options => render({...options, loadPuppeteer: async()=>null,
      resolveBinary:()=>{throw new Error('no ffmpeg')}, logRenderer:()=>{}});`);
  const results = await Promise.all([service.createEmptyGenerationFrame(f.request), service.createEmptyGenerationFrame(f.request)]);
  assert.notEqual(results[0].relativePath, results[1].relativePath);
  for (const result of results) {
    const png = await readFile(join(f.root, result.relativePath));
    assert.equal(png.readUInt32BE(16), 640); assert.equal(png.readUInt32BE(20), 360);
    assert.equal(createHash('sha256').update(png).digest('hex'), result.sha256);
    const meta = JSON.parse(await readFile(join(f.root, `${result.relativePath}.meta.json`), 'utf8'));
    assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
    assert.equal(meta.kind, 'still'); assert.equal(meta.status, 'planned');
    assert.equal(meta.inputs.prompt, ''); assert.equal(meta.output.duration_s, 2.5);
    assert.equal(describeNextDraft(meta), null);
  }
  assert.equal(await readFile(join(f.root, 'edit.json'), 'utf8'), f.before);
  assert.equal((await readdir(join(f.root, 'assets/generated'))).length, 4);
});
for (const body of [
  `export async function renderTextCard(){ throw new Error('PNG unavailable'); }`,
  `import {writeFile} from 'node:fs/promises'; export async function renderTextCard(o){await writeFile(o.outPath,'broken');return {path:o.outPath,renderer:'broken'};}`
]) test('render failure/invalid PNG publishes no files and edit stays byte-identical', async t => {
  const f = await fixture(t), service = new AkariAnnotationsServiceImpl();
  await cardModule(service, f.root, body);
  await assert.rejects(service.createEmptyGenerationFrame(f.request));
  assert.equal(await readFile(join(f.root, 'edit.json'), 'utf8'), f.before);
  assert.deepEqual(await readdir(join(f.root, 'assets/generated')), []);
});
