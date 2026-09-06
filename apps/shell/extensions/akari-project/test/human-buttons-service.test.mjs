import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

class Service extends AkariProjectServiceImpl {
    calls = [];
    async findMediaTool(kind) { return `${kind}.mjs`; }
    async runNodeScript(script, args, cwd) {
        this.calls.push({ script, args, cwd });
        if (script === 'media.mjs') await this.waitForMedia;
        return { code: 0, stdout: '{"captions":2}\n', stderr: '' };
    }
}
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'human-buttons-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/voice.wav'), 'fixture');
    await writeFile(join(root, 'edit.json'), JSON.stringify({ version: 2, sources: [{ id: 'voice', path: 'assets/voice.wav' }] }));
    return { root, service: new Service() };
}
test('発話配列の長さで状態を判定し、実行中を優先して二重起動を拒否する', async t => {
    const { root, service } = await fixture(t);
    const query = { projectRoot: root, relativePaths: ['assets/voice.wav'] };
    const state = async () => (await service.transcriptStates(query))['assets/voice.wav'];
    assert.equal(await state(), 'none');
    const directory = join(root, '.akari/sidecars/assets/voice.wav.analysis');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'analysis.json'), '{"transcript":[]}');
    assert.equal(await state(), 'none');
    await writeFile(join(directory, 'analysis.json'), '{"transcript":[{}]}');
    assert.equal(await state(), 'done');
    let release;
    service.waitForMedia = new Promise(resolve => { release = resolve; });
    const running = service.transcribeMaterial({ projectRoot: root, relativePath: 'assets/voice.wav' });
    while (!service.calls.length) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(await state(), 'running');
    await assert.rejects(service.transcribeMaterial({ projectRoot: root, relativePath: 'assets/voice.wav' }), /実行中/);
    release();
    await running;
    assert.equal(await state(), 'done');
    assert.equal((await readdir(join(root, '.akari/events'))).length, 2);
});
test('連続実行では素材処理の後に字幕を生成し、素材 ID と上書き指定を渡す', async t => {
    const { root, service } = await fixture(t);
    assert.deepEqual(await service.buildCaptions({ projectRoot: root, source: 'voice', force: true, transcribeFirst: true }), { captions: 2 });
    assert.deepEqual(service.calls.map(call => [call.script, call.args]), [
        ['media.mjs', ['transcribe', 'assets/voice.wav']],
        ['captions.mjs', [service.calls[1].cwd, '--source', 'voice', '--force']]
    ]);
    assert.equal(service.calls[0].cwd, service.calls[1].cwd);
});
test('素材処理に失敗すると字幕生成を停止して実行中状態を解除する', async t => {
    const { root, service } = await fixture(t);
    service.runNodeScript = async () => ({ code: 1, stdout: '', stderr: 'media failed' });
    await assert.rejects(service.buildCaptions({ projectRoot: root, transcribeFirst: true }), /media failed/);
    assert.deepEqual(await service.transcriptStates({ projectRoot: root, relativePaths: ['assets/voice.wav'] }), { 'assets/voice.wav': 'none' });
    assert.equal((await readdir(join(root, '.akari/events'))).length, 2);
});
