// L1 検証ハーネス（実ブラウザの OfflineAudioContext を使う）。
// preview-narration の受け入れ条件:
//   - narration 付きプロジェクトで narration がプレビュー音声に含まれることの観測記録
//   - ducking:true のとき narration 区間の BGM ゲインが -12dB になることの観測記録
//   - narration ファイルが読めない場合は当該要素のみスキップ（契約 §4）
// を、モックではなく実際の NarrationTrack（dist/narrationTrack.js）+ OfflineAudioContext の
// レンダリング結果（RMS 実測）で検証する。ネットワークは一切使わない（fetch はテスト内蔵の
// フェイクに差し替え、音声データはこのファイル内で合成した WAV バイト列のみ）。
import { NarrationTrack } from '../../dist/narrationTrack.js';
import { computeBgmDuckGainDb, computeDuckIntervals, STATIC_DUCK_GAIN_DB } from '../../dist/duckingGain.js';

function buildSineWav({ freq, durationSec, sampleRate, amplitude = 0.8 }) {
  const numSamples = Math.round(durationSec * sampleRate);
  const dataSize = numSamples * 2; // 16-bit mono PCM
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * freq * t) * amplitude;
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
  }
  return buffer;
}

function rmsInWindow(channel, sampleRate, startSec, endSec) {
  const startIdx = Math.max(0, Math.floor(startSec * sampleRate));
  const endIdx = Math.min(channel.length, Math.floor(endSec * sampleRate));
  let sum = 0;
  let n = 0;
  for (let i = startIdx; i < endIdx; i++) {
    sum += channel[i] * channel[i];
    n += 1;
  }
  return n ? Math.sqrt(sum / n) : 0;
}

async function main() {
  const results = {};
  const sampleRate = 16000;
  const totalDurationSec = 6;
  const ctx = new OfflineAudioContext(1, Math.round(totalDurationSec * sampleRate), sampleRate);

  const fixtures = {
    'fixture://n-0001.wav': buildSineWav({ freq: 880, durationSec: 0.5, sampleRate }),
    'fixture://n-0002.wav': buildSineWav({ freq: 440, durationSec: 0.3, sampleRate }),
  };
  const fakeFetch = async (url) => {
    const buf = fixtures[url];
    if (!buf) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => buf };
  };

  const warnings = [];
  const track = new NarrationTrack(ctx, { fetchImpl: fakeFetch });
  await track.load(
    [
      { id: 'n-0001', src: 'fixture://n-0001.wav', t: 1.0, gainDb: 0 },
      { id: 'n-0002', src: 'fixture://n-0002.wav', t: 3.0, gainDb: -6 },
      // 契約 §4 の劣化規約チェック: 読めないファイルはこの要素だけ無視され、他は継続する
      { id: 'n-missing', src: 'fixture://does-not-exist.wav', t: 4.5 },
    ],
    totalDurationSec,
    (w) => warnings.push({ kind: w.kind, clipId: w.clipId })
  );

  results.loadedEventCount = track.getEvents().length; // 2 を期待（n-missing はスキップ）
  results.loadedEventIds = track.getEvents().map((e) => e.id);
  results.warnings = warnings;

  track.scheduleFrom(0, ctx.currentTime, ctx.destination);
  const rendered = await ctx.startRendering();
  const channel = rendered.getChannelData(0);

  results.rmsBeforeNarration1 = rmsInWindow(channel, sampleRate, 0.0, 0.9);
  results.rmsDuringNarration1 = rmsInWindow(channel, sampleRate, 1.05, 1.45);
  results.rmsBetweenNarrations = rmsInWindow(channel, sampleRate, 1.6, 2.9);
  results.rmsDuringNarration2 = rmsInWindow(channel, sampleRate, 3.05, 3.25);
  results.rmsAfterNarration2 = rmsInWindow(channel, sampleRate, 3.4, 4.4);

  const intervals = computeDuckIntervals(track.getEvents().map((e) => ({ t: e.t, durationSec: e.durationSec })));
  results.duckGainDuringNarration1 = computeBgmDuckGainDb(intervals, true, 1.2);
  results.duckGainOutside = computeBgmDuckGainDb(intervals, true, 2.5);
  results.duckGainWhenDuckingDisabled = computeBgmDuckGainDb(intervals, false, 1.2);
  results.staticDuckGainDbConst = STATIC_DUCK_GAIN_DB;

  return results;
}

main()
  .then((results) => {
    document.getElementById('out').textContent = JSON.stringify(results, null, 2);
    window.__RESULTS__ = results;
    window.__DONE__ = true;
  })
  .catch((e) => {
    const message = 'ERROR: ' + (e && e.stack ? e.stack : String(e));
    document.getElementById('out').textContent = message;
    window.__ERROR__ = message;
    window.__DONE__ = true;
  });
