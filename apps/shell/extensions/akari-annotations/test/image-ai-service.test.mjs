import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { ImageAiService, FalImageAiProvider, IMAGE_AI_MODELS } from '../lib/node/image-ai-service.js';
import { imageAiBindingMatches } from '../lib/common/image-ai-binding.js';
import { replaceMaterial } from '../lib/common/material-replacement.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const image = Buffer.alloc(24);
image.write('PNG', 1); image.writeUInt32BE(1024, 16); image.writeUInt32BE(512, 20);
const resultImage = Buffer.from('result-image');
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'akari-image-ai-test-'));
    await mkdir(join(root, 'assets/still'), { recursive: true });
    await writeFile(join(root, 'assets/still/photo.png'), image);
    const edit = { version: 2, output: { fps: 30 }, sources: [{ id: 'photo', path: 'assets/still/photo.png' }],
        tracks: [{ id: 'visual', lane: 'visual', items: [
            { id: 'item-1', at: 0, duration: 90, source: { kind: 'media', src: 'photo', in: 0, out: 3 } },
            { id: 'item-2', at: 90, duration: 90, source: { kind: 'media', src: 'photo', in: 0, out: 3 } }
        ] }] };
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit));
    return { root, edit, uri: pathToFileURL(root).toString(), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('preview needs a key and reports dimensions, bytes and model price', async () => {
    const f = await fixture();
    try {
        const service = new ImageAiService(new FalImageAiProvider(async () => { throw Error('network must not run'); }), async () => undefined);
        const inspected = await service.inspect(f.uri, 'item-1');
        assert.equal(inspected.configured, false);
        assert.equal(inspected.width, 1024);
        assert.equal(inspected.height, 512);
        assert.equal(inspected.priceUsd, 0.0629);
        await assert.rejects(() => service.upscale({ projectRootUri: f.uri, binding: inspected.binding, jobId: 'job-1' }), /キーを設定/);
    } finally { await f.cleanup(); }
});

test('mock fal queue saves immutable alternative and provenance, then rejects stale edit', async () => {
    const f = await fixture();
    const calls = [];
    const fetchMock = async (url, init) => {
        calls.push([url, init?.method || 'GET']);
        if (url === `https://queue.fal.run/${IMAGE_AI_MODELS.upscale}`) {
            assert.equal(init.headers.Authorization, 'Key sample-key');
            const body = JSON.parse(init.body);
            assert.match(body.image_url, /^data:image\/png;base64,/);
            return json({ status_url: 'https://queue.fal.run/mock/status', response_url: 'https://queue.fal.run/mock/response' });
        }
        if (url === 'https://queue.fal.run/mock/status') return json({ status: 'COMPLETED' });
        if (url === 'https://queue.fal.run/mock/response') return json({ image: { url: 'https://v3.fal.media/result.png', content_type: 'image/png' } });
        if (url === 'https://v3.fal.media/result.png') return new Response(resultImage, { headers: { 'content-type': 'image/png' } });
        throw Error(`unexpected URL ${url}`);
    };
    try {
        const service = new ImageAiService(new FalImageAiProvider(fetchMock, async () => undefined), async () => 'sample-key');
        const preview = await service.inspect(f.uri, 'item-1');
        const result = await service.upscale({ projectRootUri: f.uri, binding: preview.binding, jobId: 'job-1' });
        assert.equal(result.relativePath, `assets/generated/${hash(resultImage)}.png`);
        assert.deepEqual(await readFile(join(f.root, result.relativePath)), resultImage);
        const meta = JSON.parse(await readFile(join(f.root, `${result.relativePath}.meta.json`), 'utf8'));
        assert.equal(meta.provider, 'fal'); assert.equal(meta.model, IMAGE_AI_MODELS.upscale);
        assert.equal(meta.item_id, 'item-1');
        assert.equal(meta.edit_version, preview.binding.editVersion);
        assert.equal(meta.input_sha256, hash(image));
        assert.equal(meta.parameters.upscale_factor, 2);
        assert.equal(imageAiBindingMatches(f.edit, result.binding, hash(image)), true);
        assert.equal(imageAiBindingMatches({ ...f.edit, output: { fps: 24 } }, result.binding, hash(image)), true);
        const unrelatedEdit = structuredClone(f.edit);
        unrelatedEdit.tracks[0].items[1].at = 120;
        await writeFile(join(f.root, 'edit.json'), JSON.stringify(unrelatedEdit));
        const reopened = await new ImageAiService(new FalImageAiProvider(async () => {
            throw Error('reopening must not call the network');
        }), async () => undefined).inspect(f.uri, 'item-1');
        assert.equal(reopened.configured, false);
        assert.deepEqual(reopened.alternatives.map(row => row.relativePath), [result.relativePath]);
        assert.equal(imageAiBindingMatches(unrelatedEdit, reopened.alternatives[0].binding, hash(image)), true);
        const adopted = replaceMaterial(f.edit, { itemId: 'item-1', relativePath: result.relativePath, kind: 'image' });
        assert.equal(adopted.sources.find(row => row.id === 'photo').path, 'assets/still/photo.png');
        const newSource = adopted.sources.find(row => row.path === result.relativePath);
        assert.equal(adopted.tracks[0].items[0].source.src, newSource.id);
        assert.equal(f.edit.tracks[0].items[0].source.src, 'photo');
        const replacedSource = structuredClone(unrelatedEdit);
        replacedSource.sources[0].path = 'assets/still/replacement.png';
        await writeFile(join(f.root, 'assets/still/replacement.png'), image);
        await writeFile(join(f.root, 'edit.json'), JSON.stringify(replacedSource));
        const afterReplacement = await new ImageAiService(undefined, async () => undefined).inspect(f.uri, 'item-1');
        assert.deepEqual(afterReplacement.alternatives, []);
        assert.equal(calls.length, 4);
        const savedEdit = await readFile(join(f.root, 'edit.json'), 'utf8');
        assert.doesNotMatch(savedEdit, /sample-key|fal\.media/);
    } finally { await f.cleanup(); }
});

test('failed authorization is reported without leaking the key', async () => {
    const provider = new FalImageAiProvider(async () => new Response('{}', { status: 401 }));
    await assert.rejects(() => provider.upscale({ bytes: image, mime: 'image/png', key: 'very-secret',
        signal: new AbortController().signal, setCancel: () => undefined }), error => {
        assert.match(error.message, /キーが無効/);
        assert.doesNotMatch(error.message, /very-secret/);
        return true;
    });
});

test('background execution sends the foreground mask through the same provider port', async () => {
    const f = await fixture();
    try {
        await writeFile(join(f.root, 'assets/still/mask.png'), image);
        const provider = new FalImageAiProvider(async (url, init) => {
            if (url === `https://queue.fal.run/${IMAGE_AI_MODELS.generateBackground}`) {
                const body = JSON.parse(init.body);
                assert.match(body.image_url, /^data:image\/png;base64,/);
                assert.match(body.mask_url, /^data:image\/png;base64,/);
                assert.equal(body.prompt, '夕焼けの空');
                return json({ status_url: 'https://queue.fal.run/mock/status', response_url: 'https://queue.fal.run/mock/response' });
            }
            if (url === 'https://queue.fal.run/mock/status') return json({ status: 'COMPLETED' });
            if (url === 'https://queue.fal.run/mock/response') return json({ images: [{ url: 'https://v3.fal.media/background.png', content_type: 'image/png' }] });
            if (url === 'https://v3.fal.media/background.png') return new Response(resultImage, { headers: { 'content-type': 'image/png' } });
            throw Error(`unexpected URL ${url}`);
        });
        const service = new ImageAiService(provider, async () => 'sample-key');
        const result = await service.generateBackground({ projectRootUri: f.uri, itemId: 'item-1',
            prompt: '夕焼けの空', maskPath: 'assets/still/mask.png' });
        assert.equal(result.model, IMAGE_AI_MODELS.generateBackground);
        assert.equal(result.relativePath, `assets/generated/${hash(resultImage)}.png`);
        const meta = JSON.parse(await readFile(join(f.root, `${result.relativePath}.meta.json`), 'utf8'));
        assert.equal(meta.parameters.prompt, '夕焼けの空');
    } finally { await f.cleanup(); }
});
