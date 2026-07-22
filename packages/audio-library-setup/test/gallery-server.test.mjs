import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGalleryServer } from '../gallery-server.mjs';

async function withServer(run) {
    const libraryRoot = await mkdtemp(path.join(tmpdir(), 'akari-audio-gallery-'));
    const server = createGalleryServer(libraryRoot);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await run({ libraryRoot, baseUrl });
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(libraryRoot, { recursive: true, force: true });
    }
}

async function seedEntry(libraryRoot, id, { attributionRequired = false, aiTrainingAllowed = false } = {}) {
    const dir = path.join(libraryRoot, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'meta.json'), JSON.stringify({
        id, category: 'audio', title: `タイトル-${id}`, author: 'テスト配布元',
        license: { attribution_required: attributionRequired, ai_training_allowed: aiTrainingAllowed },
    }));
    await writeFile(path.join(dir, `${id}.mp3`), 'dummy-audio-bytes');
}

test('GET / serves the gallery template', async () => {
    await withServer(async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.match(text, /試聴ギャラリー/);
    });
});

test('GET /api/entries lists registered entries and reflects decisions', async () => {
    await withServer(async ({ libraryRoot, baseUrl }) => {
        await seedEntry(libraryRoot, 'sample-a');
        await seedEntry(libraryRoot, 'sample-b', { attributionRequired: true, aiTrainingAllowed: false });

        const before = await (await fetch(`${baseUrl}/api/entries`)).json();
        assert.equal(before.entries.length, 2);
        assert.deepEqual(before.decisions, {});

        const postRes = await fetch(`${baseUrl}/api/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'sample-a', decision: 'keep' }),
        });
        assert.equal(postRes.status, 200);

        const after = await (await fetch(`${baseUrl}/api/entries`)).json();
        assert.equal(after.decisions['sample-a'].decision, 'keep');
        assert.ok(!('sample-b' in after.decisions));
    });
});

test('POST /api/decision with null clears a previous decision', async () => {
    await withServer(async ({ libraryRoot, baseUrl }) => {
        await seedEntry(libraryRoot, 'sample-a');
        await fetch(`${baseUrl}/api/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'sample-a', decision: 'drop' }),
        });
        await fetch(`${baseUrl}/api/decision`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: 'sample-a', decision: null }),
        });
        const state = await (await fetch(`${baseUrl}/api/entries`)).json();
        assert.ok(!('sample-a' in state.decisions));
    });
});

test('GET /media/<id>/<file> streams the audio file, rejects path traversal', async () => {
    await withServer(async ({ libraryRoot, baseUrl }) => {
        await seedEntry(libraryRoot, 'sample-a');

        const ok = await fetch(`${baseUrl}/media/sample-a/sample-a.mp3`);
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
        assert.equal(await ok.text(), 'dummy-audio-bytes');

        const traversal = await fetch(`${baseUrl}/media/${encodeURIComponent('../../etc/passwd')}`);
        assert.equal(traversal.status, 403);

        const missing = await fetch(`${baseUrl}/media/sample-a/does-not-exist.mp3`);
        assert.equal(missing.status, 404);
    });
});

test('entries without a playable audio file (only meta.json) are skipped', async () => {
    await withServer(async ({ libraryRoot, baseUrl }) => {
        const dir = path.join(libraryRoot, 'meta-only');
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ id: 'meta-only', title: 'x' }));

        const { entries } = await (await fetch(`${baseUrl}/api/entries`)).json();
        assert.equal(entries.length, 0);
    });
});
