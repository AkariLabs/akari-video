import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class Service extends AkariProjectServiceImpl {
    async resolveFfmpegPath() { return '/fake/bundled/ffmpeg'; }
    async resolveFfprobePath() { return '/fake/bundled/ffprobe'; }
}

async function fixture(t, overrides = {}) {
    const keys = ['AKARI_FFMPEG_BIN', 'AKARI_FFPROBE_BIN', 'ELECTRON_RUN_AS_NODE'];
    const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    t.after(() => {
        for (const key of keys) {
            if (originalEnv[key] === undefined) delete process.env[key];
            else process.env[key] = originalEnv[key];
        }
    });
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, overrides);

    const root = await mkdtemp(join(tmpdir(), 'run-node-script-media-bin-env-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const script = join(root, 'env.mjs');
    await writeFile(script, 'console.log(JSON.stringify({ f: process.env.AKARI_FFMPEG_BIN, p: process.env.AKARI_FFPROBE_BIN, e: process.env.ELECTRON_RUN_AS_NODE }));\n');
    return { root, script, service: new Service() };
}

test('runNodeScript: 解決した ffmpeg / ffprobe と ELECTRON_RUN_AS_NODE を実子プロセスへ渡す', async t => {
    const { root, script, service } = await fixture(t);
    const result = await service.runNodeScript(script, [], root);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
        f: '/fake/bundled/ffmpeg', p: '/fake/bundled/ffprobe', e: '1'
    });
    assert.equal(process.env.AKARI_FFMPEG_BIN, undefined);
    assert.equal(process.env.AKARI_FFPROBE_BIN, undefined);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
});

test('runNodeScript: 明示指定の AKARI_FFMPEG_BIN を resolver の結果で上書きしない', async t => {
    const explicit = '/user/selected/ffmpeg';
    const { root, script, service } = await fixture(t, { AKARI_FFMPEG_BIN: explicit });
    const result = await service.runNodeScript(script, [], root);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
        f: explicit, p: '/fake/bundled/ffprobe', e: '1'
    });
    assert.equal(process.env.AKARI_FFMPEG_BIN, explicit);
    assert.equal(process.env.AKARI_FFPROBE_BIN, undefined);
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined);
});
