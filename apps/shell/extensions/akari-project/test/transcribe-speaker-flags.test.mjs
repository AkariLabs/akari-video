import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AkariProjectServiceImpl, filterIdentifyPeople, identifyPersonIds, transcribeSpeakerArgs } from '../lib/node/akari-project-service.js';

test('ordinary CLI arguments stay unchanged', () => {
    assert.deepEqual(transcribeSpeakerArgs('assets/talk.mp4', 'auto', {}), ['transcribe', 'assets/talk.mp4']);
    assert.deepEqual(transcribeSpeakerArgs('assets/talk.mp4', 'whisper-cpp', {}),
        ['transcribe', 'assets/talk.mp4', '--backend', 'whisper-cpp']);
});

test('speaker CLI arguments follow the frozen flag order', () => {
    assert.deepEqual(transcribeSpeakerArgs('assets/talk.mp4', 'auto',
        { diarize: true, speakers: '2', identify: true }, 'people.json'),
        ['transcribe', 'assets/talk.mp4', '--diarize', '--speakers', '2', '--identify', '--people', 'people.json']);
    assert.deepEqual(transcribeSpeakerArgs('assets/talk.mp4', 'auto', { identify: true, speakers: 'auto' }),
        ['transcribe', 'assets/talk.mp4', '--diarize', '--identify']);
    assert.throws(() => transcribeSpeakerArgs('x', 'auto', { speakers: '5' }), /話者の指定が不正/);
});

test('selected people copy keeps unrelated root keys and selected person fields', () => {
    const raw = JSON.stringify({ schema: 'people/0', extra: 3, entries: [
        { kind: 'person', id: 'a', voice: { samples: [{ file: 'a.wav' }] } },
        { kind: 'avatar', id: 'b' }, { kind: 'person', id: 'c' }, { kind: 'object', id: 'a' }
    ] });
    const copy = JSON.parse(filterIdentifyPeople(raw, new Set(['a', 'b'])));
    assert.equal(copy.extra, 3);
    assert.deepEqual(copy.entries.map(row => row.id), ['a', 'b']);
    assert.equal(copy.entries[0].voice.samples[0].file, 'a.wav');
});

test('person ids accept a channel prefix and reject unsafe values', () => {
    assert.deepEqual(identifyPersonIds(['channel/p-one', 'p.two'], 'channel'), ['p-one', 'p.two']);
    assert.throws(() => identifyPersonIds(['../outside'], 'channel'), /人物の指定が不正/);
});

test('service sends speaker flags only to first engine and removes the filtered people copy', async t => {
    const base = await mkdtemp(join(tmpdir(), 'speaker-flags-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const channel = join(base, 'channels', 'demo');
    const project = join(channel, 'videos', 'clip');
    await mkdir(join(project, 'assets'), { recursive: true });
    await writeFile(join(project, 'assets', 'talk.wav'), 'fixture');
    await writeFile(join(channel, 'people.json'), JSON.stringify({ entries: [
        { kind: 'person', id: 'a', voice: { samples: [{ file: 'a.wav' }] } }, { kind: 'person', id: 'b' }
    ] }));
    class Service extends AkariProjectServiceImpl {
        calls = []; selected;
        async findMediaTool() { return 'media.mjs'; }
        async runNodeScript(_script, args) {
            this.calls.push(args);
            if (args.includes('--people')) this.selected = JSON.parse(await readFile(args[args.indexOf('--people') + 1], 'utf8'));
            return { code: 0, stdout: '', stderr: '' };
        }
    }
    const service = new Service();
    await service.transcribeMaterial({ projectRoot: project, relativePath: 'assets/talk.wav',
        compareSet: ['speech-analyzer', 'whisper-cpp'], diarize: true, speakers: '2', identify: true, people: ['demo/a'] });
    const first = service.calls.find(args => args.includes('speech-analyzer'));
    const second = service.calls.find(args => args.includes('whisper-cpp'));
    assert.deepEqual(first.slice(0, -2), ['transcribe', 'assets/talk.wav', '--backend', 'speech-analyzer',
        '--diarize', '--speakers', '2', '--identify']);
    assert.equal(first.at(-2), '--people');
    assert.deepEqual(second, ['transcribe', 'assets/talk.wav', '--backend', 'whisper-cpp']);
    assert.deepEqual(service.selected.entries.map(row => row.id), ['a']);
    assert.equal((await readdir(channel)).some(name => name.startsWith('.people-identify-')), false);
});
