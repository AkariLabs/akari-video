import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { VoiceRecordingWriter } from '../lib/node/voice-recording-writer.js';

const tempRoot = resolve(process.cwd(), '../../../../.tmp-lane');
let project;
before(async () => {
    await fs.mkdir(tempRoot, { recursive: true });
    project = await fs.mkdtemp(join(tempRoot, 'voice-writer-'));
});
after(async () => { await fs.rm(project, { recursive: true, force: true }); });

const pcm = samples => Buffer.alloc(samples * 2).toString('base64');

test('header, appended sizes, duration and audio-added event', async () => {
    const writer = new VoiceRecordingWriter();
    const started = await writer.start(project);
    const wavPath = join(project, started.relativePath);
    const header = await fs.readFile(wavPath);
    assert.equal(header.length, 44);
    assert.equal(header.toString('ascii', 0, 4), 'RIFF');
    assert.equal(header.readUInt16LE(22), 1);
    assert.equal(header.readUInt32LE(24), 48000);
    assert.equal(header.readUInt16LE(34), 16);
    await writer.append({ recordingId: started.recordingId, pcmBase64: pcm(24000) });
    await writer.append({ recordingId: started.recordingId, pcmBase64: pcm(24000) });
    const wav = await fs.readFile(wavPath);
    assert.equal(wav.readUInt32LE(40), 96000);
    assert.equal(wav.readUInt32LE(4), 96036);
    const finished = await writer.finish({ recordingId: started.recordingId });
    assert.equal(finished.durationSec, 1);
    assert.equal(finished.assetPath, started.relativePath);
    const event = JSON.parse(await fs.readFile(new URL(finished.eventUri), 'utf8'));
    assert.equal(event.type, 'audio-added');
    assert.equal(event.source, 'microphone');
    assert.equal(event.asset, started.relativePath);
    assert.equal(event.copied, false);
});

test('short and discarded takes are removed', async () => {
    const writer = new VoiceRecordingWriter();
    const short = await writer.start(project);
    await writer.append({ recordingId: short.recordingId, pcmBase64: pcm(23999) });
    assert.equal(await writer.finish({ recordingId: short.recordingId }), undefined);
    await assert.rejects(fs.stat(join(project, short.relativePath)));
    const discarded = await writer.start(project);
    await writer.append({ recordingId: discarded.recordingId, pcmBase64: pcm(48000) });
    assert.equal(await writer.finish({ recordingId: discarded.recordingId, discard: true }), undefined);
    await assert.rejects(fs.stat(join(project, discarded.relativePath)));
});

test('unknown IDs reject and name collisions get -2', async () => {
    const writer = new VoiceRecordingWriter();
    await assert.rejects(writer.append({ recordingId: 'missing', pcmBase64: pcm(1) }));
    await assert.rejects(writer.finish({ recordingId: 'missing' }));
    const collisionProject = join(project, 'collision');
    await fs.mkdir(collisionProject);
    const first = await writer.start(collisionProject);
    const second = await writer.start(collisionProject);
    assert.match(second.relativePath, /-2\.wav$/);
    await writer.finish({ recordingId: first.recordingId, discard: true });
    await writer.finish({ recordingId: second.recordingId, discard: true });
});
