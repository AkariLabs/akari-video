import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AkariProjectServiceImpl } from '../lib/node/akari-project-service.js';

const mediaCli = fileURLToPath(new URL('../../../../../packages/akari-tools/bin/media.mjs', import.meta.url));
class Service extends AkariProjectServiceImpl {
    calls = []; releases = new Map();
    async findMediaTool(kind) { return kind === 'media' ? mediaCli : 'captions.mjs'; }
    async runNodeScript(script, args, cwd) {
        this.calls.push({ script, args, cwd });
        if (args[0] === 'transcribe') {
            const backend = args[args.indexOf('--backend') + 1];
            await new Promise(resolve => this.releases.set(backend, resolve));
            const segments = [{ start: 0, end: 10, text: backend }];
            const directory = join(cwd, '.akari/sidecars/assets/voice.wav.analysis');
            await writeFile(join(directory, `transcripts/${backend}.json`), JSON.stringify({ backend, generated_at: new Date().toISOString(), elapsed_sec: 1, cost_usd: null, segments }));
            await writeFile(join(directory, 'analysis.json'), JSON.stringify({ transcript: segments }));
            return { code: 0, stdout: JSON.stringify({ segments }), stderr: '' };
        }
        return { code: 0, stdout: '{"captions":2}', stderr: '' };
    }
}
async function fixture(t, edit) {
    const root = await mkdtemp(join(tmpdir(), 'transcribe-compare-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'assets/voice.wav'), 'fixture');
    const directory = join(root, '.akari/sidecars/assets/voice.wav.analysis');
    await mkdir(join(directory, 'transcripts'), { recursive: true });
    const cuts = { version: 1, generated_at: 'fixed', basis: 'whisper-cpp', rules: { silence_keep_sec: .5 },
        candidates: [{ id: 'c-1', kind: 'filler', start: 2, end: 3, text: 'えー', on: true, default_on: true, reason: 'filler', timing: 'estimated' },
            { id: 'c-2', kind: 'silence', start: 5, end: 6, text: null, on: false, default_on: false, reason: 'silence' }],
        hand_edited: [{ candidate: 'c-2', line: 3 }] };
    await writeFile(join(directory, 'cuts.json'), JSON.stringify(cuts));
    await writeFile(join(root, 'edit.json'), JSON.stringify(edit ?? { version: 1, output: { width: 1920, height: 1080, fps: 30 },
        sources: [{ id: 'voice', path: 'assets/voice.wav', proxy: null }, { id: 'other', path: 'assets/other.wav', proxy: null }],
        cuts: [{ src: 'voice', in: 0, out: 10 }, { src: 'other', in: 0, out: 10, speed: 2 }] }));
    await writeFile(join(root, 'captions.json'), ' {"captions": [{"text":"人の台本"}]}\r\n');
    return { root, directory, service: new Service(), cuts, request: { projectRoot: root, relativePath: 'assets/voice.wav' } };
}
async function until(condition) { for (let i = 0; i < 500; i++) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('timeout'); }
async function events(root) {
    const path = join(root, '.akari/events');
    return Promise.all((await readdir(path)).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(path, name), 'utf8'))));
}

test('two backends start concurrently, publish each completion, then diff and cuts; baseline is selection[0]', async t => {
    const { service, request, root, directory } = await fixture(t);
    const running = service.transcribeMaterial({ ...request, compareSet: ['speech-analyzer', 'whisper-cpp'], autoCuts: true });
    await until(() => service.releases.size === 2);
    assert.deepEqual(service.calls.map(call => call.args).sort((a, b) => a[3].localeCompare(b[3])), [
        ['transcribe', 'assets/voice.wav', '--backend', 'speech-analyzer'], ['transcribe', 'assets/voice.wav', '--backend', 'whisper-cpp']]);
    service.releases.get('speech-analyzer')();
    await until(async () => (await events(root)).some(event => event.backend === 'speech-analyzer' && event.status === 'completed'));
    assert.equal(service.calls.length, 2, 'diff must wait for both engines');
    service.releases.get('whisper-cpp')();
    await running;
    assert.deepEqual(service.calls.slice(2).map(call => call.args), [
        ['transcribe-diff', 'assets/voice.wav', '--engines', 'speech-analyzer,whisper-cpp'], ['transcribe-cuts', 'assets/voice.wav']]);
    assert.deepEqual((await events(root)).filter(event => event.backend && event.status === 'completed').map(event => event.backend).sort(), ['speech-analyzer', 'whisper-cpp']);
    assert.equal(JSON.parse(await readFile(join(directory, 'analysis.json'), 'utf8')).transcript[0].text, 'speech-analyzer');
});
test('unapproved cloud engine fails alone and local engine continues; no cloud spawn', async t => {
    const { service, request, root } = await fixture(t);
    const running = service.transcribeMaterial({ ...request, compareSet: ['whisper-cpp', 'cloud:scribe'], autoCuts: true });
    const rejected = assert.rejects(running, /承認/);
    await until(() => service.releases.has('whisper-cpp')); service.releases.get('whisper-cpp')(); await rejected;
    assert.equal(service.calls.some(call => call.args.includes('cloud:scribe')), false);
    assert.equal(service.calls.some(call => call.args[0] === 'transcribe-cuts'), true);
    assert.ok((await events(root)).some(event => event.backend === 'cloud:scribe' && event.stage === 'failed'));
});
test('artifact read excludes archives and rejects escaped material paths', async t => {
    const { service, request, directory } = await fixture(t);
    const transcript = { backend: 'whisper-cpp', generated_at: 'now', elapsed_sec: 1, cost_usd: null, segments: [] };
    await writeFile(join(directory, 'transcripts/whisper-cpp.json'), JSON.stringify(transcript));
    await writeFile(join(directory, 'transcripts/whisper-cpp.old.json'), JSON.stringify({ ...transcript, generated_at: 'old' }));
    assert.deepEqual((await service.readTranscribeArtifacts(request)).transcripts, [transcript]);
    await assert.rejects(service.readTranscribeArtifacts({ ...request, relativePath: '../outside' }));
});
test('buildCaptions forwards session options without changing caption CLI arguments', async t => {
    const { service, root } = await fixture(t);
    let passed;
    service.transcribeMaterial = async request => { passed = request; };
    await service.buildCaptions({ projectRoot: root, source: 'voice', transcribeFirst: true, backend: 'whisper-cpp', compareSet: ['whisper-cpp'], autoCuts: true, approved: true });
    assert.deepEqual(passed, { projectRoot: await import('node:fs/promises').then(fs => fs.realpath(root)), relativePath: 'assets/voice.wav', backend: 'whisper-cpp', compareSet: ['whisper-cpp'], autoCuts: true, approved: true });
    assert.deepEqual(service.calls[0].args.slice(1), ['--source', 'voice']);
});
