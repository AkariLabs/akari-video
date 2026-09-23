import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

class TrackedService extends AkariAnnotationsServiceImpl {
    writes = 0;
    async writeProjectFileGuarded(file, text) {
        this.writes++;
        await writeFile(file, text);
    }
}

test('applyNarrations は複数件と置き換えを edit.json へ 1 回で書く', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'akari-read-aloud-'));
    try {
        const audioDir = path.join(root, 'out', 'narration');
        await mkdir(audioDir, { recursive: true });
        for (const id of ['n-0001', 'n-0002', 'n-0003']) await writeFile(path.join(audioDir, `${id}.wav`), 'RIFF');
        await writeFile(path.join(root, 'edit.json'), JSON.stringify({ version: 2, tracks: [], audio: { narration: [
            { id: 'n-0001', path: 'out/narration/n-0001.wav', t: 0, script: '旧', caption_ref: 'c-0001' }
        ] } }));
        const service = new TrackedService();
        const projectRootUri = pathToFileURL(root).href;
        const items = ['n-0002', 'n-0003'].map((id, index) => ({ id, path: `out/narration/${id}.wav`,
            t: index, script: `新${index}`, reading: `新${index}`, captionRef: `c-000${index + 1}` }));
        assert.deepEqual(await service.applyNarrations({ projectRootUri, items, replaceIds: ['n-0001'] }),
            { ids: ['n-0002', 'n-0003'] });
        assert.equal(service.writes, 1);
        const edit = JSON.parse(await readFile(path.join(root, 'edit.json'), 'utf8'));
        assert.deepEqual(edit.audio.narration.map(item => item.id), ['n-0002', 'n-0003']);
        assert.deepEqual(edit.audio.narration.map(item => item.caption_ref), ['c-0001', 'c-0002']);
        assert.equal(edit.tracks.filter(track => track.lane === 'audio').length, 1);
        await assert.rejects(service.applyNarrations({ projectRootUri, items, replaceIds: ['missing'] }), /置き換え元/);
        assert.equal(service.writes, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
});
