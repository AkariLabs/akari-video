import test from 'node:test';
import { t as voiceText } from '../../i18n/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fbank, windowValues, fbankMean, subtractMean, tileSamples, encodeEmbedding, decodeEmbedding,
  createEmbedder, VOICE_IDENTIFY_UNAVAILABLE_MESSAGE,
  relabelTurns, assignSpeakers, speakerTracks, speakerSeconds, mergeSpeakers, clusterCountFor, diarizeToCount,
  speakerLabel, levelFor, suggestFor, bundleBySuggestion, voiceEngineStatus,
  channelPeopleForProject, readChannelPeople, loadCentroids, buildVoicesFile, writeVoicesFile,
  readVoicesFile, setDecided, writeSpeakerEntry, readSpeakerDictionary, dictionaryPathFor,
  MIN_SPEAKER_SECONDS, MIN_SPEAKER_SHARE, isAudioBufferLimit, AUDIO_TOO_LONG_MESSAGE,
  shortSpeakerIds,
} from '../src/index.mjs';

const lane = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.tmp-lane');
function scratch(t) {
  fs.mkdirSync(lane, { recursive: true });
  const dir = fs.mkdtempSync(path.join(lane, 'voice-test-'));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!fs.readdirSync(lane).length) fs.rmdirSync(lane);
  });
  return dir;
}

test('fbank の窓、フレーム数、無音、1 kHz', () => {
  assert.ok(Math.abs(windowValues(400)[0] - 0.08) < 1e-12);
  assert.equal(windowValues(400, 'povey')[0], 0);
  const silence = fbank(new Float32Array(16000));
  assert.equal(silence.T, 1 + Math.floor((16000 - 400) / 160));
  assert.equal(silence.data.length, silence.T * 80);
  assert.ok([...silence.data].every(value => Math.abs(value - Math.log(1.1920928955078125e-7)) < 1e-5));
  const tone = Float32Array.from({ length: 16000 }, (_, i) => Math.sin(2 * Math.PI * i * 1000 / 16000) * 0.3);
  const spectrum = fbank(tone);
  const row = [...spectrum.data.slice(0, 80)];
  const peak = row.indexOf(Math.max(...row));
  const center = (i) => 700 * (Math.exp((1127 * Math.log1p(20 / 700) + (i + 1) * (1127 * Math.log1p(8000 / 700) - 1127 * Math.log1p(20 / 700)) / 81) / 1127) - 1);
  assert.ok(Math.abs(center(peak) - 1000) < 100);
});

test('録音全体の CMN と敷き詰め', () => {
  const samples = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(i / 20) * 0.2);
  const centered = subtractMean(fbank(samples), fbankMean(samples));
  for (let b = 0; b < 80; b++) {
    let sum = 0;
    for (let t = 0; t < centered.T; t++) sum += centered.data[t * 80 + b];
    assert.ok(Math.abs(sum / centered.T) < 1e-5);
  }
  const tiled = tileSamples(Float32Array.of(1, 2, 3));
  assert.equal(tiled.length, 160000);
  assert.deepEqual([...tiled.slice(0, 8)], [1, 2, 3, 1, 2, 3, 1, 2]);
  const long = new Float32Array(160001);
  assert.equal(tileSamples(long), long);
});

test('分離結果の並べ替え、発話への割り当て、集計', () => {
  const turns = relabelTurns([{ start: 3, end: 4.26, speaker: 7 }, { start: 0, end: 2.24, speaker: 9 }, { start: 2.5, end: 3, speaker: 9 }]);
  assert.deepEqual(turns.map(turn => turn.speaker), ['A', 'A', 'B']);
  assert.equal(speakerLabel(25), 'Z'); assert.equal(speakerLabel(26), 'AA');
  const segments = [{ start: 2.8, end: 3.9, text: '一' }, { start: 5, end: 6, text: '二' }];
  assert.deepEqual(assignSpeakers(segments, turns), [{ ...segments[0], speaker: 'B' }, segments[1]]);
  assert.equal(segments[0].speaker, undefined);
  assert.deepEqual(speakerTracks(turns), [{ id: 'A', spans: [[0, 2.24], [2.5, 3]] }, { id: 'B', spans: [[3, 4.26]] }]);
  assert.deepEqual(speakerSeconds(turns), { A: 2.7, B: 1.3 });
  assert.deepEqual(mergeSpeakers(turns, { B: 'A' }).map(turn => turn.speaker), ['A', 'A', 'A']);
  assert.equal(clusterCountFor('auto'), -1); assert.equal(clusterCountFor(4), -1);
  for (const n of [1, 2, 3]) assert.equal(clusterCountFor(n), n);
  assert.throws(() => clusterCountFor(5), error => error.message === voiceText('tools.voice.engine.error.invalidSpeakerCount'));
});

test('照合の境界、提案、同一人物の束ね', () => {
  assert.deepEqual([0.60, 0.5999, 0.45, 0.4499].map(levelFor), ['strong', 'maybe', 'maybe', 'none']);
  const unit = Float32Array.of(1, 0);
  assert.deepEqual(suggestFor(unit, []), null);
  assert.deepEqual(suggestFor(unit, [{ person: 'c/a', name: '甲', centroid: unit }]), { person: 'c/a', name: '甲', score: 1, level: 'strong' });
  assert.deepEqual(suggestFor(unit, [{ person: 'c/b', name: '乙', centroid: Float32Array.of(0, 1) }]), { score: 0, level: 'none' });
  assert.deepEqual(bundleBySuggestion({ A: { person: 'c/a', level: 'strong' }, B: { person: 'c/b', level: 'maybe' }, C: { person: 'c/a', level: 'strong' } }), { C: 'A' });
});

test('埋め込みと声の側ファイルの往復、決定の保持', t => {
  const dir = scratch(t), file = path.join(dir, 'voices.json');
  const embedding = Float32Array.from({ length: 256 }, (_, i) => i / 1000);
  assert.deepEqual(decodeEmbedding(encodeEmbedding(embedding)), embedding);
  writeVoicesFile(file, buildVoicesFile({ speakers: { A: { seconds: 3.2, embedding } } }));
  assert.equal(readVoicesFile(file).speakers.A.embedding, encodeEmbedding(embedding));
  setDecided(file, 'A', 'c/p');
  const next = buildVoicesFile({ previous: readVoicesFile(file), speakers: { A: { seconds: 4, embedding } } });
  assert.deepEqual(next.decided, { A: 'c/p' });
  assert.equal(Object.hasOwn(buildVoicesFile({ speakers: {}, shortSpeakers: [] }), 'shortSpeakers'), false);
  setDecided(file, 'A', null);
  assert.deepEqual(readVoicesFile(file).decided, {});
});

test('話者辞書は他キーと他の話者を保持し、消去できる', t => {
  const dir = scratch(t), file = dictionaryPathFor(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ other: 7, speakers: { B: { name: '乙' } } }));
  writeSpeakerEntry(dir, 'A', { name: '甲', person: 'c/p' });
  assert.deepEqual(readSpeakerDictionary(dir), { B: { name: '乙' }, A: { name: '甲', person: 'c/p' } });
  writeSpeakerEntry(dir, 'A', undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { other: 7, speakers: { B: { name: '乙' } } });
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('\n'));
});

test('声の置き場の ready、missing、unsupported', t => {
  const home = scratch(t), key = 'win32-x64';
  const required = ['manifest.json', ...['sherpa-onnx-node', 'sherpa-onnx-win-x64', 'onnxruntime-node', 'onnxruntime-common'].map(name => `runtime/${key}/node_modules/${name}/package.json`), ...['wespeaker_en_voxceleb_resnet34_LM.onnx', 'pyannote-segmentation-3.0.onnx', 'silero_vad.onnx'].map(name => `models/${name}`)];
  for (const name of required) { const file = path.join(home, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, name === 'manifest.json' ? '{}' : ''); }
  assert.equal(voiceEngineStatus({ home, platform: 'win32', arch: 'x64' }).status, 'ready');
  fs.rmSync(path.join(home, required[1]));
  assert.deepEqual(voiceEngineStatus({ home, platform: 'win32', arch: 'x64' }).missing, [required[1]]);
  assert.equal(voiceEngineStatus({ home, platform: 'linux', arch: 'x64' }).status, 'unsupported');
  fs.writeFileSync(path.join(home, 'manifest.json'), '{');
  assert.ok(voiceEngineStatus({ home, platform: 'win32', arch: 'x64' }).missing.includes('manifest.json'));
});

test('Intel Mac は ORT なしで分離でき、Windows は ORT を必要とする', t => {
  const home = scratch(t);
  const files = ['manifest.json', ...['wespeaker_en_voxceleb_resnet34_LM.onnx', 'pyannote-segmentation-3.0.onnx', 'silero_vad.onnx'].map(name => `models/${name}`)];
  for (const key of ['darwin-x64', 'win32-x64']) {
    const native = key === 'win32-x64' ? 'sherpa-onnx-win-x64' : 'sherpa-onnx-darwin-x64';
    files.push(...['sherpa-onnx-node', native].map(name => `runtime/${key}/node_modules/${name}/package.json`));
  }
  for (const name of files) {
    const file = path.join(home, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, name === 'manifest.json' ? '{}' : '');
  }
  const mac = voiceEngineStatus({ home, platform: 'darwin', arch: 'x64' });
  assert.equal(mac.status, 'ready');
  assert.equal(mac.canIdentify, false);
  const windows = voiceEngineStatus({ home, platform: 'win32', arch: 'x64' });
  assert.equal(windows.status, 'missing');
  assert.equal(windows.canIdentify, false);
  assert.ok(windows.missing.some(name => name.includes('onnxruntime-node')));
});

test('照合用ランタイムが無い場合は共通の案内で拒む', async () => {
  await assert.rejects(createEmbedder({ ort: null }, 'model.onnx'),
    error => error.message === VOICE_IDENTIFY_UNAVAILABLE_MESSAGE);
});

test('人数指定は自動結果を優先し、必要なときだけ再試行する', async () => {
  const turns = n => Array.from({ length: n }, (_, speaker) => ({ start: speaker * 4, end: speaker * 4 + 4, speaker }));
  const calls = [];
  const run = resultByCluster => async (_samples, { numClusters }) => {
    calls.push(numClusters);
    return turns(resultByCluster[numClusters]);
  };
  const samples = new Float32Array(1);
  let result = await diarizeToCount(run({ [-1]: 2 }), samples, 2);
  assert.deepEqual(calls, [-1]);
  assert.deepEqual([result.used, result.fallback], [2, false]);
  calls.length = 0;
  result = await diarizeToCount(run({ [-1]: 2, 3: 2, 4: 3 }), samples, 3);
  assert.deepEqual(calls, [-1, 3, 4]);
  assert.deepEqual([result.used, result.fallback], [3, false]);
  calls.length = 0;
  result = await diarizeToCount(run({ [-1]: 2, 3: 2, 4: 4, 5: 4 }), samples, 3);
  assert.deepEqual(calls, [-1, 3, 4, 5]);
  assert.deepEqual([result.requested, result.used, result.fallback, result.turns.length], [3, 2, true, 2]);
  for (const [speakers, expected, callsExpected] of [[1, 1, [1]], ['auto', -1, [-1]], [4, -1, [-1]]]) {
    calls.length = 0;
    result = await diarizeToCount(run({ [expected]: 1 }), samples, speakers);
    assert.deepEqual(calls, callsExpected);
    assert.equal(result.fallback, false);
  }
});

test('短い外れ値を人数指定に採用せず、自動結果へ戻す', async () => {
  assert.equal(MIN_SPEAKER_SECONDS, 3);
  assert.equal(MIN_SPEAKER_SHARE, 0.03);
  const auto = [{ start: 0, end: 40, speaker: 0 }, { start: 40, end: 80, speaker: 1 }];
  const outlier = [...auto, { start: 80, end: 81, speaker: 2 }];
  const run = async (_samples, { numClusters }) => numClusters === -1 ? auto : outlier;
  const result = await diarizeToCount(run, new Float32Array(1), 3);
  assert.deepEqual([result.used, result.fallback], [2, true]);
  const enough = [...auto, { start: 80, end: 84, speaker: 2 }];
  const accepted = await diarizeToCount(async (_samples, { numClusters }) => numClusters === -1 ? auto : enough,
    new Float32Array(1), 3);
  assert.deepEqual([accepted.used, accepted.fallback], [3, false]);
  const lowShare = [{ start: 0, end: 200, speaker: 0 }, { start: 200, end: 400, speaker: 1 },
    { start: 400, end: 404, speaker: 2 }];
  const rejectedShare = await diarizeToCount(async (_samples, { numClusters }) => numClusters === -1 ? auto : lowShare,
    new Float32Array(1), 3);
  assert.equal(rejectedShare.fallback, true);
});

test('自動結果が指定人数なら短い話者がいても fallback にしない', async () => {
  const auto = [{ start: 0, end: 97.1, speaker: 8 }, { start: 97.1, end: 100, speaker: 4 }];
  const calls = [];
  const result = await diarizeToCount(async (_samples, { numClusters }) => {
    calls.push(numClusters);
    return numClusters === -1 ? auto : [{ start: 0, end: 100, speaker: 8 }];
  }, new Float32Array(1), 2);
  assert.deepEqual(calls, [-1, 2, 3, 4]);
  assert.deepEqual([result.used, result.fallback, result.turns], [2, false, auto]);
  assert.deepEqual(shortSpeakerIds(auto), [4]);
  assert.deepEqual(shortSpeakerIds([
    { start: 0, end: 97, speaker: 'A' }, { start: 97, end: 100, speaker: 'B' },
  ]), []);
});

test('長い音声のバッファ上限だけを専用の案内にする', () => {
  assert.equal(isAudioBufferLimit({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), true);
  assert.equal(isAudioBufferLimit({ code: 'ENOBUFS' }), true);
  assert.equal(isAudioBufferLimit({ message: 'stdout maxBuffer length exceeded' }), true);
  assert.equal(isAudioBufferLimit({ code: 'ENOENT', message: 'not found' }), false);
  assert.equal(AUDIO_TOO_LONG_MESSAGE, voiceText('tools.voice.engine.error.audioTooLong'));
});

test('チャンネルの位置と同意のある見本だけを読む', t => {
  const root = scratch(t), peoplePath = path.join(root, 'channels', 'sample', 'people.json');
  assert.deepEqual(channelPeopleForProject(path.join(root, 'channels', 'sample', 'videos', 'p')), { channel: 'sample', peoplePath });
  assert.equal(channelPeopleForProject(path.join(root, 'elsewhere')), null);
  fs.mkdirSync(path.dirname(peoplePath), { recursive: true });
  fs.writeFileSync(peoplePath, JSON.stringify({ version: 1, entries: [{ kind: 'person', id: 'a', name: '甲', voice: { samples: [{ file: 'a.wav', consent: 'self' }, { file: 'b.wav' }] } }, { kind: 'avatar', id: 'b', name: '乙', voice: { samples: [{ file: 'c.wav', consent: 'subject' }] } }] }));
  assert.deepEqual(readChannelPeople(peoplePath).map(person => [person.id, person.samples.length]), [['a', 1], ['b', 1]]);
});

test('人物の重心は見本の内容が同じ間キャッシュを使う', async t => {
  const dir = scratch(t), peoplePath = path.join(dir, 'people.json');
  const audio = path.join(dir, 'voice.wav');
  fs.writeFileSync(audio, 'one');
  fs.writeFileSync(peoplePath, JSON.stringify({ entries: [{ kind: 'person', id: 'p', name: '甲', voice: { samples: [{ file: 'voice.wav', consent: 'self' }] } }] }));
  let calls = 0;
  const embedder = { async embed() { calls++; return Float32Array.from({ length: 256 }, (_, i) => i === 0 ? 1 : 0); } };
  const options = { peoplePath, channel: 'c', embedder, decode: async () => new Float32Array(16000) };
  assert.deepEqual((await loadCentroids(options)).compared, ['c/p']);
  assert.equal(calls, 1);
  await loadCentroids(options);
  assert.equal(calls, 1);
  fs.writeFileSync(audio, 'two');
  await loadCentroids(options);
  assert.equal(calls, 2);
});

test('チャンネル外の見本は拒み、重心を作らない', async t => {
  const dir = scratch(t), channel = path.join(dir, 'channel');
  fs.mkdirSync(channel);
  fs.writeFileSync(path.join(dir, 'outside.wav'), 'voice');
  const peoplePath = path.join(channel, 'people.json');
  fs.writeFileSync(peoplePath, JSON.stringify({ entries: [{ kind: 'person', id: 'p', name: '甲', voice: {
    samples: [{ file: '../outside.wav', consent: 'self' }] } }] }));
  const result = await loadCentroids({ peoplePath, channel: 'c', embedder: { embed: () => { throw new Error('呼ばれない'); } },
    decode: () => { throw new Error('呼ばれない'); } });
  assert.deepEqual(result.compared, []);
  assert.equal(result.warnings[0], `p: ${voiceText('tools.voice.engine.error.sampleOutsideChannel')}`);
});
