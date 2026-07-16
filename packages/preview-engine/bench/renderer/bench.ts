// PreviewEngine (E1〜E5) 計測ベンチ — renderer
// lab/webcodecs-spike/renderer/app.js の計測手法（percentile/uiLog/scrub/concat/gop-edge/memory）を
// 再利用しつつ、直接 WebCodecs/MP4Clip を叩く代わりに packages/preview-engine の公開・準公開 API を通す。
import { PreviewEngine, ClipSession, type EngineWarningEvent, type FrameEvent } from '../../src/index.js';

declare global {
  interface Window {
    bench: {
      log(msg: string): Promise<void>;
      screenshot(name: string): Promise<string>;
      sysmetrics(label: string): Promise<unknown>;
      results(json: unknown): Promise<void>;
      quit(): Promise<void>;
    };
  }
}

const canvas = document.getElementById('cv') as HTMLCanvasElement;
const logEl = document.getElementById('log')!;

function uiLog(msg: string): void {
  const line = `[${(performance.now() / 1000).toFixed(2)}s] ${msg}`;
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  void window.bench.log(line);
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function stats(latencies: number[]) {
  return {
    n: latencies.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length ? Math.max(...latencies) : 0,
    min: latencies.length ? Math.min(...latencies) : 0,
  };
}

// --- スパイク実測値（非公開の内部スパイク実測値より転記。前後比較の基準値） ---
const SPIKE_BASELINE = {
  seekP95Ms: {
    h264_4k_hw: 1268.6,
    hevc_4k_hw: 3219.8,
    fieldtest_1080p_hw: 140.7,
  },
  scrubForwardOnly: { updateRateHz: 78.3, stutterCount: 1, totalSteps: 90 },
  concatBoundaryFirstTickMs: 857.6,
  memoryPeakRendererMB: 585.5,
  memoryBaselineRendererMB: 104.8,
  memoryAfterDestroyRendererMB: 103.2,
  gopFlushLastFrameBug: true, // hasVideo:false を再現済み（クランプ無し時）
  aacInfiniteRetryHang: true, // audio:true 読み込みで tick() が永久に解決しない
};

const warnings: EngineWarningEvent[] = [];
function collectWarning(w: EngineWarningEvent): void {
  warnings.push(w);
  uiLog(`[warning] kind=${w.kind} clip=${w.clipId} msg=${w.message}`);
}

const SRC_A = 'bench://testsrc/4k_h264_longgop_a.mp4';
const SRC_B = 'bench://testsrc/4k_h264_longgop_b.mp4';
const SRC_HEVC = 'bench://testsrc/4k_hevc_longgop.mp4';
const SRC_1080 = 'bench://testsrc/source_1080p_fieldtest.mov';

const SESSION_OPTS = { loadTimeoutMs: 4000, tickTimeoutMs: 4000, tailMarginUs: Math.round((1e6 / 30) * 2) };
// スパイクとの apples-to-apples 比較用（Test1）は tick タイムアウトを緩める。
// スパイクは無制限で計測しており、E4 の 4000ms ガード（製品向けの既定値）を baseline 比較に
// 混ぜると「ガードが発火して打ち切られた分」が本来の分布を歪める（実測で HEVC が
// 4000ms 付近でちょうど1件ガード発火するのを確認）。E4 自体の挙動は Test6a/7 で別途検証する。
const BASELINE_SESSION_OPTS = { loadTimeoutMs: 4000, tickTimeoutMs: 8000, tailMarginUs: Math.round((1e6 / 30) * 2) };

// ============================================================
// Test 1: ベースライン再現（E1 無し = exact tick のみ、スパイクと同一手法で n=50 ランダムシーク）
// ============================================================
async function seekBenchmark(
  session: ClipSession,
  durationUs: number,
  n: number,
  label: string
): Promise<{ label: string; n: number; framesReturned: number; p50: number; p95: number; max: number; min: number }> {
  const marginUs = 0.5e6;
  const lo = marginUs;
  const hi = Math.max(marginUs, durationUs - marginUs);
  const points: number[] = [];
  for (let i = 0; i < n; i++) points.push(lo + Math.random() * (hi - lo));
  const latencies: number[] = [];
  let framesReturned = 0;
  for (const t of points) {
    const t0 = performance.now();
    const ret = await session.tickExact(Math.floor(t));
    const t1 = performance.now();
    latencies.push(t1 - t0);
    if (ret.video) {
      framesReturned++;
      canvas.getContext('2d')!.drawImage(ret.video, 0, 0, canvas.width, canvas.height);
      ret.video.close();
    }
  }
  const s = stats(latencies);
  uiLog(`[seek:${label}] n=${n} framesOk=${framesReturned}/${n} p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms min=${s.min.toFixed(1)}ms`);
  return { label, framesReturned, ...s };
}

async function test1_baselineSeek() {
  uiLog('=== Test1: exact-tick baseline (E1無効相当、スパイクと同一手法n=50) ===');
  const out: Record<string, unknown> = {};

  const clipA = new ClipSession('t1-h264', SRC_A, BASELINE_SESSION_OPTS, collectWarning);
  const t0 = performance.now();
  await clipA.load();
  const loadMs = performance.now() - t0;
  out.h264LoadMs = loadMs;
  out.h264_4k_hw = await seekBenchmark(clipA, clipA.meta!.duration, 50, 'h264-4k-exact');
  await window.bench.screenshot('t1-01-h264-seek');
  clipA.destroy();

  const clipHevc = new ClipSession('t1-hevc', SRC_HEVC, BASELINE_SESSION_OPTS, collectWarning);
  const t1 = performance.now();
  await clipHevc.load();
  out.hevcLoadMs = performance.now() - t1;
  out.hevc_4k_hw = await seekBenchmark(clipHevc, clipHevc.meta!.duration, 50, 'hevc-4k-exact');
  await window.bench.screenshot('t1-02-hevc-seek');
  clipHevc.destroy();

  const clip1080 = new ClipSession('t1-1080', SRC_1080, BASELINE_SESSION_OPTS, collectWarning);
  await clip1080.load();
  out.fieldtest_1080p_hw = await seekBenchmark(clip1080, clip1080.meta!.duration, 30, 'fieldtest-1080p-exact');
  clip1080.destroy();

  return out;
}

// ============================================================
// Test 2: E1 スクラブドラッグ再現（30Hz throttle 通過後の実測 Hz / stutter）
// 入力側は高頻度（~200Hz相当、5ms間隔）でランダム/往復スイープする「実ドラッグ」を模擬し、
// スパイクの「順方向1フレーム刻み」より意地悪な「広域スイープ」で E1 の効果を測る。
// ============================================================
async function test2_scrubDragTimed() {
  uiLog('=== Test2: E1 tolerance scrub (wide sweep drag simulation, 4K H.264 HW) ===');
  const engine = new PreviewEngine();
  const arrivals: { t: number; tickMs: number; approx: boolean }[] = [];
  const off = engine.on('frame', (f) => {
    if (f.approx) arrivals.push({ t: performance.now(), tickMs: f.tickMs, approx: f.approx });
  });

  await engine.loadTimeline({
    fps: 30,
    clips: [{ id: 'a', src: SRC_A, startFrame: 0, endFrame: 20 * 30, track: 0, mediaType: 'video' }],
  });

  const sweepStartFrame = 60;
  const sweepRangeFrames = 150;
  const wallDurationMs = 4000;
  const inputIntervalMs = 5;
  const t0 = performance.now();
  let inputCount = 0;
  while (performance.now() - t0 < wallDurationMs) {
    const elapsed = performance.now() - t0;
    const phase = (elapsed / 700) * Math.PI * 2;
    const frame = Math.round(sweepStartFrame + (Math.sin(phase) * 0.5 + 0.5) * sweepRangeFrames);
    inputCount++;
    void engine.seek(frame, 'interactiveScrub');
    await new Promise((r) => setTimeout(r, inputIntervalMs));
  }
  await new Promise((r) => setTimeout(r, 250));
  await window.bench.screenshot('t2-01-scrub-sweep');
  off();

  const renderCount = arrivals.length;
  const wallMs = arrivals.length >= 2 ? (arrivals[arrivals.length - 1]!.t - arrivals[0]!.t) : wallDurationMs;
  const updateRateHz = wallMs > 0 ? (renderCount - 1) / (wallMs / 1000) : 0;
  const gaps: number[] = [];
  for (let i = 1; i < arrivals.length; i++) gaps.push(arrivals[i]!.t - arrivals[i - 1]!.t);
  const stutterCount = gaps.filter((g) => g > 100).length;
  const tickMsList = arrivals.map((a) => a.tickMs);
  const tickStats = stats(tickMsList);

  uiLog(
    `[scrub:E1] inputCount=${inputCount} renderedApproxFrames=${renderCount} updateRateHz=${updateRateHz.toFixed(1)} stutters(gap>100ms)=${stutterCount} tickMs p50=${tickStats.p50.toFixed(1)} p95=${tickStats.p95.toFixed(1)}`
  );

  return { engine, inputCount, renderCount, updateRateHz, stutterCount, tickStats, lastFrame: sweepStartFrame };
}

// ============================================================
// Test 3: リリース後 exact 解決レイテンシ（E1→E2 の release 挙動、目安 ≤300ms）
// ============================================================
async function test3_releaseExact(engine: PreviewEngine) {
  uiLog('=== Test3: release -> exact resolve latency (target <=300ms 目安) ===');
  const latencies: number[] = [];
  const arrivals: { frame: number; approx: boolean; tickMs: number }[] = [];
  const off = engine.on('frame', (f) => arrivals.push({ frame: f.frame, approx: f.approx, tickMs: f.tickMs }));

  for (let i = 0; i < 15; i++) {
    const frame = 60 + Math.floor(Math.random() * 150);
    const t0 = performance.now();
    await engine.seek(frame, 'exact');
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }
  off();
  const s = stats(latencies);
  uiLog(`[release-exact] n=${latencies.length} p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms max=${s.max.toFixed(1)}ms`);
  return s;
}

// ============================================================
// Test 4: E2 先読みキャッシュ命中（小ジャンプ）
// ============================================================
async function test4_lookaheadCache() {
  uiLog('=== Test4: E2 lookahead cache hit (small forward jump) ===');
  const engine = new PreviewEngine();
  const arrivals: FrameEvent[] = [];
  const off = engine.on('frame', (f) => arrivals.push(f));
  await engine.loadTimeline({
    fps: 30,
    clips: [{ id: 'a', src: SRC_A, startFrame: 0, endFrame: 20 * 30, track: 0, mediaType: 'video' }],
  });
  // 基準点へ exact seek（prefetchForward が走り、直後数フレームがキャッシュされる）
  await engine.seek(300, 'exact');
  await new Promise((r) => setTimeout(r, 300)); // prefetch の完了待ち
  arrivals.length = 0;
  // +1, +2 フレームの小ジャンプ（キャッシュ命中を期待）
  const t0 = performance.now();
  await engine.seek(301, 'exact');
  const hit1Ms = performance.now() - t0;
  const t1 = performance.now();
  await engine.seek(302, 'exact');
  const hit2Ms = performance.now() - t1;
  // 遠方ジャンプ（キャッシュ非命中の対照。クリップ範囲内[0,600)に収める — 範囲外は
  // Timeline.resolve()がnullを返しノーオペになり「0ms」という偽の高速値になるバグを実測で発見）
  const t2 = performance.now();
  await engine.seek(500, 'exact');
  const missMs = performance.now() - t2;
  off();
  uiLog(`[E2] hit(+1)=${hit1Ms.toFixed(1)}ms hit(+2)=${hit2Ms.toFixed(1)}ms miss(far)=${missMs.toFixed(1)}ms`);
  engine.dispose();
  return { hit1Ms, hit2Ms, missMs };
}

// ============================================================
// Test 5: E3 カット点ウォームアップ（連結境界の初 tick コスト、対 857.6ms）
// ============================================================
async function test5_concatWarmup() {
  uiLog('=== Test5: E3 cut-point warmup (concat boundary first-tick cost) ===');
  const engine = new PreviewEngine({ warmupLeadInSec: 0.75 });
  const frameArrivals: FrameEvent[] = [];
  const warmupEvents: { clipId: string; tookMs: number }[] = [];
  const offFrame = engine.on('frame', (f) => frameArrivals.push(f));
  const offWarmup = engine.on('warmup', (w) => {
    warmupEvents.push({ clipId: w.clipId, tookMs: w.tookMs });
    uiLog(`[warmup] clip=${w.clipId} tookMs=${w.tookMs.toFixed(1)}`);
  });

  // clipA: 40% で終端カット、clipB: 60% から開始（スパイクと同一カット点）
  const clipADurFrames = 20 * 30; // 概算(実長はロード後に確定するが、フレーム番号ベースで運用するため近似値でOK)
  const cutFrame = Math.floor(clipADurFrames * 0.4);
  const bClipLenFrames = Math.floor(clipADurFrames * 0.4); // B は 60%地点から全区間ぶん割り当て
  const timeline = {
    fps: 30,
    clips: [
      { id: 'a', src: SRC_A, startFrame: 0, endFrame: cutFrame, track: 0, mediaType: 'video' as const },
      {
        id: 'b',
        src: SRC_B,
        startFrame: cutFrame,
        endFrame: cutFrame + bClipLenFrames,
        sourceInUs: Math.floor(clipADurFrames * 0.6 * (1e6 / 30)),
        track: 0,
        mediaType: 'video' as const,
      },
    ],
  };
  await engine.loadTimeline(timeline);

  // カット点の1.5秒手前から境界+10フレームまで、exact seek で1フレームずつ進める
  // （warmup が secondsToBoundary<=leadIn で発火するのを実測するため、順再生に近い形で進行）
  const startFrame = cutFrame - 45; // 1.5s手前
  const endFrame = cutFrame + 10;
  for (let f = startFrame; f <= endFrame; f++) {
    await engine.seek(f, 'exact');
  }
  await window.bench.screenshot('t5-01-concat-boundary');
  offFrame();
  offWarmup();

  const boundaryEvent = frameArrivals.find((f) => f.frame === cutFrame && f.clipId === 'b');
  const preboundary = frameArrivals.filter((f) => f.frame < cutFrame);
  const postboundary = frameArrivals.filter((f) => f.frame >= cutFrame);
  uiLog(
    `[concat] boundaryFrame=${cutFrame} boundaryTickMs=${boundaryEvent?.tickMs.toFixed(1) ?? 'N/A'} warmupFired=${warmupEvents.length > 0}`
  );
  engine.dispose();
  return {
    cutFrame,
    boundaryTickMs: boundaryEvent?.tickMs ?? null,
    warmupEvents,
    preboundaryCount: preboundary.length,
    postboundaryCount: postboundary.length,
  };
}

// ============================================================
// Test 6a: E4a AAC configure 無限リトライ対策（audio:true でロードし、フォールバックを実測）
// ============================================================
async function test6a_aacGuard() {
  uiLog('=== Test6a: E4 AAC infinite-retry guard (load with audio enabled, expect timeout+fallback) ===');
  const localWarnings: EngineWarningEvent[] = [];
  const session = new ClipSession('t6a-aac', SRC_A, SESSION_OPTS, (w) => {
    localWarnings.push(w);
    collectWarning(w);
  });
  const t0 = performance.now();
  let hung = false;
  const watchdog = setTimeout(() => {
    hung = true;
    uiLog('[E4a][WATCHDOG] load did not resolve within 15s — treating as HANG (would confirm spike finding unmitigated)');
  }, 15000);
  try {
    await session.load();
  } catch (e) {
    uiLog(`[E4a] load threw (all fallbacks exhausted): ${String(e)}`);
  }
  clearTimeout(watchdog);
  const tookMs = performance.now() - t0;
  const fallbackFired = localWarnings.some((w) => w.kind === 'audioDecoderFallback');
  uiLog(`[E4a] state=${session.state} tookMs=${tookMs.toFixed(1)} fallbackFired=${fallbackFired} hung=${hung}`);
  // フォールバック後に実際に seek できるか確認（機能的に復旧しているか）
  let postFallbackOk = false;
  if (session.state === 'ready' || session.state === 'degraded') {
    const ret = await session.tickExact(1e6);
    postFallbackOk = !!ret.video;
    ret.video?.close();
  }
  session.destroy();
  return { tookMs, fallbackFired, hung, finalState: session.state, postFallbackOk };
}

// ============================================================
// Test 6b: E4b 末尾 GOP 安全マージン（duration 近傍プローブ、スパイクの gop-edge テストを再現）
// ============================================================
async function test6b_tailMargin() {
  uiLog('=== Test6b: E4 tail GOP safety margin (probe near clip end) ===');
  const session = new ClipSession('t6b-tail', SRC_A, SESSION_OPTS, collectWarning);
  await session.load();
  const duration = session.meta!.duration;
  const kf = session.getKeyframeTimesUs();
  uiLog(`[E4b] keyframeTimesUs (last 6)=${JSON.stringify(kf?.slice(-6))}`);
  const stepUs = Math.round(1e6 / 30);
  const probes = [
    { label: 'clip-last-frame', t: duration - stepUs - 1 },
    { label: 'clip-duration-minus-1us', t: duration - 1 },
    { label: 'clip-at-duration', t: duration },
    // 診断用スイープ: どこまで戻れば末尾GOP破損域を脱するかを実測する
    { label: 'duration-1e6', t: duration - 1e6 },
    { label: 'duration-2e6', t: duration - 2e6 },
    { label: 'duration-3e6', t: duration - 3e6 },
    { label: 'duration-4e6', t: duration - 4e6 },
    { label: 'duration-5e6', t: duration - 5e6 },
    { label: 'duration-8e6', t: duration - 8e6 },
  ];
  const results: { label: string; t: number; hasVideo: boolean; tickMs: number }[] = [];
  for (const p of probes) {
    const ret = await session.tickExact(p.t);
    results.push({ label: p.label, t: p.t, hasVideo: !!ret.video, tickMs: ret.tickMs });
    ret.video?.close();
  }
  session.destroy();
  // allOk の判定対象は「クランプが実際に効くべき」最初の3件のみ（診断用スイープ項目は除く）
  const clampedProbeResults = results.slice(0, 3);
  const allOk = clampedProbeResults.every((r) => r.hasVideo);
  uiLog(`[E4b] duration=${duration}us results=${JSON.stringify(results.map((r) => ({ l: r.label, t: r.t, ok: r.hasVideo })))} allOk=${allOk}`);
  return { duration, keyframeTimesUsTail: kf?.slice(-6) ?? null, results, allOk };
}

// ============================================================
// Test 7: E4c HW セッション同時数 + メモリ非リーク（3〜4本同時、スパイクの手法を拡張）
// ============================================================
async function test7_memoryAndConcurrency() {
  uiLog('=== Test7: memory (3x concurrent 4K, destroy recovery) + HW session stress (4本目) ===');
  await window.bench.sysmetrics('bench-00-baseline');

  const sessions = [
    new ClipSession('t7-a', SRC_A, SESSION_OPTS, collectWarning),
    new ClipSession('t7-b', SRC_B, SESSION_OPTS, collectWarning),
    new ClipSession('t7-c', SRC_HEVC, SESSION_OPTS, collectWarning),
  ];
  await window.bench.sysmetrics('bench-01-before-triple-load');
  await Promise.all(sessions.map((s) => s.load()));
  for (const s of sessions) {
    for (let i = 0; i < 20; i++) {
      const dur = s.meta?.duration ?? 15e6;
      const ret = await s.tickExact(Math.floor(Math.random() * dur));
      ret.video?.close();
    }
  }
  await window.bench.screenshot('t7-01-triple-active');
  await window.bench.sysmetrics('bench-02-triple-active');

  // スパイク未確認事項「4本以上でHWセッション上限に達するか」を実測
  const fourth = new ClipSession('t7-d', SRC_A, SESSION_OPTS, collectWarning);
  let fourthOk = false;
  let fourthError: string | null = null;
  try {
    await fourth.load();
    const ret = await fourth.tickExact(1e6);
    fourthOk = !!ret.video;
    ret.video?.close();
  } catch (e) {
    fourthError = String(e);
  }
  uiLog(`[E4c] 4th concurrent 4K session: ok=${fourthOk} state=${fourth.state} error=${fourthError ?? 'none'}`);
  fourth.destroy();

  for (const s of sessions) s.destroy();
  await new Promise((r) => setTimeout(r, 3000));
  await window.bench.sysmetrics('bench-03-after-destroy');

  return { fourthOk, fourthState: fourth.state, fourthError };
}

// ============================================================
// Test 8: E5 サムネスクラブ表示層
// - 入力→同期サムネ描画レイテンシ
// - 4K long-GOP / 1080p の実フレーム追従Hz
// - スイープ停止後の exact 解決
// ============================================================
async function runE5Sweep(label: string, src: string, settleSamples: number) {
  const engine = new PreviewEngine({
    enableThumbnailScrub: true,
    thumbnailMaxCount: 40,
    thumbnailIntervalSec: 2,
    thumbnailWidth: 160,
  });
  engine.mount(canvas);

  const frameArrivals: { t: number; tickMs: number }[] = [];
  const thumbnailLatencies: number[] = [];
  let thumbnailEventCount = 0;
  let pendingInputAt: number | null = null;
  let collectingSweep = false;
  const offFrame = engine.on('frame', (event) => {
    if (collectingSweep && event.approx) frameArrivals.push({ t: performance.now(), tickMs: event.tickMs });
  });
  const offThumbnail = engine.on('thumbnail', (event) => {
    if (!collectingSweep) return;
    thumbnailEventCount += 1;
    if (pendingInputAt != null) thumbnailLatencies.push(event.drawnAtMs - pendingInputAt);
  });

  await engine.loadTimeline({
    fps: 30,
    clips: [{ id: `e5-${label}`, src, startFrame: 0, endFrame: 20 * 30, track: 0, mediaType: 'video' }],
  });

  // build() は loadTimeline をブロックしない。低優先度の初期生成に短い猶予を与えてから、
  // Test2 と同一の高頻度・広域スイープを開始する。
  const thumbnailWarmupMs = 2500;
  await new Promise((resolve) => setTimeout(resolve, thumbnailWarmupMs));

  const sweepStartFrame = 60;
  const sweepRangeFrames = 150;
  const wallDurationMs = 4000;
  const inputIntervalMs = 5;
  let inputCount = 0;
  collectingSweep = true;
  const sweepStartedAt = performance.now();
  while (performance.now() - sweepStartedAt < wallDurationMs) {
    const elapsed = performance.now() - sweepStartedAt;
    const phase = (elapsed / 700) * Math.PI * 2;
    const frame = Math.round(sweepStartFrame + (Math.sin(phase) * 0.5 + 0.5) * sweepRangeFrames);
    inputCount += 1;
    pendingInputAt = performance.now();
    void engine.seek(frame, 'interactiveScrub');
    pendingInputAt = null;
    await new Promise((resolve) => setTimeout(resolve, inputIntervalMs));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  collectingSweep = false;

  const frameWallMs =
    frameArrivals.length >= 2
      ? frameArrivals[frameArrivals.length - 1]!.t - frameArrivals[0]!.t
      : wallDurationMs;
  const followHz = frameWallMs > 0 ? Math.max(0, frameArrivals.length - 1) / (frameWallMs / 1000) : 0;
  const frameGaps: number[] = [];
  for (let i = 1; i < frameArrivals.length; i++) {
    frameGaps.push(frameArrivals[i]!.t - frameArrivals[i - 1]!.t);
  }
  const thumbStats = stats(thumbnailLatencies);
  const realFrameTickStats = stats(frameArrivals.map((entry) => entry.tickMs));
  const eventCoverage = inputCount > 0 ? thumbnailEventCount / inputCount : 0;

  const settleLatencies: number[] = [];
  for (let i = 0; i < settleSamples; i++) {
    const frame = sweepStartFrame + Math.floor(Math.random() * sweepRangeFrames);
    void engine.seek(frame, 'interactiveScrub');
    await new Promise((resolve) => setTimeout(resolve, 35));
    const t0 = performance.now();
    await engine.seek(frame, 'exact');
    settleLatencies.push(performance.now() - t0);
  }
  const settleStats = stats(settleLatencies);

  uiLog(
    `[E5:${label}] inputs=${inputCount} thumbnailEvents=${thumbnailEventCount} eventCoverage=${(
      eventCoverage * 100
    ).toFixed(1)}% thumbLatency p50=${thumbStats.p50.toFixed(3)}ms p95=${thumbStats.p95.toFixed(
      3
    )}ms realFrames=${frameArrivals.length} followHz=${followHz.toFixed(1)} tick p50=${realFrameTickStats.p50.toFixed(
      1
    )}ms p95=${realFrameTickStats.p95.toFixed(1)}ms settle p50=${settleStats.p50.toFixed(
      1
    )}ms p95=${settleStats.p95.toFixed(1)}ms`
  );

  offFrame();
  offThumbnail();
  engine.dispose();
  return {
    inputCount,
    thumbnailEventCount,
    eventCoverage,
    thumbnailLatency: thumbStats,
    realFrameCount: frameArrivals.length,
    followHz,
    stutterCount: frameGaps.filter((gap) => gap > 100).length,
    realFrameTickStats,
    settleExact: settleStats,
    thumbnailWarmupMs,
  };
}

async function test8_thumbnailScrub() {
  uiLog('=== Test8: E5 thumbnail scrub (instant strip + real-frame follow + exact settle) ===');
  const longGop4k = await runE5Sweep('4k-longgop', SRC_A, 12);
  const fieldtest1080p = await runE5Sweep('1080p-fieldtest', SRC_1080, 0);
  await window.bench.screenshot('t8-01-thumbnail-scrub');
  return { longGop4k, fieldtest1080p };
}

// ============================================================
// main
// ============================================================
async function main() {
  uiLog('=== preview-engine bench start ===');
  uiLog(`userAgent: ${navigator.userAgent}`);

  const results: Record<string, unknown> = { startedAt: new Date().toISOString(), userAgent: navigator.userAgent, tests: {} };
  const QUICK_DIAG_ONLY = new URLSearchParams(location.search).get('quickDiag') === '1';

  if (!QUICK_DIAG_ONLY)
  try {
    results.tests = { ...(results.tests as object), test1_baselineSeek: await test1_baselineSeek() };
  } catch (e) {
    uiLog(`Test1 FAILED: ${String(e)}`);
    (results.tests as any).test1_error = String(e);
  }

  let scrubEngine: PreviewEngine | null = null;
  if (!QUICK_DIAG_ONLY)
  try {
    const r = await test2_scrubDragTimed();
    scrubEngine = r.engine;
    (results.tests as any).test2_scrubDrag = {
      inputCount: r.inputCount,
      renderCount: r.renderCount,
      updateRateHz: r.updateRateHz,
      stutterCount: r.stutterCount,
      tickStats: r.tickStats,
    };
  } catch (e) {
    uiLog(`Test2 FAILED: ${String(e)}`);
    (results.tests as any).test2_error = String(e);
  }

  if (!QUICK_DIAG_ONLY)
  try {
    if (scrubEngine) {
      (results.tests as any).test3_releaseExact = await test3_releaseExact(scrubEngine);
      scrubEngine.dispose();
    }
  } catch (e) {
    uiLog(`Test3 FAILED: ${String(e)}`);
    (results.tests as any).test3_error = String(e);
  }

  if (!QUICK_DIAG_ONLY)
  try {
    (results.tests as any).test4_lookaheadCache = await test4_lookaheadCache();
  } catch (e) {
    uiLog(`Test4 FAILED: ${String(e)}`);
    (results.tests as any).test4_error = String(e);
  }

  if (!QUICK_DIAG_ONLY)
  try {
    (results.tests as any).test5_concatWarmup = await test5_concatWarmup();
  } catch (e) {
    uiLog(`Test5 FAILED: ${String(e)}`);
    (results.tests as any).test5_error = String(e);
  }

  try {
    (results.tests as any).test6a_aacGuard = await test6a_aacGuard();
  } catch (e) {
    uiLog(`Test6a FAILED: ${String(e)}`);
    (results.tests as any).test6a_error = String(e);
  }

  try {
    (results.tests as any).test6b_tailMargin = await test6b_tailMargin();
  } catch (e) {
    uiLog(`Test6b FAILED: ${String(e)}`);
    (results.tests as any).test6b_error = String(e);
  }

  if (!QUICK_DIAG_ONLY)
  try {
    (results.tests as any).test7_memory = await test7_memoryAndConcurrency();
  } catch (e) {
    uiLog(`Test7 FAILED: ${String(e)}`);
    (results.tests as any).test7_error = String(e);
  }

  if (!QUICK_DIAG_ONLY)
  try {
    (results.tests as any).test8_thumbnailScrub = await test8_thumbnailScrub();
  } catch (e) {
    uiLog(`Test8 FAILED: ${String(e)}`);
    (results.tests as any).test8_error = String(e);
  }

  (results as any).warnings = warnings;
  (results as any).spikeBaseline = SPIKE_BASELINE;
  (results as any).finishedAt = new Date().toISOString();

  await window.bench.results(results);
  uiLog('=== ALL TESTS DONE ===');
  await window.bench.screenshot('99-final');
  setTimeout(() => window.bench.quit(), 1000);
}

// グローバル安全弁: 何かが本当にハングしても最大8分でプロセスを終了させる
// （E4 の主張「ハングせず通知」を万一破っても計測プロセス自体は止めない）
const hardWatchdog = setTimeout(async () => {
  uiLog('[HARD WATCHDOG] 8min exceeded — forcing quit with partial results');
  try {
    await window.bench.results({ partial: true, warnings, note: 'hard watchdog fired, see console.log for progress' });
  } catch (_) {
    /* noop */
  }
  void window.bench.quit();
}, 8 * 60 * 1000);

main()
  .catch(async (e) => {
    uiLog('FATAL: ' + (e && e.stack ? e.stack : e));
    try {
      await window.bench.results({ error: String(e && e.stack ? e.stack : e), warnings });
    } catch (_) {
      /* noop */
    }
    setTimeout(() => window.bench.quit(), 1000);
  })
  .finally(() => clearTimeout(hardWatchdog));
