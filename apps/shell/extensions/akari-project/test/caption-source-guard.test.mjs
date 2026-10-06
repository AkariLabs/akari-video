import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class Service extends AkariProjectServiceImpl {
    calls = 0;
    async findMediaTool() { this.calls++; return 'captions.mjs'; }
    async runNodeScript() { this.calls++; return { code: 0, stdout: '', stderr: '' }; }
}

test('画像と書き出し素材は両入口で CLI を起動する前に止まる', async t => {
    const root = await mkdtemp(join(tmpdir(), 'caption-source-guard-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const service = new Service();
    for (const [id, path, reason] of [
        ['image', 'thumb.png', /画像には音声がありません/u],
        ['export', 'exports/master.mp4', /書き出した完成品です/u],
        ['text', 'notes.txt', /音声・動画のファイルではありません/u]
    ]) {
        await writeFile(join(root, 'edit.json'), JSON.stringify({ sources: [{ id, path }] }));
        await assert.rejects(service.transcribeMaterial({ projectRoot: root, relativePath: path }), reason);
        await assert.rejects(service.buildCaptions({ projectRoot: root, source: id }), reason);
    }
    assert.equal(service.calls, 0);
});
