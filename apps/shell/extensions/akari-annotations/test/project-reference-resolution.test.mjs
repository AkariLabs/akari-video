import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { recordProjectReference } from '../../../../../packages/asset-resolver/src/project-references.mjs';

test('annotations RPC の解決済み音声で実尺と波形を取得できる', async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'annotations-reference-')));
    const env = { AKARI_HOME: join(root, 'home'), AKARI_LIBRARY_ROOT: join(root, 'library'), AKARI_CREATOR_ROOT: join(root, 'creator') };
    const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    Object.assign(process.env, env);
    t.after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(root, { recursive: true, force: true }); });
    const project = join(root, 'project'), directory = join(env.AKARI_LIBRARY_ROOT, 'audio', 'sound');
    await mkdir(project); await mkdir(directory, { recursive: true });
    const pcm = Buffer.alloc(16000 * 2);
    for (let i = 0; i < 16000; i++) pcm.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / 16000)), i * 2);
    const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24);
    header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    const library = join(directory, 'sound.wav'); await writeFile(library, Buffer.concat([header, pcm]));
    const service = new AkariAnnotationsServiceImpl(), projectRootUri = pathToFileURL(project).href;
    assert.deepEqual(await service.projectReferenceMediaUris({ projectRootUri }), {});
    await recordProjectReference(project, { category: 'audio', id: 'sound' });
    const uris = await service.projectReferenceMediaUris({ projectRootUri });
    const audioUri = uris['assets/audio/sound/sound.wav'];
    assert.equal(audioUri, pathToFileURL(library).href);
    const duration = await service.getAudioDuration({ projectRootUri, audioUri });
    assert.equal(duration.status, 'ready'); assert.equal(duration.durationSeconds, 1);
    const waveform = await service.getClipWaveform({ projectRootUri, videoUri: audioUri, startSeconds: 0, endSeconds: 1, bucketCount: 100 });
    assert.equal(waveform.status, 'ready');
});

test('同期タイムラインの動画・画像・音声は node 解決表を共有し、宣言パスの脱出を拒否', async () => {
    const { readFileSync } = await import('node:fs');
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const ts = require('typescript'), URI = require('@theia/core/lib/common/uri').default;
    const source = ts.createSourceFile('widget.ts', readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const widget = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsWidget');
    const method = widget.members.find(member => member.name?.getText(source) === 'resolveEditMediaUri').getText(source);
    const code = ts.transpileModule(`class Handler { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Handler = new Function('URI', `${code}; return Handler;`)(URI), handler = new Handler();
    handler.referenceMediaRoot = 'file:///project';
    handler.referenceMediaUris = {};
    const editUri = new URI('file:///project/edit.json');
    for (const [category, file] of [['audio', 'sound.wav'], ['broll', 'clip.mp4'], ['still', 'image.png']]) {
        const path = `assets/${category}/sample/${file}`, uri = `file:///library/${category}/sample/${file}`;
        handler.referenceMediaUris[path] = uri;
        assert.equal(handler.resolveEditMediaUri(path, editUri).toString(), uri);
    }
    assert.equal(handler.resolveEditMediaUri('assets/old.wav', editUri).toString(), 'file:///project/assets/old.wav');
    assert.throws(() => handler.resolveEditMediaUri('assets/../../outside.wav', editUri), /外/);
});
