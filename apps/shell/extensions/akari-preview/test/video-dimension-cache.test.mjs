import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AkariPreviewServiceImpl } from '../lib/node/akari-preview-service.js';

test('failed dimension probes retry and changed mtime invalidates successful results', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-dimensions-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'clip.mp4');
    await writeFile(path, 'video');
    const service = new AkariPreviewServiceImpl();
    let probes = 0;
    service.probeVideoDimensionsAtPath = async () => {
        probes++;
        return probes === 1 ? undefined : { width: probes, height: 540 };
    };
    const request = { videoUri: pathToFileURL(path).toString() };
    assert.equal(await service.probeVideoDimensions(request), undefined);
    assert.deepEqual(await service.probeVideoDimensions(request), { width: 2, height: 540 });
    assert.deepEqual(await service.probeVideoDimensions(request), { width: 2, height: 540 });
    assert.equal(probes, 2);
    const changed = new Date(Date.now() + 5000);
    await utimes(path, changed, changed);
    assert.deepEqual(await service.probeVideoDimensions(request), { width: 3, height: 540 });
    assert.equal(probes, 3);
});

test('stat failures are not cached', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'preview-dimensions-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const service = new AkariPreviewServiceImpl();
    let probes = 0;
    service.probeVideoDimensionsAtPath = async () => { probes++; return undefined; };
    const request = { videoUri: pathToFileURL(join(directory, 'missing.mp4')).toString() };
    await service.probeVideoDimensions(request);
    await service.probeVideoDimensions(request);
    assert.equal(probes, 2);
});
