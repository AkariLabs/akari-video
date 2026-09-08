import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
test('selection changes only on; concurrent selection RPCs retain both changes', async t => {
    const { service, request, directory, cuts } = await fixture(t);
    await Promise.all([service.writeCutsSelection({ ...request, on: { 'c-1': false } }), service.writeCutsSelection({ ...request, on: { 'c-2': true } })]);
    const actual = JSON.parse(await readFile(join(directory, 'cuts.json'), 'utf8'));
    cuts.candidates[0].on = false; cuts.candidates[1].on = true;
    assert.deepEqual(actual, cuts);
    await assert.rejects(service.writeCutsSelection({ ...request, on: { 'c-1': 1 } }), /真偽値/);
});
test('apply adds cut boundaries, retains other sources, preserves captions bytes and is idempotent', async t => {
    const { service, request, root } = await fixture(t);
    const before = await readFile(join(root, 'captions.json'));
    assert.deepEqual(await service.applyCutsToEdit(request), { changed: true });
    const edit = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.deepEqual(edit.cuts, [{ src: 'voice', in: 0, out: 2 }, { src: 'voice', in: 3, out: 10 }, { src: 'other', in: 0, out: 10, speed: 2 }]);
    assert.deepEqual(await readFile(join(root, 'captions.json')), before);
    assert.deepEqual(await service.applyCutsToEdit(request), { changed: false });
});
test('v2 keeps schema vocabulary and other source items; same range is not applied twice', async t => {
    const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [{ id: 'voice', path: 'assets/voice.wav' }],
        tracks: [{ id: 'video', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 300, source: { kind: 'media', src: 'voice', in: 0, out: 10 } }] }] };
    const { service, request, root } = await fixture(t, edit);
    const before = await readFile(join(root, 'captions.json'));
    assert.equal((await service.applyCutsToEdit(request)).changed, true);
    const after = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.equal(after.tracks[0].items.length, 2);
    assert.equal(after.tracks[0].items.reduce((sum, item) => sum + item.duration, 0), 270);
    assert.equal('cuts' in after, false);
    assert.equal((await service.applyCutsToEdit(request)).changed, false);
    assert.deepEqual(await readFile(join(root, 'captions.json')), before);
});
test('invalid edit is refused before rename', async t => {
    const { service, request, root } = await fixture(t, { version: 1, sources: [{ id: 'voice', path: 'assets/voice.wav' }], cuts: [{ src: 'voice', in: 0, out: 10 }] });
    const before = await readFile(join(root, 'edit.json'));
    await assert.rejects(service.applyCutsToEdit(request));
    assert.deepEqual(await readFile(join(root, 'edit.json')), before);
});
test('artifact read excludes archives and rejects escaped material paths', async t => {
    const { service, request, directory } = await fixture(t);
    const transcript = { backend: 'whisper-cpp', generated_at: 'now', elapsed_sec: 1, cost_usd: null, segments: [] };
    await writeFile(join(directory, 'transcripts/whisper-cpp.json'), JSON.stringify(transcript));
    await writeFile(join(directory, 'transcripts/whisper-cpp.old.json'), JSON.stringify({ ...transcript, generated_at: 'old' }));
    assert.deepEqual((await service.readTranscribeArtifacts(request)).transcripts, [transcript]);
    await assert.rejects(service.readTranscribeArtifacts({ ...request, relativePath: '../outside' }));
});
test('sidecar symlinks outside project are refused', async t => {
    const { service, request, directory } = await fixture(t);
    const outside = await mkdtemp(join(tmpdir(), 'outside-cuts-')); t.after(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, 'cuts.json'), '{}'); await rm(join(directory, 'cuts.json'));
    await symlink(join(outside, 'cuts.json'), join(directory, 'cuts.json'));
    await assert.rejects(service.writeCutsSelection({ ...request, on: {} }), /プロジェクト外/);
});
test('buildCaptions forwards session options without changing caption CLI arguments', async t => {
    const { service, root } = await fixture(t);
    let passed;
    service.transcribeMaterial = async request => { passed = request; };
    await service.buildCaptions({ projectRoot: root, source: 'voice', transcribeFirst: true, backend: 'whisper-cpp', compareSet: ['whisper-cpp'], autoCuts: true, approved: true });
    assert.deepEqual(passed, { projectRoot: await import('node:fs/promises').then(fs => fs.realpath(root)), relativePath: 'assets/voice.wav', backend: 'whisper-cpp', compareSet: ['whisper-cpp'], autoCuts: true, approved: true });
    assert.deepEqual(service.calls[0].args.slice(1), ['--source', 'voice']);
});
test('subsecond legacy candidates add exact boundaries without expanding to nearby edges', async t => {
    const { service, request, directory, root } = await fixture(t);
    const cuts = JSON.parse(await readFile(join(directory, 'cuts.json'), 'utf8'));
    cuts.candidates[0].start = .1; cuts.candidates[0].end = .2;
    await writeFile(join(directory, 'cuts.json'), JSON.stringify(cuts));
    await service.applyCutsToEdit(request);
    const edit = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.deepEqual(edit.cuts.slice(0, 2), [{ src: 'voice', in: 0, out: .1 }, { src: 'voice', in: .2, out: 10 }]);
});
test('implicit full-source timeline receives explicit keep ranges without changing captions', async t => {
    const { service, request, root } = await fixture(t, { version: 1, output: { width: 1920, height: 1080, fps: 30 }, sources: [{ id: 'voice', path: 'assets/voice.wav', proxy: null }] });
    service.runNodeScript = async (_script, args) => { assert.equal(args[0], 'probe'); return { code: 0, stdout: '{"duration_s":10}', stderr: '' }; };
    await service.applyCutsToEdit(request);
    const edit = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.deepEqual(edit.cuts, [{ src: 'voice', in: 0, out: 2 }, { src: 'voice', in: 3, out: 10 }]);
});
test('v2 never falls back to another source after removing the last item of the chosen source', async t => {
    const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [{ id: 'voice', path: 'assets/voice.wav' }, { id: 'other', path: 'assets/other.wav' }],
        tracks: [{ id: 'video', lane: 'visual', items: [{ id: 'clip', at: 0, duration: 30, source: { kind: 'media', src: 'voice', in: 2, out: 3 } }, { id: 'other-clip', at: 30, duration: 300, source: { kind: 'media', src: 'other', in: 0, out: 10 } }] }] };
    const { service, request, root } = await fixture(t, edit);
    await service.writeCutsSelection({ ...request, on: { 'c-2': true } });
    await service.applyCutsToEdit(request);
    const after = JSON.parse(await readFile(join(root, 'edit.json'), 'utf8'));
    assert.equal(after.tracks[0].items.length, 1);
    assert.deepEqual(after.tracks[0].items[0].source, edit.tracks[0].items[1].source);
    assert.equal(after.tracks[0].items[0].duration, 300);
});
