import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');

async function fixture(t) {
    const base = await mkdtemp(join(tmpdir(), 'akari-preview-audio-roots-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const a = join(base, 'a');
    const b = join(base, 'b');
    const unknown = join(base, 'unknown');
    await Promise.all([mkdir(a), mkdir(b), mkdir(unknown)]);
    const source = join(a, 'speech.wav');
    await writeFile(source, 'short audio fixture');
    const uri = path => pathToFileURL(path).href;
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => uri(b),
        getRecentWorkspaces: async () => [uri(b), uri(a)]
    };
    service.loadSpeechAtempoModule = async () => assert.fail('short WAV must stop before media-bin');
    const request = { sourceUri: uri(source), projectRootUri: uri(a), inSec: 0,
        speed: 1, heavyWavOnly: true };
    return { service, request, roots: [uri(a)], unknownRoots: [uri(unknown)] };
}

test('audio sidecar accepts window A roots while window B is most recent', async t => {
    const { service, request, roots } = await fixture(t);
    assert.deepEqual(await service.requestPreviewAudioSidecar({ ...request, workspaceRoots: roots }),
        { state: 'not-eligible' });
});

test('audio sidecar rejects roots absent from the open workspace ledger', async t => {
    const { service, request, unknownRoots } = await fixture(t);
    const result = await service.requestPreviewAudioSidecar({ ...request, workspaceRoots: unknownRoots });
    assert.equal(result.state, 'unavailable');
    assert.match(result.reason, /The requested workspace root is not an open workspace/u);
});

test('audio sidecar without roots keeps the legacy most-recent-workspace behavior', async t => {
    const { service, request } = await fixture(t);
    const result = await service.requestPreviewAudioSidecar(request);
    assert.equal(result.state, 'unavailable');
    assert.match(result.reason, /Preview audio sidecar paths must stay inside an open workspace/u);
});
