import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'akari-preview-workspace-roots-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const a = join(base, 'a');
    const b = join(base, 'b');
    const c = join(base, 'c');
    const outside = join(base, 'outside');
    await Promise.all([
        mkdir(join(a, 'assets'), { recursive: true }),
        mkdir(join(b, 'assets'), { recursive: true }),
        mkdir(join(c, 'assets'), { recursive: true }),
        mkdir(outside, { recursive: true })
    ]);
    const paths = {
        aVideo: join(a, 'assets', 'a.mp4'),
        aImage: join(a, 'assets', 'a.png'),
        aAudio: join(a, 'assets', 'a.wav'),
        cVideo: join(c, 'assets', 'c.mp4'),
        cImage: join(c, 'assets', 'c.png'),
        cAudio: join(c, 'assets', 'c.wav'),
        outsideVideo: join(outside, 'real.mp4')
    };
    await Promise.all([
        writeFile(paths.aVideo, 'video-a'),
        writeFile(paths.aImage, 'image-a'),
        writeFile(paths.aAudio, 'audio-a'),
        writeFile(paths.cVideo, 'video-c'),
        writeFile(paths.cImage, 'image-c'),
        writeFile(paths.cAudio, 'audio-c'),
        writeFile(paths.outsideVideo, 'outside-video')
    ]);
    return {
        a,
        b,
        c,
        paths,
        canonicalA: await realpath(a),
        canonicalB: await realpath(b)
    };
}

function serviceFor({ a, b }) {
    const service = new AkariPreviewServiceImpl();
    let recentCalls = 0;
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => pathToFileURL(b).toString(),
        getRecentWorkspaces: async () => {
            recentCalls += 1;
            return [pathToFileURL(b).toString(), pathToFileURL(a).toString()];
        }
    };
    return { service, recentCalls: () => recentCalls };
}

test('(a) a non-MRU window streams against its requested workspace root', async t => {
    const data = await fixture(t);
    const { service, recentCalls } = serviceFor(data);
    const target = await service.resolveVideoStreamTarget({
        videoUri: pathToFileURL(data.paths.aVideo).toString(),
        workspaceRoots: [pathToFileURL(data.a).toString()]
    });
    assert.equal(target.path, await realpath(data.paths.aVideo));
    assert.deepEqual(target.workspaceRoots, [data.canonicalA]);

    const callsBeforeFallback = recentCalls();
    await assert.rejects(service.resolveVideoStreamTarget({
        videoUri: pathToFileURL(data.paths.aVideo).toString()
    }), /Video files outside the workspace cannot be streamed/u);
    assert.equal(recentCalls(), callsBeforeFallback);
});

test('(b) a requested root absent from the workspace ledger is rejected', async t => {
    const data = await fixture(t);
    const { service } = serviceFor(data);
    await assert.rejects(service.resolveVideoStreamTarget({
        videoUri: pathToFileURL(data.paths.cVideo).toString(),
        workspaceRoots: [pathToFileURL(data.c).toString()]
    }), /The requested workspace root is not an open workspace/u);
});

test('(c) a stream target cannot escape a requested root through a symbolic link', async t => {
    const data = await fixture(t);
    const escape = join(data.a, 'assets', 'escape.mp4');
    await symlink(data.paths.outsideVideo, escape);
    const { service } = serviceFor(data);
    await assert.rejects(service.resolveVideoStreamTarget({
        videoUri: pathToFileURL(escape).toString(),
        workspaceRoots: [pathToFileURL(data.a).toString()]
    }), /Video files outside the workspace cannot be streamed/u);
});

test('(d) a requested root is canonicalized before ledger comparison', async t => {
    const data = await fixture(t);
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => pathToFileURL(data.canonicalB).toString(),
        getRecentWorkspaces: async () => [
            pathToFileURL(data.canonicalB).toString(),
            pathToFileURL(data.canonicalA).toString()
        ]
    };
    const target = await service.resolveVideoStreamTarget({
        videoUri: pathToFileURL(data.paths.aVideo).toString(),
        workspaceRoots: [pathToFileURL(data.a).toString()]
    });
    assert.deepEqual(target.workspaceRoots, [data.canonicalA]);
});

test('(e) asset streaming and audio transcoding use the requested-root boundary', async t => {
    const data = await fixture(t);
    const { service } = serviceFor(data);
    const asset = await service.resolveAssetStreamTarget({
        assetUri: pathToFileURL(data.paths.aImage).toString(),
        workspaceRoots: [pathToFileURL(data.a).toString()]
    });
    assert.equal(asset.path, await realpath(data.paths.aImage));
    await assert.rejects(service.resolveAssetStreamTarget({
        assetUri: pathToFileURL(data.paths.cImage).toString(),
        workspaceRoots: [pathToFileURL(data.c).toString()]
    }), /The requested workspace root is not an open workspace/u);

    let transcodeCalls = 0;
    service.runAudioTranscode = async (_input, output) => {
        transcodeCalls += 1;
        await writeFile(output, 'wav-output');
        return undefined;
    };
    service.ensureServer = async () => 43123;
    const transcoded = await service.transcodeAudioToWav({
        audioUri: pathToFileURL(data.paths.aAudio).toString(),
        workspaceRoots: [pathToFileURL(data.a).toString()]
    });
    assert.equal(transcoded.ok, true);
    assert.equal(transcodeCalls, 1);
    if (transcoded.ok) {
        await service.disposeTranscodedAudioStream(transcoded.stream.id);
    }
    assert.deepEqual(await service.transcodeAudioToWav({
        audioUri: pathToFileURL(data.paths.cAudio).toString(),
        workspaceRoots: [pathToFileURL(data.c).toString()]
    }), { ok: false, error: 'transcode-failed' });
    assert.equal(transcodeCalls, 1);
});

test('(f) review sessions accept a non-MRU root present in the workspace ledger', async t => {
    const data = await fixture(t);
    const { service } = serviceFor(data);
    const resolved = await service.reviewSessionWriter.resolveProjectRoot(pathToFileURL(data.a).toString());
    assert.equal(resolved, data.canonicalA);
});
