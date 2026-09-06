import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

// Run after apps/shell's npm run build:ext; exercise the compiled service over HTTP.
class TestPreviewService extends AkariPreviewServiceImpl {
    constructor(root) {
        super();
        this.root = root;
    }

    async resolveWorkspaceRoots() {
        return [this.root];
    }

    async close() {
        if (this.server) {
            await new Promise((resolve, reject) => {
                this.server.close(error => error ? reject(error) : resolve());
            });
        }
    }
}

const bytes = Buffer.from('0123456789abcdef');
const formats = [
    ['.mp4', 'video/mp4'],
    ['.webm', 'video/webm'],
    ['.mov', 'video/mp4'],
    ['.png', 'image/png'],
    ['.glb', 'model/gltf-binary']
];

async function fixture(t, extension = '.mp4') {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'akari asset 日本語-')));
    const service = new TestPreviewService(root);
    t.after(async () => {
        try {
            await service.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
    const assetUri = pathToFileURL(join(root, `素材${extension}`)).toString();
    await writeFile(new URL(assetUri), bytes);
    const stream = await service.createAssetStream({ assetUri });
    return { service, stream, assetUri };
}

for (const [extension, mimeType] of formats) {
    test(`asset ${extension}: extension URL, MIME type, CORS and complete bytes`, async t => {
        const { stream } = await fixture(t, extension);
        assert.match(stream.id, /^[a-f0-9]{64}$/);
        assert.equal(new URL(stream.url).pathname, `/asset/${stream.id}${extension}`);
        const response = await fetch(stream.url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), mimeType);
        assert.equal(response.headers.get('accept-ranges'), 'bytes');
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
        assert.equal(response.headers.get('content-length'), String(bytes.length));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    });
}

test('uppercase .MP4 produces a lowercase .mp4 URL that serves the asset', async t => {
    const { stream } = await fixture(t, '.MP4');
    assert.equal(new URL(stream.url).pathname, `/asset/${stream.id}.mp4`);
    const response = await fetch(stream.url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('asset URLs satisfy the actual three-runtime VIDEO_TEXTURE_PATTERN', async t => {
    const source = await readFile(new URL(
        '../../../../../packages/overlay-runtime/src/three-runtime.js', import.meta.url
    ), 'utf8');
    const declaration = source.match(/const VIDEO_TEXTURE_PATTERN = \/(.+)\/([a-z]*);/);
    assert.ok(declaration, 'runtime must declare VIDEO_TEXTURE_PATTERN as a RegExp literal');
    const pattern = new RegExp(declaration[1], declaration[2]);
    for (const [extension] of [...formats, ['.m4v'], ['.MP4']]) {
        const { stream } = await fixture(t, extension);
        pattern.lastIndex = 0;
        assert.equal(pattern.test(stream.url), !['.png', '.glb'].includes(extension), extension);
    }
});

test('Range requests return 206 and the requested bytes', async t => {
    const { stream } = await fixture(t);
    const response = await fetch(stream.url, { headers: { Range: 'bytes=2-5' } });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), `bytes 2-5/${bytes.length}`);
    assert.equal(response.headers.get('content-length'), '4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes.subarray(2, 6));
});

test('legacy extensionless asset URLs still return 200', async t => {
    const { stream } = await fixture(t);
    const response = await fetch(new URL(`/asset/${stream.id}`, stream.url));
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('an existing id with a mismatched extension returns 404', async t => {
    const { stream } = await fixture(t);
    const response = await fetch(new URL(`/asset/${stream.id}.png`, stream.url));
    assert.equal(response.status, 404);
    await response.arrayBuffer();
});

test('unknown asset ids return 404 with and without an extension', async t => {
    const { stream } = await fixture(t);
    const unknown = (stream.id[0] === '0' ? '1' : '0') + stream.id.slice(1);
    for (const extension of ['', '.mp4']) {
        const response = await fetch(new URL(`/asset/${unknown}${extension}`, stream.url));
        assert.equal(response.status, 404);
        await response.arrayBuffer();
    }
});

test('HEAD returns 200 with asset headers and no body', async t => {
    const { stream } = await fixture(t);
    const response = await fetch(stream.url, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test('disposing by id invalidates both asset URL forms', async t => {
    const { service, stream } = await fixture(t);
    await service.disposeAssetStream(stream.id);
    for (const extension of ['', '.mp4']) {
        const response = await fetch(new URL(`/asset/${stream.id}${extension}`, stream.url));
        assert.equal(response.status, 404);
        await response.arrayBuffer();
    }
});

test('video streams retain the extensionless /media/ URL and serve bytes', async t => {
    const { service, assetUri } = await fixture(t);
    const stream = await service.createVideoStream({ videoUri: assetUri });
    assert.match(stream.id, /^[a-f0-9]{64}$/);
    assert.equal(new URL(stream.url).pathname, `/media/${stream.id}`);
    const response = await fetch(stream.url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
