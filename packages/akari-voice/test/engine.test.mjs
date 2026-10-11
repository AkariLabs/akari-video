import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  voiceEngineStatus, loadVoiceRuntime, decodeAudio16k, createDiarizer, relabelTurns,
  createEmbedder, embedSpeakers, cosine,
} from '../src/index.mjs';

test('2 人の分離と別録音による照合', { timeout: 600000 }, async t => {
  const home = process.env.AKARI_VOICE_HOME, fixture = process.env.AKARI_VOICE_TEST_AUDIO;
  if (!home || !fixture) return t.skip('声のエンジンと音声見本が指定されていません');
  const status = voiceEngineStatus({ home });
  if (status.status !== 'ready') return t.skip('声のエンジンが準備されていません');
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) return t.skip('ffmpeg がありません');
  const runtime = loadVoiceRuntime(status);
  const samples = decodeAudio16k({ file: path.join(fixture, 'two-speakers.wav') });
  const truth = JSON.parse(fs.readFileSync(path.join(fixture, 'two-speakers.truth.json'), 'utf8'));
  const diarizer = createDiarizer(runtime, {
    segmentationModel: path.join(status.modelsDir, 'pyannote-segmentation-3.0.onnx'),
    embeddingModel: path.join(status.modelsDir, 'wespeaker_en_voxceleb_resnet34_LM.onnx'),
    numClusters: -1, threshold: 0.5,
  });
  const turns = relabelTurns(diarizer.process(samples));
  assert.equal(new Set(turns.map(turn => turn.speaker)).size, 2);
  const majority = item => {
    const totals = new Map();
    for (const turn of turns) {
      const duration = Math.max(0, Math.min(item.end, turn.end) - Math.max(item.start, turn.start));
      totals.set(turn.speaker, (totals.get(turn.speaker) || 0) + duration);
    }
    return [...totals].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const labels = new Map();
  for (const item of truth) {
    const label = majority(item);
    assert.ok(label, '正解区間に話者が必要です');
    if (!labels.has(item.who)) labels.set(item.who, label);
    assert.equal(label, labels.get(item.who));
  }
  assert.equal(labels.size, 2);
  assert.notEqual([...labels.values()][0], [...labels.values()][1]);
  const embedder = await createEmbedder(runtime, path.join(status.modelsDir, 'wespeaker_en_voxceleb_resnet34_LM.onnx'));
  const vectors = await embedSpeakers({ embedder, samples, turns });
  const aEnroll = await embedder.embed(decodeAudio16k({ file: path.join(fixture, 'a-enroll.wav') }));
  const bEnroll = await embedder.embed(decodeAudio16k({ file: path.join(fixture, 'b-enroll.wav') }));
  assert.ok(cosine(vectors[labels.get('a')], aEnroll) >= 0.60);
  assert.ok(cosine(vectors[labels.get('b')], aEnroll) < 0.45);
  assert.ok(cosine(vectors[labels.get('b')], bEnroll) >= 0.60);
});
