import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { ReviewSessionWriter } from '../lib/node/review-session-writer.js';

async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'akari-review-session-writer-'));
    const editPath = join(root, 'edit.json');
    const editBytes = Buffer.from('{\n  "version": 0,\n  "cuts": []\n}\n', 'utf8');
    await writeFile(editPath, editBytes);
    const canonicalRoot = await realpath(root);
    return {
        root,
        editPath,
        editBytes,
        writer: new ReviewSessionWriter(async () => [canonicalRoot]),
        request: {
            projectRootUri: pathToFileURL(root).toString(),
            editUri: pathToFileURL(editPath).toString(),
            timelineT: 12.4,
            playing: false
        }
    };
}

test('records non-silent PCM in the four S1 files with a valid 16 kHz mono WAV and ordered trajectory', async () => {
    const { root, editBytes, writer, request } = await fixture();
    const started = await writer.start(request);
    const sessionPath = new URL(started.sessionDir);
    assert.equal(started.id, 's-0001');
    assert.deepEqual((await readdir(sessionPath)).sort(), [
        'audio.wav',
        'edit.snapshot.json',
        'events.jsonl'
    ]);
    assert.deepEqual(await readFile(new URL('edit.snapshot.json', `${started.sessionDir}/`)), editBytes);

    const oneSecondPcm = Buffer.alloc(16_000 * 2);
    for (let index = 0; index < 16_000; index += 1) {
        const sample = Math.round(Math.sin(2 * Math.PI * 440 * index / 16_000) * 0x3fff);
        oneSecondPcm.writeInt16LE(sample, index * 2);
    }
    await writer.appendAudio({
        sessionDir: started.sessionDir,
        pcmBase64: oneSecondPcm.toString('base64')
    });
    await writer.appendEvent({
        sessionDir: started.sessionDir,
        event: { recT: 0.5, type: 'play', timelineT: 12.4 }
    });
    await writer.appendEvent({
        sessionDir: started.sessionDir,
        event: { recT: 1.5, type: 'tick', timelineT: 13.4 }
    });
    await writer.appendEvent({
        sessionDir: started.sessionDir,
        event: { recT: 2, type: 'pause', timelineT: 13.9 }
    });
    await writer.appendEvent({
        sessionDir: started.sessionDir,
        event: { recT: 2.25, type: 'seek', from: 13.9, to: 42 }
    });
    await writer.appendEvent({
        sessionDir: started.sessionDir,
        event: { recT: 2.5, type: 'rate', value: 1.5 }
    });
    await writer.end({
        sessionDir: started.sessionDir,
        startedAt: started.startedAt,
        endedAt: new Date().toISOString(),
        editHash: started.editHash,
        recT: 3,
        timelineT: 42
    });

    assert.deepEqual((await readdir(sessionPath)).sort(), [
        'audio.wav',
        'edit.snapshot.json',
        'events.jsonl',
        'session.json'
    ]);
    const wav = await readFile(new URL('audio.wav', `${started.sessionDir}/`));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), oneSecondPcm.length);
    assert.equal(wav.length, 44 + oneSecondPcm.length);
    let maxAmplitude = 0;
    for (let offset = 44; offset < wav.length; offset += 2) {
        maxAmplitude = Math.max(maxAmplitude, Math.abs(wav.readInt16LE(offset)));
    }
    assert.ok(maxAmplitude > 0);

    const snapshot = await readFile(new URL('edit.snapshot.json', `${started.sessionDir}/`));
    const expectedHash = `sha256:${createHash('sha256').update(snapshot).digest('hex')}`;
    const manifest = JSON.parse(await readFile(new URL('session.json', `${started.sessionDir}/`), 'utf8'));
    assert.equal(manifest.editHash, expectedHash);
    assert.equal(manifest.status, 'recorded');
    assert.equal(manifest.compiledAnnotations, null);

    const events = (await readFile(new URL('events.jsonl', `${started.sessionDir}/`), 'utf8'))
        .trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(events.map(event => event.type), ['start', 'play', 'tick', 'pause', 'seek', 'rate', 'end']);
    assert.deepEqual(events.map(event => event.recT), [...events.map(event => event.recT)].sort((a, b) => a - b));
    assert.equal(events[0].recT, 0);

    const listed = await writer.list({ projectRootUri: pathToFileURL(root).toString() });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 's-0001');
    assert.equal(listed[0].durationSec, 1);
    assert.equal(listed[0].orphaned, false);
});

test('allocates after the greatest existing directory and never reuses a missing number', async () => {
    const { root, writer, request } = await fixture();
    await mkdir(join(root, 'review', 'sessions', 's-0007'), { recursive: true });
    await mkdir(join(root, 'review', 'sessions', 's-0012'), { recursive: true });
    const started = await writer.start(request);
    assert.equal(started.id, 's-0013');
});

test('creates strokes.json only on the first valid stroke and rejects invalid coordinates', async () => {
    const { writer, request } = await fixture();
    const started = await writer.start(request);
    const sessionPath = new URL(started.sessionDir);
    assert.equal((await readdir(sessionPath)).includes('strokes.json'), false);
    const stroke = {
        id: 'st-0001',
        tool: 'pen',
        space: 'content-rect',
        recTStart: 1.2,
        recTEnd: 1.8,
        frame: { timelineT: 12.4, sourceT: 42.5, cutIndex: 3 },
        points: [[0.1, 0.2], [0.5, 0.6], [0.9, 1]]
    };
    await writer.appendStroke({ sessionDir: started.sessionDir, stroke });
    const stored = JSON.parse(await readFile(new URL('strokes.json', `${started.sessionDir}/`), 'utf8'));
    assert.deepEqual(stored, { version: 1, strokes: [stroke] });
    await assert.rejects(
        () => writer.appendStroke({
            sessionDir: started.sessionDir,
            stroke: { ...stroke, id: 'bad', points: [[0, 0], [1.1, 1]] }
        }),
        /Invalid review session stroke/
    );
});

test('accepts a rect stroke (tool: rect, box: [x,y,w,h]) into the same strokes.json pipeline as pen', async () => {
    const { writer, request } = await fixture();
    const started = await writer.start(request);
    const stroke = {
        id: 'st-0001',
        tool: 'rect',
        space: 'content-rect',
        recTStart: 4.1,
        recTEnd: 4.6,
        frame: { timelineT: 12.4, sourceT: 42.5, cutIndex: 3 },
        box: [0.2, 0.3, 0.4, 0.5]
    };
    await writer.appendStroke({ sessionDir: started.sessionDir, stroke });
    const stored = JSON.parse(await readFile(new URL('strokes.json', `${started.sessionDir}/`), 'utf8'));
    assert.deepEqual(stored, { version: 1, strokes: [stroke] });
});

test('rejects a rect stroke whose box violates x+w<=1 / y+h<=1, or has a non-positive dimension', async () => {
    const { writer, request } = await fixture();
    const started = await writer.start(request);
    const base = {
        id: 'st-0001',
        tool: 'rect',
        space: 'content-rect',
        recTStart: 1,
        recTEnd: 2,
        frame: { timelineT: 0, sourceT: 0, cutIndex: null }
    };
    await assert.rejects(
        () => writer.appendStroke({ sessionDir: started.sessionDir, stroke: { ...base, box: [0.8, 0.1, 0.4, 0.2] } }),
        /Invalid review session stroke/
    );
    await assert.rejects(
        () => writer.appendStroke({ sessionDir: started.sessionDir, stroke: { ...base, box: [0.1, 0.8, 0.2, 0.4] } }),
        /Invalid review session stroke/
    );
    await assert.rejects(
        () => writer.appendStroke({ sessionDir: started.sessionDir, stroke: { ...base, box: [0.1, 0.1, 0, 0.2] } }),
        /Invalid review session stroke/
    );
    await assert.rejects(
        () => writer.appendStroke({ sessionDir: started.sessionDir, stroke: { ...base, box: [0.1, 0.1, 0.2] } }),
        /Invalid review session stroke/
    );
});

test('lists missing manifests as orphans and skips only a damaged manifest', async () => {
    const { root, writer } = await fixture();
    const sessions = join(root, 'review', 'sessions');
    await mkdir(join(sessions, 's-0001'), { recursive: true });
    await writeFile(join(sessions, 's-0001', 'session.json'), '{broken');
    await mkdir(join(sessions, 's-0002'), { recursive: true });
    const previousWarn = console.warn;
    console.warn = () => undefined;
    try {
        const listed = await writer.list({ projectRootUri: pathToFileURL(root).toString() });
        assert.deepEqual(listed.map(session => session.id), ['s-0002']);
        assert.equal(listed[0].orphaned, true);
    } finally {
        console.warn = previousWarn;
    }
});

test('rejects project roots outside the current workspace', async () => {
    const { root, request } = await fixture();
    const otherRoot = await mkdtemp(join(tmpdir(), 'akari-review-session-outside-'));
    const writer = new ReviewSessionWriter(async () => [await realpath(otherRoot)]);
    await assert.rejects(() => writer.start(request), /inside the current workspace/);
    assert.ok(root);
});
