import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, access, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NarrationCliManager } from '../lib/node/narration-cli.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('voice RPC は C1 の引数を渡し、有償操作は承認なしで spawn しない', async () => {
  const prior = process.env.AKARI_GENERATE_CLI;
  process.env.AKARI_GENERATE_CLI = '/fake/akari.mjs';
  const calls = [];
  try {
    const manager = new NarrationCliManager((_command, args) => {
      calls.push(args.slice(1));
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => { child.stdout.emit('data', JSON.stringify({ status: 'ok', profile: 'p', engine: 'irodori' })); child.emit('close', 0); });
      return child;
    });
    await assert.rejects(manager.voiceCopy({ profile: 'p', engine: 'fal-qwen3' }), /費用承認/u);
    await assert.rejects(manager.voiceTry({ profile: 'p', engine: 'fal-qwen3', text: 'こんにちは' }), /費用承認/u);
    assert.equal(calls.length, 0);
    await manager.voiceCopy({ profile: 'p', engine: 'irodori', irodoriUrl: 'http://127.0.0.1:9000' });
    await manager.voiceCopy({ profile: 'p', engine: 'fal-qwen3', approved: true });
    assert.deepEqual(calls[0], ['voice', 'copy', '--profile', 'p', '--engine', 'irodori', '--irodori-url', 'http://127.0.0.1:9000', '--json']);
    assert.deepEqual(calls[1], ['voice', 'copy', '--profile', 'p', '--engine', 'fal-qwen3', '--yes', '--json']);
  } finally { if (prior === undefined) delete process.env.AKARI_GENERATE_CLI; else process.env.AKARI_GENERATE_CLI = prior; }
});

test('録音は分割チャンクで一時ファイルに保存し、voiceDiscard で消す', async () => {
  const service = new AkariAnnotationsServiceImpl();
  const { token } = await service.voiceBeginRecording('wav');
  await service.voiceAppendRecording({ token, chunk: Buffer.from('RI').toString('base64') });
  await service.voiceAppendRecording({ token, chunk: Buffer.from('FF').toString('base64') });
  const { path } = await service.voiceFinishRecording(token);
  assert.equal((await readFile(path)).toString(), 'RIFF');
  await service.voiceDiscard({ tempPaths: [path] });
  await assert.rejects(access(path), /ENOENT/u);
  const unfinished = await service.voiceBeginRecording('m4a');
  await service.voiceAppendRecording({ token: unfinished.token, chunk: 'AQID' });
  const incompletePath = service.voiceRecordings.get(unfinished.token).path;
  await service.voiceAbortRecording(unfinished.token);
  await assert.rejects(access(incompletePath), /ENOENT/u);
  await assert.rejects(service.voiceBeginRecording('evil'), /不正/u);
});

test('service も fal の費用承認前には CLI を呼ばない', async () => {
  const service = new AkariAnnotationsServiceImpl();
  let calls = 0;
  service.narrationCli = { voiceCopy: async () => { calls++; }, voiceTry: async () => { calls++; } };
  await assert.rejects(service.voiceCopy({ profile: 'p', engine: 'fal-qwen3' }), /費用承認/u);
  await assert.rejects(service.voiceTry({ profile: 'p', engine: 'fal-qwen3', text: 'こんにちは' }), /費用承認/u);
  assert.equal(calls, 0);
});

test('voiceDiscard は未作成 profile と所有外・危険な一時パスを消さない', async () => {
  const service = new AkariAnnotationsServiceImpl(), other = new AkariAnnotationsServiceImpl();
  let deletes = 0;
  service.narrationCli = { voiceDelete: async () => { deletes++; } };
  const foreign = await other.voiceBeginRecording('wav').then(async ({ token }) => { await other.voiceAppendRecording({ token, chunk: 'AQ==' }); return other.voiceFinishRecording(token); });
  const unsafe = await mkdtemp(path.join(tmpdir(), 'not-akari-voice-'));
  const unsafeFile = path.join(unsafe, 'recording.wav');
  try {
    await writeFile(unsafeFile, Buffer.from([2]));
    service.voiceTempPaths.add(unsafeFile);
    await service.voiceDiscard({ profile: 'existing', tempPaths: [foreign.path, unsafeFile] });
    assert.equal(deletes, 0);
    await access(foreign.path);
    await access(unsafeFile);
  } finally {
    await other.voiceDiscard({ tempPaths: [foreign.path] });
    await rm(unsafe, { recursive: true, force: true });
  }
});

test('voiceAvatars は隔離 AKARI_HOME の avatar.json を声の有無に関係なく列挙する', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'akari-voice-avatars-test-'));
  const prior = process.env.AKARI_HOME;
  try {
    process.env.AKARI_HOME = home;
    const directory = path.join(home, 'avatars', 'sample');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'avatar.json'), JSON.stringify({ version: 0, id: 'sample', display_name: 'サンプル',
      variants: [], persona: { first_person: '私', tone: '静か', speech_style: '自然', verbal_tics: [], energy: 50,
        ng: [], default_role: 'narrator' }, voice: { lane: 'recorded', ref: 'profile:sample', credit: null },
      renditions: [], default_rendition: null,
      rights: { subject: 'person', consent: 'self', credit_required: false, distribution: 'private' } }));
    assert.deepEqual(await new AkariAnnotationsServiceImpl().voiceAvatars(), {
      avatars: [{ id: 'sample', displayName: 'サンプル' }]
    });
  } finally {
    if (prior === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = prior;
    await rm(home, { recursive: true, force: true });
  }
});

function wav() {
  const data = Buffer.alloc(48000 * 2);
  for (let i = 0; i < 48000; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 2 * 220 / 48000) * 1000), i * 2);
  const out = Buffer.alloc(44 + data.length);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(48000, 24); out.writeUInt32LE(96000, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(data.length, 40); data.copy(out, 44);
  return out;
}

test('rename と extend は CLI に委ね、シェルは meta.json を書かない', async () => {
  const service = new AkariAnnotationsServiceImpl();
  service.voiceCreatedProfiles.add('p');
  const calls = [];
  service.narrationCli = {
    voiceRename: async (...args) => { calls.push(['rename', ...args]); },
    voiceExtend: async (...args) => { calls.push(['extend', ...args]); return { path: '/tmp/combined.wav', warnings: ['stale'] }; }
  };
  const result = await service.voiceExtend({ profile: 'p', audioPath: '/tmp/extra.wav' });
  await service.voiceFinalize({ profile: 'p', label: '新しい名前' });
  assert.deepEqual(calls, [['extend', 'p', '/tmp/extra.wav'], ['rename', 'p', '新しい名前']]);
  assert.equal(result.warnings.length, 1);
});
