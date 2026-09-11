/**
 * 録音（wav）+ ハーネスのフック記録（seek 到達時刻 = onSeek ラップ、断片の予約 = BufferSource.start ラップ）から、
 * スクラブ音（off / on）の遅延・音程一致・音切れ・クリック・CPU・HTTP 要求を出す。実素材（pattern r）は音程解析を使わず
 * クリック / 無音 / 要求だけを見る。
 *
 *  - 音程: 21 ms（1024 サンプル・矩形窓）を 5 ms 刻みで FFT（8192 点ゼロ詰め + 放物線補間）し、本編帯（400〜900 Hz）と
 *    BGM 帯（100〜220 Hz）それぞれのピーク周波数を半音インデックスへ写す（本編 440·2^(k/12)、BGM 110·2^(k/12)。2 帯は 2 オクターブ離れており漏れ込まない）
 *  - 一致（手順 5）: seek i の到達 a_i から 300 ms 以内に、期待する半音（floor(t) mod 12）±1 半音の音が本編帯に出れば「確認」
 *  - 遅延: 期待半音が直前の seek と変わる seek について、到達後に期待半音と**完全一致**する最初のフレーム（窓の中心）までの ms。p50 / p95
 *  - 音切れ: 駆動区間 [最初の seek, 最後の seek + 50 ms] のうち RMS < 0.01 の 5 ms フレームの割合と、10 ms 以上の無音区間数
 *  - クリック: 隣接サンプルの差 |Δ| > 0.2（正規化）の個数。純音 ≤ 900 Hz・振幅 0.5 では |Δ| ≤ 0.06 なので、それ以上は不連続
 *  - CPU: ps の累積 CPU 時間の差分 / 経過時間（role 別: renderer / gpu / audio-service / browser-main / preview-server）
 *
 * 検証専用スクリプト（製品コードではない・ラッパーが検証のために書いた）。
 */
import fs from 'node:fs';
import path from 'node:path';

const WINDOW = 1024;
const HOP = 240; // 5 ms @ 48 kHz
const FFT_N = 8192;
const MAIN_BASE = 440;
const BGM_BASE = 110;
const MAIN_BAND = [400, 900];
const BGM_BAND = [100, 225];
const MAIN_AMP_THRESHOLD = 0.08;
const BGM_AMP_THRESHOLD = 0.06;
const CONFIRM_WINDOW_SEC = 0.30;
const STALE_LOOKBACK_SEC = 0.25;
const SILENCE_RMS = 0.01;
const CLICK_DELTA = 0.2;

function readWavMono16(file) {
  const buf = fs.readFileSync(file);
  const sampleRate = buf.readUInt32LE(24);
  const dataLen = buf.readUInt32LE(40);
  const n = Math.min(dataLen / 2, (buf.length - 44) / 2) | 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(44 + i * 2) / 32768;
  return { sampleRate, samples: out };
}

// 反復 radix-2 FFT（実数入力）。
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function bandPeak(mag, sampleRate, [lo, hi]) {
  const binHz = sampleRate / FFT_N;
  const b0 = Math.ceil(lo / binHz); const b1 = Math.floor(hi / binHz);
  let best = b0; let bestV = -1;
  for (let b = b0; b <= b1; b++) if (mag[b] > bestV) { bestV = mag[b]; best = b; }
  // 放物線補間（log 振幅）。
  const l = Math.log(mag[best - 1] + 1e-12); const c = Math.log(mag[best] + 1e-12); const r = Math.log(mag[best + 1] + 1e-12);
  const denom = l - 2 * c + r;
  const delta = denom !== 0 ? 0.5 * (l - r) / denom : 0;
  const freq = (best + delta) * binHz;
  const amp = (mag[best] * 2) / WINDOW; // 矩形窓・純音の振幅近似
  return { freq, amp };
}

export function pitchTrack(samples, sampleRate) {
  const frames = [];
  const re = new Float64Array(FFT_N); const im = new Float64Array(FFT_N);
  const mag = new Float64Array(FFT_N / 2);
  for (let start = 0; start + WINDOW <= samples.length; start += HOP) {
    re.fill(0); im.fill(0);
    let sum2 = 0;
    for (let i = 0; i < WINDOW; i++) { const s = samples[start + i]; re[i] = s; sum2 += s * s; }
    const rms = Math.sqrt(sum2 / WINDOW);
    fft(re, im);
    for (let b = 0; b < FFT_N / 2; b++) mag[b] = Math.hypot(re[b], im[b]);
    const main = bandPeak(mag, sampleRate, MAIN_BAND);
    const bgm = bandPeak(mag, sampleRate, BGM_BAND);
    frames.push({
      t: (start + WINDOW / 2) / sampleRate, rms,
      main: { ...main, k: Math.round(12 * Math.log2(main.freq / MAIN_BASE)), on: main.amp >= MAIN_AMP_THRESHOLD },
      bgm: { ...bgm, k: Math.round(12 * Math.log2(bgm.freq / BGM_BASE)), on: bgm.amp >= BGM_AMP_THRESHOLD },
    });
  }
  return frames;
}

const mod12 = k => ((k % 12) + 12) % 12;
const circDist = (a, b) => { const d = Math.abs(mod12(a) - mod12(b)); return Math.min(d, 12 - d); };
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1));
  return sorted[idx];
};
const round = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? null : +Number(v).toFixed(d));

function analyzeRunEntry(run, evidenceDir) {
  const { sampleRate, samples } = readWavMono16(path.join(evidenceDir, run.wav));
  const rec0 = run.recording.firstFrame / sampleRate; // 録音サンプル 0 の audioContext 時刻
  const frames = pitchTrack(samples, sampleRate).map(f => ({ ...f, ctx: rec0 + f.t }));
  const seeks = (run.stats.seeks ?? []).filter(s => Number.isFinite(s.arrivedCtxSec));
  const expected = seeks.map(s => ({
    ...s,
    kMain: mod12(Math.floor(s.sourceTime ?? s.outputTime)),
    kBgm: mod12(Math.floor(Number.isFinite(s.bgmOffsetSec) ? s.bgmOffsetSec : s.outputTime)),
  }));
  const firstArrival = expected[0]?.arrivedCtxSec ?? rec0;
  const lastArrival = expected.at(-1)?.arrivedCtxSec ?? rec0;
  const driven = frames.filter(f => f.ctx >= firstArrival && f.ctx <= lastArrival + 0.05);

  // 手順 5: 各 seek の期待音程が 300 ms 以内に本編帯 / BGM 帯へ出たか（±1 半音）。
  let confirmedMain = 0; let confirmedBgm = 0;
  const latencyRec = []; const latencyBgmRec = [];
  for (let i = 0; i < expected.length; i++) {
    const s = expected[i];
    const win = frames.filter(f => f.ctx >= s.arrivedCtxSec && f.ctx <= s.arrivedCtxSec + CONFIRM_WINDOW_SEC);
    if (win.some(f => f.main.on && circDist(f.main.k, s.kMain) <= 1)) confirmedMain++;
    if (win.some(f => f.bgm.on && circDist(f.bgm.k, s.kBgm) <= 1)) confirmedBgm++;
    const pitchChanged = i === 0 || expected[i - 1].kMain !== s.kMain;
    if (pitchChanged) {
      const first = win.find(f => f.main.on && mod12(f.main.k) === s.kMain);
      latencyRec.push(first ? (first.ctx - s.arrivedCtxSec) * 1000 : Infinity);
      const firstBgm = win.find(f => f.bgm.on && mod12(f.bgm.k) === s.kBgm);
      latencyBgmRec.push(firstBgm ? (firstBgm.ctx - s.arrivedCtxSec) * 1000 : Infinity);
    }
  }
  // フレームごとの「古い音」判定: 直近 250 ms の seek が期待する音程のどれにも一致しない可聴フレーム。
  let audibleMain = 0; let staleMain = 0;
  for (const f of driven) {
    if (!f.main.on) continue;
    audibleMain++;
    const recent = expected.filter(s => s.arrivedCtxSec <= f.ctx && f.ctx - s.arrivedCtxSec <= STALE_LOOKBACK_SEC);
    if (!recent.some(s => circDist(f.main.k, s.kMain) <= 1)) staleMain++;
  }
  // 音切れ・無音区間。
  let silentFrames = 0; let gapCount = 0; let gapRun = 0;
  for (const f of driven) {
    if (f.rms < SILENCE_RMS) { silentFrames++; gapRun++; if (gapRun === 2) gapCount++; } else gapRun = 0;
  }
  // クリック。
  let clicks = 0; let maxDelta = 0;
  const from = Math.max(1, Math.floor((firstArrival - rec0) * sampleRate));
  const to = Math.min(samples.length, Math.ceil((lastArrival + 0.1 - rec0) * sampleRate));
  for (let i = from; i < to; i++) { const d = Math.abs(samples[i] - samples[i - 1]); if (d > maxDelta) maxDelta = d; if (d > CLICK_DELTA) clicks++; }
  let peak = 0; let sum2 = 0;
  for (let i = from; i < to; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; sum2 += samples[i] * samples[i]; }
  // アプリ側の自己申告。
  const appLatency = seeks.filter(s => Number.isFinite(s.mainStartedCtxSec) && s.mainStartedCtxSec >= s.arrivedCtxSec).map(s => (s.mainStartedCtxSec - s.arrivedCtxSec) * 1000);
  const seekComplete = seeks.map(s => s.seekCompleteMs).filter(Number.isFinite);
  const decodeMs = seeks.map(s => s.decodeMs).filter(Number.isFinite);
  const fetchMs = seeks.map(s => s.fetchMs).filter(Number.isFinite);
  const bytes = seeks.map(s => s.bytes).filter(Number.isFinite);
  const cacheHits = seeks.filter(s => s.cacheHit === true).length;
  const skippedReasons = {};
  for (const s of seeks) if (s.skipped) skippedReasons[s.skipped] = (skippedReasons[s.skipped] ?? 0) + 1;
  const errors = seeks.filter(s => s.error).map(s => s.error);
  // CPU: run-l1.mjs が role 別に集計済み（累積 CPU 時間の差分 / 経過時間）。旧形式（生サンプル配列）も受ける。
  let cpu = {};
  if (Array.isArray(run.cpu)) {
    const byPid = new Map();
    for (const sample of run.cpu) { if (!byPid.has(sample.pid)) byPid.set(sample.pid, []); byPid.get(sample.pid).push(sample); }
    for (const list of byPid.values()) {
      if (list.length < 2) continue;
      const first = list[0]; const last = list.at(-1);
      const wall = (last.t - first.t) / 1000;
      if (wall <= 0) continue;
      const pct = ((last.cpuSec - first.cpuSec) / wall) * 100;
      const role = first.role;
      cpu[role] = cpu[role] ?? { pct: 0, psMax: 0, pids: 0 };
      cpu[role].pct += pct;
      cpu[role].psMax = Math.max(cpu[role].psMax, ...list.map(s => s.cpuPct));
      cpu[role].pids++;
    }
    for (const role of Object.keys(cpu)) { cpu[role].pct = round(cpu[role].pct, 1); cpu[role].psMax = round(cpu[role].psMax, 1); }
  } else cpu = run.cpu ?? {};
  // 断片の長さ（BufferSource.start の duration）と復号窓の長さ。4 パケット窓なら断片は常に 40 ms のはず。
  const fragmentDur = seeks.map(s => s.mainDurationSec).filter(Number.isFinite).map(v => v * 1000);
  const windowDur = seeks.map(s => s.windowSec).filter(Number.isFinite).map(v => v * 1000);
  const isReal = run.pattern === 'r';
  const finite = list => list.filter(Number.isFinite);
  return {
    id: run.id, mode: run.mode, pattern: run.pattern, label: run.label, wav: run.wav, ticks: run.ticks, tickHz: run.tickHz ?? null,
    seeksRecorded: seeks.length,
    played: run.stats.summary?.played ?? null, skipped: run.stats.summary?.skipped ?? null, skippedReasons, errors: errors.slice(0, 5), errorCount: errors.length,
    recording: { sampleRate, seconds: round(samples.length / sampleRate, 2), gaps: run.recording.gaps?.length ?? 0, peak: round(peak, 3), rms: round(Math.sqrt(sum2 / Math.max(1, to - from)), 3), stateAtEnd: run.recording.stateAtEnd },
    isReal,
    lastError: run.stats.lastError ?? null,
    pitch: isReal ? null : {
      mainConfirmed: confirmedMain, bgmConfirmed: confirmedBgm, total: expected.length,
      mainConfirmRate: round(expected.length ? confirmedMain / expected.length * 100 : null, 1),
      bgmConfirmRate: round(expected.length ? confirmedBgm / expected.length * 100 : null, 1),
      audibleFrames: audibleMain, staleFrames: staleMain, staleRate: round(audibleMain ? staleMain / audibleMain * 100 : null, 1),
    },
    fragment: { n: fragmentDur.length, durationP50Ms: round(percentile(fragmentDur, 50)), durationMinMs: round(fragmentDur.length ? Math.min(...fragmentDur) : null), windowP50Ms: round(percentile(windowDur, 50)) },
    latencyMs: {
      recorded: isReal ? { n: 0, found: 0, p50: null, p95: null, max: null } : { n: latencyRec.length, found: finite(latencyRec).length, p50: round(percentile(finite(latencyRec), 50)), p95: round(percentile(finite(latencyRec), 95)), max: round(finite(latencyRec).length ? Math.max(...finite(latencyRec)) : null) },
      recordedBgm: isReal ? { n: 0, found: 0, p50: null, p95: null } : { n: latencyBgmRec.length, found: finite(latencyBgmRec).length, p50: round(percentile(finite(latencyBgmRec), 50)), p95: round(percentile(finite(latencyBgmRec), 95)) },
      appReported: { n: appLatency.length, p50: round(percentile(appLatency, 50)), p95: round(percentile(appLatency, 95)) },
      seekComplete: { n: seekComplete.length, p50: round(percentile(seekComplete, 50)), p95: round(percentile(seekComplete, 95)) },
      decode: { n: decodeMs.length, p50: round(percentile(decodeMs, 50), 2), p95: round(percentile(decodeMs, 95), 2) },
      fetch: { n: fetchMs.length, p50: round(percentile(fetchMs, 50), 2), p95: round(percentile(fetchMs, 95), 2), bytesTotal: bytes.reduce((a, b) => a + b, 0), cacheHits },
    },
    continuity: {
      silenceRate: round(driven.length ? silentFrames / driven.length * 100 : null, 1), gaps10ms: gapCount, clicks, maxSampleDelta: round(maxDelta, 3),
      // 素材照合（run-l1.mjs の clickCheck）: 素材の同じ位置に同等以上の隣接差があるものは素材由来（声の過渡）。artifact = 素材に無い不連続。
      clicksInSource: Array.isArray(run.clickCheck) ? run.clickCheck.filter(c => c.inSource).length : null,
      artifactClicks: Array.isArray(run.clickCheck) ? run.clickCheck.filter(c => !c.inSource).length : clicks,
      clickDetails: Array.isArray(run.clickCheck) ? run.clickCheck.slice(0, 20) : [],
    },
    cpu,
    network: run.network?.summary ?? null,
  };
}

export function analyzeRun(report, evidenceDir) {
  const runs = report.runs.map(run => analyzeRunEntry(run, evidenceDir));
  return {
    analyzedAt: new Date().toISOString(),
    host: report.host, electron: report.electron, page: report.page, tickHz: report.tickHz, fragmentMs: report.fragmentMs,
    fixture: { kind: report.fixture.kind ?? 'synthetic', ffprobe: report.fixture.ffprobe, original: report.fixture.original ?? null, mainTableHz: report.fixture.mainTableHz ?? null, bgmTableHz: report.fixture.bgmTableHz ?? null, commands: report.fixture.commands, edit: report.fixture.edit },
    networkAtOpen: report.networkAtOpen?.summary ?? null, idleSuspend: report.idleSuspend ?? null,
    method: { window: WINDOW, hop: HOP, fftN: FFT_N, confirmWindowSec: CONFIRM_WINDOW_SEC, staleLookbackSec: STALE_LOOKBACK_SEC, silenceRms: SILENCE_RMS, clickDelta: CLICK_DELTA, mainAmpThreshold: MAIN_AMP_THRESHOLD, bgmAmpThreshold: BGM_AMP_THRESHOLD },
    projectCache: report.projectCache, cleanup: report.cleanup, networkAll: report.networkAll ?? null,
    failedRuns: report.failedRuns ?? [], runs,
  };
}

export function writeSummaryMarkdown(analysis, file) {
  const lines = [];
  lines.push(`# preview scrub audio — L1 実測サマリ（${analysis.fixture?.kind === 'real' ? '実素材' : '合成純音'}・機械生成: scripts/analyze.mjs）`, '');
  lines.push(`- 実行: ${analysis.analyzedAt} / Electron ${analysis.electron?.version} / ${analysis.host?.model} ${analysis.host?.cpus} cores ${analysis.host?.memGb} GB / Node ${analysis.host?.node}`);
  lines.push(`- seek 30 Hz・断片 ${analysis.fragmentMs} ms・AudioContext ${analysis.page?.sampleRate} Hz（baseLatency ${round(analysis.page?.baseLatency * 1000, 1)} ms / outputLatency ${round(analysis.page?.outputLatency * 1000, 1)} ms）`);
  lines.push('');
  lines.push('| run | mode | pattern | 遅延 p50 / p95 ms（録音） | アプリ予約 p50 / p95 | 音程一致 本編 / BGM | 古い音 % | 無音 % / 10ms 途切れ | クリック 総数 / 素材由来 / artifact（最大 Δ） | 断片長 p50 / min ms（窓） | renderer / gpu / audio CPU % | played / skipped | lastError |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of analysis.runs) {
    const c = r.cpu;
    const p = r.pitch;
    lines.push(`| ${r.id} | ${r.mode} | ${r.pattern}${r.tickHz && r.tickHz !== analysis.tickHz ? ` (${r.tickHz} Hz)` : ''} | ${r.latencyMs.recorded.p50 ?? '–'} / ${r.latencyMs.recorded.p95 ?? '–'}${r.isReal ? '' : ` (${r.latencyMs.recorded.found}/${r.latencyMs.recorded.n})`} | ${r.latencyMs.appReported.p50 ?? '–'} / ${r.latencyMs.appReported.p95 ?? '–'} | ${p ? `${p.mainConfirmRate ?? '–'}% / ${p.bgmConfirmRate ?? '–'}%` : '–（実素材）'} | ${p ? (p.staleRate ?? '–') : '–'} | ${r.continuity.silenceRate ?? '–'} / ${r.continuity.gaps10ms} | ${r.continuity.clicks} / ${r.continuity.clicksInSource ?? '–'} / **${r.continuity.artifactClicks}** (${r.continuity.maxSampleDelta}) | ${r.fragment.durationP50Ms ?? '–'} / ${r.fragment.durationMinMs ?? '–'} (${r.fragment.windowP50Ms ?? '–'}) | ${c.renderer?.pct ?? '–'} / ${c.gpu?.pct ?? '–'} / ${c['audio-service']?.pct ?? '–'} | ${r.played} / ${r.skipped} | ${r.lastError ?? '–'} |`);
  }
  lines.push('');
  lines.push('- 遅延（録音）= seek 到達（ページ側 audioContext.currentTime・onSeek ラップで記録）→ 期待半音と完全一致する最初の 21 ms 分析窓の中心。期待半音が直前の seek と変わる seek だけを数える（found / n）。アプリ予約 = 到達 → 本編断片の BufferSource.start(when) の差');
  lines.push('- 音程一致 = seek 到達から 300 ms 以内に期待半音 ±1 の音が出た seek の割合（手順 5）。古い音 = 可聴フレームのうち直近 250 ms のどの seek の音程にも合わないもの');
  lines.push('- 無音 % = 駆動区間の 5 ms フレームのうち RMS < 0.01。クリック = 隣接サンプル差 > 0.2 の個数（純音の最大差は 0.06）。素材由来 = 素材（ffmpeg で 48 kHz mono に復号した参照）の同じ位置 ±2 ms に同等以上（差 −0.05 まで）の隣接差があるもの（声の過渡）。artifact = 素材に無い不連続 = 断片の継ぎ目で生じたクリック');
  lines.push('');
  lines.push('| run | HTTP 要求 合計 | media Range 取得（fetch / media 要素） | media 全量取得 | moov 相当（fetch Range > 8 KB） | preview-audio API | sidecar .pcm | その他 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  const openN = analysis.networkAtOpen ?? {};
  lines.push(`| （開いた時〜ready） | ${openN.total ?? '–'} | ${openN.mediaRange ?? '–'} (${openN.mediaRangeFetch ?? '–'} / ${openN.mediaRangeMediaElement ?? '–'}) | ${openN.mediaFull ?? '–'} | ${openN.moovFetch ?? '–'} | ${openN.previewAudioApi ?? '–'} | ${openN.sidecarPcm ?? '–'} | ${openN.other ?? '–'} |`);
  for (const r of analysis.runs) {
    const n = r.network ?? {};
    lines.push(`| ${r.id} | ${n.total ?? '–'} | ${n.mediaRange ?? '–'} (${n.mediaRangeFetch ?? '–'} / ${n.mediaRangeMediaElement ?? '–'}) | ${n.mediaFull ?? '–'} | ${n.moovFetch ?? '–'} | ${n.previewAudioApi ?? '–'} | ${n.sidecarPcm ?? '–'} | ${n.other ?? '–'} |`);
  }
  const all = analysis.networkAll?.summary ?? {};
  lines.push(`| **全体（開いた時〜終了）** | ${all.total ?? '–'} | ${all.mediaRange ?? '–'} (${all.mediaRangeFetch ?? '–'} / ${all.mediaRangeMediaElement ?? '–'}) | ${all.mediaFull ?? '–'} | ${all.moovFetch ?? '–'} | ${all.previewAudioApi ?? '–'} | ${all.sidecarPcm ?? '–'} | ${all.other ?? '–'} |`);
  lines.push('');
  lines.push('- HTTP 要求 = webview が出した要求（CDP Network.requestWillBeSent）。media Range = `/assets/*.mp4|m4a` への `Range:` 付き要求（fetch = スクラブ音の moov / 断片取得、media 要素 = `<video>` の部分取得）。moov 相当 = fetch 由来で 8 KB を超える Range（断片は約 1.3 KB・box ヘッダ探索は 16 B）。src ごとに 1 回なら全体で 1。sidecar .pcm / preview-audio API が 0 なら前処理の産物に触っていない');
  if (analysis.networkAll?.moovFetches?.length) lines.push(`- moov 取得の実体: ${analysis.networkAll.moovFetches.map(m => `${m.path} ${m.range} (@${m.at} ms)`).join(' / ')}`);
  if (analysis.idleSuspend) lines.push(`- idle suspend（seek 後 ${30} s）: 1 s 後 state=${analysis.idleSuspend.stateAfter1s} → 33 s 後 state=${analysis.idleSuspend.stateAfter33s}、suspend 呼び出し ${analysis.idleSuspend.suspendCalled ? `あり（seek から ${analysis.idleSuspend.suspendAfterSeekMs} ms）` : 'なし'}、次の seek で resume ${analysis.idleSuspend.wake?.resumeCalled ? 'あり' : 'なし'} → state=${analysis.idleSuspend.wake?.stateAfterSeek}（断片 start ${analysis.idleSuspend.wake?.starts} 件）`);
  if (analysis.failedRuns?.length) lines.push(`- **失敗した run**: ${analysis.failedRuns.map(f => `${f.id} (${f.error.split('\n')[0].slice(0, 120)})`).join(' / ')}`);
  lines.push(`- 後始末: ${JSON.stringify(analysis.cleanup)}`);
  lines.push(`- プロジェクト配下キャッシュ（前処理の有無）: ${JSON.stringify(analysis.projectCache?.entries ?? [])}`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

// 単体で: node analyze.mjs <l1-raw.json>
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1])) && process.argv[2]) {
  const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const dir = path.dirname(path.resolve(process.argv[2]));
  const analysis = analyzeRun(raw, dir);
  fs.writeFileSync(path.join(dir, 'l1-results.json'), `${JSON.stringify(analysis, null, 2)}\n`);
  writeSummaryMarkdown(analysis, path.join(dir, 'l1-summary.md'));
  console.log(fs.readFileSync(path.join(dir, 'l1-summary.md'), 'utf8'));
}
