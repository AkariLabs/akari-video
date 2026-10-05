import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test, mock } from 'node:test';
import { setupFixtureEnv } from './helpers.mjs';

test('validator runs in process, preserves globals, and serializes mixed results', async () => {
    const good = setupFixtureEnv();
    const bad = setupFixtureEnv();
    const metaPath = path.join(bad.baseDir, 'still', 'mini-still', 'v1', 'meta.json');
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.source = { image: 'legacy-source' };
    const buffer = Buffer.from(JSON.stringify(meta));
    writeFileSync(metaPath, buffer);
    bad.catalog.items[0].files[0].sha256 = createHash('sha256').update(buffer).digest('hex');
    bad.catalog.items[0].files[0].bytes = buffer.length;
    writeFileSync(bad.catalogPath, JSON.stringify(bad.catalog));

    const original = {
        exit: process.exit, argv: process.argv, exitCode: process.exitCode,
        log: console.log, error: console.error,
    };
    let spawns = 0;
    const spy = mock.method(childProcess, 'spawnSync', () => { spawns++; throw new Error('child process launched'); });
    syncBuiltinESMExports();
    try {
        const { resolve } = await import('../src/resolve.mjs?in-process-test');
        const [passed, failed] = await Promise.allSettled([
            resolve('mini-still', { env: good.env }),
            resolve('mini-still', { env: bad.env }),
        ]);
        assert.equal(passed.status, 'fulfilled');
        assert.equal(failed.status, 'rejected');
        assert.equal(failed.reason.code, 'validation');
        assert.match(failed.reason.message, /^validate-asset /);
        assert.match(failed.reason.message, /NG: /);
        // origin/main の source union（c4e49f5ad）では image だけの source は akari-r2 扱いになり、preview の欠落で落ちる
        assert.match(failed.reason.message, /source\.preview/);
        assert.equal(spawns, 0);
        assert.equal(process.exit, original.exit);
        assert.equal(process.argv, original.argv);
        assert.equal(process.exitCode, original.exitCode);
        assert.equal(console.log, original.log);
        assert.equal(console.error, original.error);
    } finally {
        spy.mock.restore();
        syncBuiltinESMExports();
    }
});
