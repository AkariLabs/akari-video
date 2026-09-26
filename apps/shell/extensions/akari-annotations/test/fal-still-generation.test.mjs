import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StillGenerationManager } from '../lib/node/still-generation.js';
import { replaceStillInEdit } from '../lib/browser/inspector/ai-still-panel.js';
import { plannedStillMeta } from '../../../../../packages/generate/src/cli/meta-still.mjs';
import { validateGenerationMeta } from '../../../../../packages/generate/src/cli/meta-validate.mjs';

const repo = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const findAsset = async relativePath => join(repo, relativePath);
const dummyKey = 'stub-fal-still-unit-test';
const pngFixture = new URL('./fixtures/generation-states/assets/generated/planned.png', import.meta.url);

async function fixture(withReference) {
  const dir = await mkdtemp(join(tmpdir(), 'akari-fal-still-unit-'));
  await mkdir(join(dir, 'assets/generated'), { recursive: true });
  const png = await readFile(pngFixture);
  await writeFile(join(dir, 'assets/generated/old.png'), png);
  if (withReference) await writeFile(join(dir, 'assets/generated/ref.png'), png);
  const at = new Date().toISOString();
  await writeFile(join(dir, 'assets/generated/old.png.meta.json'), JSON.stringify(
    plannedStillMeta({ prompt: '', duration_s: 3, at, asOf: at.slice(0, 10) })));
  await writeFile(join(dir, 'edit.json'), JSON.stringify({ version: 2, output: { fps: 30 },
    sources: [{ id: 'old', path: 'assets/generated/old.png' }],
    tracks: [{ items: [{ id: 'clip-1', duration: 90, source: { kind: 'media', src: 'old' } }] }] }));
  return { dir, png };
}

async function stubServer(png, holdSubmit = false) {
  const requests = [];
  let releaseSubmit;
  const submitGate = new Promise(resolve => { releaseSubmit = resolve; });
  let notifySubmit;
  const submitted = new Promise(resolve => { notifySubmit = resolve; });
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const part of req) chunks.push(part);
    const entry = { method: req.method, path: new URL(req.url, 'http://127.0.0.1').pathname,
      authorization: req.headers.authorization, body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null };
    requests.push(entry);
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.method === 'POST') {
      notifySubmit();
      if (holdSubmit) await submitGate;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ request_id: 'unit-1', status_url: `${base}/status/1`, response_url: `${base}/response/1` }));
    } else if (entry.path === '/status/1') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ status: 'COMPLETED' }));
    } else if (entry.path === '/response/1') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ images: [{ url: `${base}/image.png` }] }));
    } else if (entry.path === '/image.png') {
      res.setHeader('content-type', 'image/png'); res.end(png);
    } else { res.statusCode = 404; res.end('missing'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, submitted, releaseSubmit, url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { releaseSubmit(); await new Promise(resolve => server.close(resolve)); } };
}

function manager(dir, url) {
  return new StillGenerationManager(findAsset, { env: {
    HOME: dir, AKARI_HOME: join(dir, 'akari-home'), AKARI_CREDENTIALS_FILE: join(dir, 'none.env'),
    FAL_KEY: dummyKey, AKARI_FAL_STUB_URL: url
  } });
}

for (const withReference of [false, true]) {
  test(`fal 静止画 ${withReference ? '参照あり edit' : 'text-to-image'} はスタブ PNG・meta・枠を完成させる`, async () => {
    const { dir, png } = await fixture(withReference);
    const stub = await stubServer(png, true);
    try {
      const pending = manager(dir, stub.url).startGenerateStill(dir, { itemId: 'clip-1', prompt: 'A garden',
        aspect: '1:1', route: 'fal', quality: 'high', approved: true,
        references: withReference ? ['assets/generated/ref.png'] : [] });
      await stub.submitted;
      const generating = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json'), 'utf8'));
      assert.equal(generating.status, 'generating');
      assert.equal(generating.job.provider, 'fal');
      stub.releaseSubmit();
      const result = await pending;
      assert.equal(result.ok, true, result.reason);
      assert.equal((await readFile(join(dir, result.relativePath))).equals(png), true);
      const restored = JSON.parse(await readFile(join(dir, 'assets/generated/old.png.meta.json'), 'utf8'));
      assert.equal(restored.status, 'planned');
      assert.ok(restored.history.some(entry => entry.status === 'generating'));

      const posts = stub.requests.filter(entry => entry.method === 'POST');
      assert.equal(posts.length, 1);
      assert.equal(posts[0].path, `/openai/gpt-image-2.5/flare/${withReference ? 'edit' : 'text-to-image'}`);
      assert.equal(posts[0].authorization, `Key ${dummyKey}`);
      assert.equal(posts[0].body.image_size, 'square_hd');
      assert.equal(posts[0].body.quality, 'high');
      if (withReference) {
        assert.equal(posts[0].body.image_urls.length, 1);
        assert.match(posts[0].body.image_urls[0], /^data:image\/png;base64,/);
      } else assert.equal('image_urls' in posts[0].body, false);

      const meta = JSON.parse(await readFile(join(dir, `${result.relativePath}.meta.json`), 'utf8'));
      assert.deepEqual(validateGenerationMeta(meta), { ok: true, errors: [] });
      assert.equal(meta.model.id, 'fal:gpt-image-2.5-flare');
      assert.equal(meta.job.provider, 'fal');
      assert.equal(meta.cost.estimate_usd, 0.0528);
      assert.equal(meta.cost.unit, 'usd_per_image');
      assert.equal(meta.provenance.key_source, 'env:FAL_KEY');
      assert.equal(meta.provenance.key_source.includes(dummyKey), false);
      assert.equal(meta.result.sha256, createHash('sha256').update(png).digest('hex'));

      const editPath = join(dir, 'edit.json');
      const edit = replaceStillInEdit(JSON.parse(await readFile(editPath, 'utf8')), 'clip-1', result.relativePath);
      await writeFile(editPath, JSON.stringify(edit));
      const stored = JSON.parse(await readFile(editPath, 'utf8'));
      const clip = stored.tracks[0].items[0];
      assert.equal(stored.sources.find(row => row.id === clip.source.src)?.path, result.relativePath);
    } finally { await stub.close(); await rm(dir, { recursive: true, force: true }); }
  });
}

test('fal の費用承認を断ると稼働中のスタブに submit しない', async () => {
  const { dir, png } = await fixture(false);
  const stub = await stubServer(png);
  try {
    const result = await manager(dir, stub.url).startGenerateStill(dir, { itemId: 'clip-1', prompt: 'A garden',
      aspect: '1:1', route: 'fal', approved: false });
    assert.equal(result.ok, false);
    assert.match(result.reason, /費用承認/u);
    assert.equal(stub.requests.filter(entry => entry.method === 'POST').length, 0);
  } finally { await stub.close(); await rm(dir, { recursive: true, force: true }); }
});
