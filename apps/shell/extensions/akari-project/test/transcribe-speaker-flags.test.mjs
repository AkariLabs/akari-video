import test, { afterEach, beforeEach } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
beforeEach(() => setLanguage('ja'));
afterEach(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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

async function createSpeakerService(t) {
    const scratch = join(process.cwd(), '.tmp-lane');
    const created = await mkdir(scratch, { recursive: true });
    const base = await mkdtemp(join(scratch, 'speaker-flags-'));
    t.after(async () => {
        await rm(base, { recursive: true, force: true });
        if (created) await rmdir(scratch).catch(error => {
            if (error.code !== 'ENOTEMPTY') throw error;
        });
    });
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
    return { service: new Service(), channel, project };
}

test('話者分けとエンジン比較の併用を起動前に拒否する', async t => {
    const { service, project } = await createSpeakerService(t);
    await assert.rejects(service.transcribeMaterial({ projectRoot: project, relativePath: 'assets/talk.wav',
        compareSet: ['speech-analyzer', 'whisper-cpp'], diarize: true
    }), /話者を分けるときはエンジンを比較できません/);
    assert.deepEqual(service.calls, []);
});

test('単一エンジンへ話者指定を渡し、絞り込んだ人物の一時コピーを消す', async t => {
    const { service, channel, project } = await createSpeakerService(t);
    await service.transcribeMaterial({ projectRoot: project, relativePath: 'assets/talk.wav',
        backend: 'speech-analyzer', diarize: true, speakers: '2', identify: true, people: ['demo/a'] });
    assert.equal(service.calls.length, 1);
    const [args] = service.calls;
    assert.deepEqual(args.slice(0, -1), ['transcribe', 'assets/talk.wav', '--backend', 'speech-analyzer',
        '--diarize', '--speakers', '2', '--identify', '--people']);
    assert.equal(dirname(args.at(-1)), channel);
    assert.match(basename(args.at(-1)), /^\.people-identify-/);
    assert.deepEqual(service.selected.entries.map(row => row.id), ['a']);
    assert.equal((await readdir(channel)).some(name => name.startsWith('.people-identify-')), false);
});
