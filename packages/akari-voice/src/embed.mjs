import { fbank } from './fbank.mjs';
import { VOICE_IDENTIFY_UNAVAILABLE_MESSAGE } from './voice-home.mjs';

export const EMBEDDING_KEY = Object.freeze({ model: 'wespeaker-voxceleb-resnet34-LM', space: 'wespeaker/voxceleb_resnet34_LM', preprocess: 'akari.voice/hamming-cmn-tile10-v1' });

export function fbankMean(samples) {
  const { T, numBins, data } = fbank(samples);
  const mean = new Float64Array(numBins);
  for (let i = 0; i < data.length; i++) mean[i % numBins] += data[i];
  if (T) for (let b = 0; b < numBins; b++) mean[b] /= T;
  return mean;
}

export function subtractMean(feats, mean) {
  return { ...feats, data: Float32Array.from(feats.data, (value, i) => value - mean[i % feats.numBins]) };
}

export function tileSamples(samples, sampleRate = 16000, seconds = 10) {
  const target = Math.round(sampleRate * seconds);
  if (samples.length >= target) return samples;
  if (!samples.length) throw new Error('空の音声は敷き詰められません');
  return Float32Array.from({ length: target }, (_, i) => samples[i % samples.length]);
}

export function l2normalize(vector) {
  const norm = Math.hypot(...vector);
  return Float32Array.from(vector, value => norm ? value / norm : 0);
}

export function cosine(a, b) {
  if (a.length !== b.length) throw new Error('埋め込みの次元が一致しません');
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function meanEmbedding(list) {
  if (!list.length) throw new Error('埋め込みがありません');
  const sum = new Float64Array(list[0].length);
  for (const vector of list) {
    if (vector.length !== sum.length) throw new Error('埋め込みの次元が一致しません');
    const unit = l2normalize(vector);
    for (let i = 0; i < sum.length; i++) sum[i] += unit[i];
  }
  return l2normalize(sum);
}

export function encodeEmbedding(vector) {
  if (vector.length !== 256) throw new Error('埋め込みは 256 次元が必要です');
  const buffer = Buffer.alloc(256 * 4);
  for (let i = 0; i < 256; i++) buffer.writeFloatLE(vector[i], i * 4);
  return buffer.toString('base64');
}

export function decodeEmbedding(base64) {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length !== 256 * 4) throw new Error('埋め込みの長さが不正です');
  return Float32Array.from({ length: 256 }, (_, i) => buffer.readFloatLE(i * 4));
}

export async function createEmbedder(runtime, modelPath) {
  if (!runtime.ort) throw new Error(VOICE_IDENTIFY_UNAVAILABLE_MESSAGE);
  const session = await runtime.ort.InferenceSession.create(modelPath, { intraOpNumThreads: 2 });
  return {
    async embed(samples, cmnMean) {
      if (!samples.length) throw new Error('空の音声は埋め込めません');
      const mean = cmnMean ?? fbankMean(samples);
      const feats = subtractMean(fbank(tileSamples(samples)), mean);
      const input = new runtime.ort.Tensor('float32', feats.data, [1, feats.T, feats.numBins]);
      const outputs = await session.run({ feats: input });
      const vector = outputs[session.outputNames[0]].data;
      if (vector.length !== 256) throw new Error('モデルの出力次元が不正です');
      return l2normalize(vector);
    },
  };
}
