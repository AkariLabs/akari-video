import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createLiveEngine, createRecordEngine, getCapabilities, pickEngine,
  createSegmenter, classifyUtterance, createPaperSessions,
  createPipeline, engineLabel
} from '../src/index.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url));
const fakeSpawn = mode => (path, args, options) => spawn(process.execPath, [path, ...args], {
  ...options, env: { ...process.env, AKARI_EAR_FAKE_MODE: mode }
});

test('ヘルパーの JSONL を状態・途中経過・確定・音量に写す', async () => {
  const engine = createLiveEngine({ helperPath: fixture, spawn: fakeSpawn('normal') });
  const seen = [];
  const level = new Promise(resolve => engine.on('level', resolve));
  for (const name of ['status', 'partial', 'final', 'level', 'error']) engine.on(name, value => seen.push([name, value]));
  engine.start();
  await level;
  assert.deepEqual(seen.map(([name]) => name), ['status', 'partial', 'final', 'level']);
  assert.equal(seen[1][1].text, 'もう');
  assert.equal(seen[2][1].final, true);
  assert.equal(seen[3][1], 0.4);
  engine.stop();
});

test('異常終了は error、stop は冪等', async () => {
  const engine = createLiveEngine({ helperPath: fixture, spawn: fakeSpawn('crash') });
  const error = new Promise(resolve => engine.on('error', resolve));
  engine.start();
  assert.match((await error).message, /異常終了/);
  engine.stop();
  engine.stop();
  const hold = createLiveEngine({ helperPath: fixture, spawn: fakeSpawn('hold') });
  hold.on('error', () => {});
  hold.start();
  hold.stop();
  hold.stop();
});

test('セグメンタは最初の途中経過から確定までを 1 区間にする', () => {
  const segmenter = createSegmenter();
  assert.equal(segmenter.push({ t: 1, text: '', final: false }), undefined);
  assert.equal(segmenter.push({ t: 2, text: 'あ', final: false }), undefined);
  assert.equal(segmenter.push({ t: 3, text: 'あ', final: false }), undefined);
  assert.deepEqual(segmenter.push({ t: 4, text: 'あいう', final: true }), { t0: 2, t1: 4, text: 'あいう' });
  assert.equal(segmenter.push({ t: 5, text: 'あいう', final: true }), undefined);
  assert.deepEqual(segmenter.push({ t: 6, text: '別', final: true, confidence: 0.8 }),
    { t0: 6, t1: 6, text: '別', confidence: 0.8 });
});

test('紙の声コマンドは短い全文一致だけ', () => {
  const rows = [
    ['もう 1 枚。', true, 'command'],
    ['ここでもう1枚、描きます', true, 'speech'],
    ['今の画面を敷いてくださいお願い', true, 'speech'],
    ['閉じて', false, 'speech'],
    ['ここに字幕を入れて', true, 'speech'],
    ['矢印にして', true, 'command'],
    ['自作語', true, 'command', ['自作語']]
  ];
  for (const [text, paperOpen, expected, lexicon] of rows) {
    assert.equal(classifyUtterance(text, { paperOpen, ...(lexicon ? { lexicon } : {}) }), expected, text);
  }
});

test('紙の時計・開く前の除外・跨ぎの切り上げ・一度だけの取り出し・busy', () => {
  const paper = createPaperSessions({ engineStartedAtEpochMs: 1000, engine: engineLabel('speechanalyzer-live') });
  paper.onSegment({ t0: 0, t1: 0.5, text: '前' });
  assert.equal(paper.open('a', 3000), 'opened');
  assert.equal(paper.open('b', 4000), 'busy');
  paper.onSegment({ t0: 2, t1: 2.1, text: '途中', final: false });
  paper.onSegment({ t0: 0, t1: 1, text: '前' });
  paper.onSegment({ t0: 1.5, t1: 3, text: '跨ぎ', kind: 'speech' });
  paper.onSegment({ t0: 4, t1: 5, text: '閉じて', kind: 'command' });
  paper.close('a', 6000);
  assert.deepEqual(paper.takeTranscript('a'), { engine: 'speech-analyzer', locale: 'ja-JP', openedRecT: 2,
    segments: [{ t0: 0, t1: 1, text: '跨ぎ', kind: 'speech' },
      { t0: 2, t1: 3, text: '閉じて', kind: 'command' }] });
  assert.equal(paper.takeTranscript('a'), undefined);
});

test('能力判定は OS・ヘルパー・強制フォールバックに従う', () => {
  const transcribe = async () => ({ segments: [] });
  const rows = [
    [{ platform: 'darwin', darwinMajor: 24, helperPath: process.execPath }, false, /未対応/],
    [{ platform: 'darwin', darwinMajor: 25, helperPath: process.execPath }, true, undefined],
    [{ platform: 'darwin', darwinMajor: 25, helperPath: '/missing' }, false, /見つかりません/],
    [{ platform: 'darwin', darwinMajor: 25, helperPath: process.execPath, env: { AKARI_EAR_FORCE_FALLBACK: '1' } }, false, /無効/]
  ];
  for (const [options, expected, reason] of rows) {
    const caps = getCapabilities({ ...options, transcribe });
    assert.equal(caps.engines[0].available, expected);
    if (reason) assert.match(caps.engines[0].reason, reason);
    assert.equal(pickEngine('speechanalyzer-live', caps), expected ? 'speechanalyzer-live' : 'record-then-transcribe');
  }
  assert.equal(pickEngine(undefined, getCapabilities({ platform: 'win32' })), null);
});

test('録音エンジンは WAV を渡し成功・失敗・中断後に消す', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ear-test-'));
  try {
    const cases = [
      async path => { const wav = await readFile(path); assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        assert.equal(wav.readUInt32LE(40), 4); return { segments: [{ t0: 0, t1: 1, text: '成功' }] }; },
      async () => { throw new Error('失敗'); },
      async (_path, { signal }) => new Promise((_resolve, reject) => {
        if (signal.aborted) reject(new Error('中断'));
        else signal.addEventListener('abort', () => reject(new Error('中断')));
      })
    ];
    for (const [index, transcribe] of cases.entries()) {
      const engine = createRecordEngine({ transcribe, tmpDir: root });
      const finals = [];
      const errors = [];
      engine.on('final', value => finals.push(value));
      engine.on('error', error => errors.push(error));
      await engine.appendAudio(Buffer.alloc(4));
      if (index === 2) {
        const stopping = engine.stop();
        await new Promise(resolve => setImmediate(resolve));
        await engine.cancel();
        await stopping;
      } else await engine.stop();
      assert.deepEqual(await readdir(root), []);
      if (index === 0) assert.equal(finals[0].text, '成功');
      if (index === 1) assert.equal(errors[0].message, '失敗');
      if (index === 2) assert.equal(errors.length, 0);
    }
    assert.equal(createRecordEngine({ tmpDir: root }).available, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('パイプラインの既定辞書は恒等で applied は空', () => {
  const pipeline = createPipeline();
  assert.deepEqual(pipeline.push({ text: 'そのまま', final: true, t: 2 }),
    { id: 'utterance-1', raw: 'そのまま', text: 'そのまま', final: true, applied: [], t: 2, kind: 'speech' });
  assert.equal(pipeline.push({ text: '次', final: false, t: 3 }).id, 'utterance-2');
  assert.equal(pipeline.push({ text: '次の言葉', final: true, t: 4 }).id, 'utterance-2');
});
