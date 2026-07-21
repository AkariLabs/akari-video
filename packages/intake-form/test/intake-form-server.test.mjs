import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createIntakeFormServer, intakePathFor } from '../intake-form-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const validateScript = path.join(here, '..', '..', 'schemas', 'bin', 'validate-intake.mjs');

async function withServer(run) {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'akari-intake-form-'));
    const server = createIntakeFormServer(projectRoot);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await run({ projectRoot, baseUrl });
    } finally {
        await new Promise(resolve => server.close(resolve));
        await rm(projectRoot, { recursive: true, force: true });
    }
}

test('GET /api/state returns 404 before anything is submitted', async () => {
    await withServer(async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/state`);
        assert.equal(res.status, 404);
    });
});

test('POST /api/state writes a schema-valid submitted intake.json', async () => {
    await withServer(async ({ baseUrl, projectRoot }) => {
        const body = {
            version: 1,
            tasks: ['transcribe-captions', 'bgm-sfx'],
            target: { duration_s: 30, keep_length: false, taste: 'テンポよく' },
            autonomy: 'checkpoint',
            status: 'submitted',
            submitted_at: new Date().toISOString()
        };
        const postRes = await fetch(`${baseUrl}/api/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        assert.equal(postRes.status, 200);

        const getRes = await fetch(`${baseUrl}/api/state`);
        assert.equal(getRes.status, 200);
        const stored = await getRes.json();
        assert.deepEqual(stored, body);

        const intakePath = intakePathFor(projectRoot);
        const result = spawnSync(process.execPath, [validateScript, intakePath], { encoding: 'utf8' });
        assert.equal(result.status, 0, `validate-intake.mjs should accept the written file:\n${result.stdout}${result.stderr}`);
    });
});

test('POST /api/state rejects invalid JSON bodies', async () => {
    await withServer(async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/api/state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json'
        });
        assert.equal(res.status, 400);
    });
});

test('GET / serves the template HTML', async () => {
    await withServer(async ({ baseUrl }) => {
        const res = await fetch(`${baseUrl}/`);
        assert.equal(res.status, 200);
        const text = await res.text();
        assert.match(text, /進め方フォーム/);
    });
});
