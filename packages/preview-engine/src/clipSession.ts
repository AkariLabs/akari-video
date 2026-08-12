// 1 タイムラインクリップ = 1 ソース = 1 MP4Clip インスタンスのライフサイクルを管理する。
// E1 (キーフレームスナップ tick)・E4 (guarded load / tail margin / HW→SW 劣化) の実体。
import { MP4Clip } from '@webav/av-cliper';
import type { EngineWarningEvent } from './types.js';
import { buildKeyframeIndexFromHeader, type KeyframeIndex } from './keyframeIndex.js';
import { withTimeout, watchDecoderErrors } from './guard.js';

// docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定1: 判定は拡張子のみ（png/jpe?g/webp/
// bmp/gif、大小無視）。packages/render-cut/src/layers.mjs の IMAGE_LAYER_SOURCE_PATTERN /
// packages/edit-lint/src/edit-lint.mjs の IMAGE_CUT_SOURCE_PATTERN と同一集合（3面パリティ）。
// preview-engine は他パッケージの .mjs を跨いで import しない（esbuild バンドル後もこのパッケージ
// 単体でビルド/型チェックが完結する設計を崩さないため）ので、同じ正規表現を独立して持つ。
const STILL_IMAGE_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/iu;

export function isStillImageSource(src: string): boolean {
  return STILL_IMAGE_SOURCE_PATTERN.test(src);
}

export type ClipSessionState = 'idle' | 'loading' | 'ready' | 'degraded' | 'unavailable';

export interface ClipSessionOptions {
  loadTimeoutMs: number;
  tickTimeoutMs: number;
  tailMarginUs: number;
}

export interface TickResult {
  video?: VideoFrame;
  tickMs: number;
  /** 近似解決(tolerance snap)だったか */
  approx: boolean;
}

export class ClipSession {
  readonly id: string;
  readonly src: string;
  meta: { duration: number; width: number; height: number } | null = null;
  state: ClipSessionState = 'idle';

  private clip: MP4Clip | null = null;
  private keyframeIndex: KeyframeIndex | null = null;
  /** 静止画ソース（docs/contract-2026-08-12-still-image-cut-source-v0.md）。true のとき doLoad/
   *  tick* は MP4Clip を一切使わず、fetch した ImageBitmap から都度 VideoFrame を合成する。 */
  private readonly isStillImage: boolean;
  private imageBitmap: ImageBitmap | null = null;
  /** 末尾 GOP 安全マージンの実効上限(us)。末尾がキーフレームで閉じられていない
   *  最終 GOP 全域が flush 時に壊れる問題（w3c/webcodecs#116 系。実測で「最終フレームだけでなく
   *  最終 GOP まるごと」壊れることを確認）に対応するため、固定フレーム数ではなく
   *  「最後から2番目のキーフレーム未満」を安全圏として使う。キーフレーム情報が無ければ
   *  opts.tailMarginUs（固定マイクロ秒）にフォールバックする。 */
  private tailSafeLimitUs: number | null = null;
  private tailWarningEmitted = false;
  /** foreground（tickExact/tickApprox）要求のたび進む世代番号。tickBackground の陳腐判定に使う */
  private foregroundGeneration = 0;
  private opts: ClipSessionOptions;
  private onWarning: (w: EngineWarningEvent) => void;
  private loadPromise: Promise<void> | null = null;
  // 重要な安全策: av-cliper 1.2.8 の MP4Clip 内部実装を読み取ったところ、tick() は
  // 「後方 or 同時刻の要求」で同期的にデコーダをリセットしてから非同期に歩く実装になっている。
  // 同一 MP4Clip インスタンスへ tick() を並行に呼ぶと、この同期リセットと非同期歩行が競合し
  // 内部状態（読み取りカーソル・デコーダキュー）が壊れうる。呼び出し元（scrub/exact/prefetch/
  // warmup）がどこから来ても必ず直列化するため、セッション内に単純な FIFO キューを持つ。
  private tickQueue: Promise<unknown> = Promise.resolve();

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tickQueue.then(fn, fn);
    this.tickQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  constructor(id: string, src: string, opts: ClipSessionOptions, onWarning: (w: EngineWarningEvent) => void) {
    this.id = id;
    this.src = src;
    this.opts = opts;
    this.onWarning = onWarning;
    this.isStillImage = isStillImageSource(src);
  }

  /** 冪等: 既に load 中/済みなら同じ promise を返す */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    this.state = 'loading';
    if (this.isStillImage) {
      await this.loadStillImage();
      return;
    }
    // 段階的フォールバック（E4）:
    //  1) audio 有効 + HW  2) audio 無効 + HW（AAC configure 無限リトライ対策）
    //  3) audio 無効 + SW（HW セッション枯渇/非対応の劣化運用）
    const attempts: { audio: boolean; hw: HardwarePreference; resultState: ClipSessionState }[] = [
      { audio: true, hw: 'prefer-hardware', resultState: 'ready' },
      { audio: false, hw: 'prefer-hardware', resultState: 'ready' },
      { audio: false, hw: 'prefer-software', resultState: 'degraded' },
    ];

    let lastError: unknown = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i]!;
      try {
        const { clip, meta } = await this.attemptLoad(attempt.audio, attempt.hw);
        this.clip = clip;
        this.meta = meta;
        this.state = attempt.resultState;
        if (attempt.resultState === 'degraded') {
          this.onWarning({
            kind: 'hwDecoderDegraded',
            clipId: this.id,
            message: `software decode fallback active (attempt ${i + 1}/${attempts.length})`,
          });
        }
        // キーフレームインデックス構築（E1 の基盤）。失敗しても致命ではない
        // — インデックス無しなら tolerance スナップは exact tick にフォールバックする。
        try {
          const header = await withTimeout(clip.getFileHeaderBinData(), 2000, `header ${this.id}`);
          this.keyframeIndex = await withTimeout(
            buildKeyframeIndexFromHeader(header),
            2000,
            `keyframeIndex ${this.id}`
          );
          const kf = this.keyframeIndex.keyframeTimesUs;
          if (kf.length >= 2) {
            // 最後のキーフレームが開く最終 GOP は「後続キーフレームで閉じられていない」区間。
            // ここ全域が flush 時に壊れることを実測確認済み（w3c/webcodecs#116 系）。
            // 実測で追加発見: 境界は「最後のキーフレームの1us手前」ちょうどではない
            // （testsrc/4k_h264_longgop_a.mp4 で実測: duration-1e6 は成功するが、
            // 最後のキーフレーム(19.9s)の1us手前はまだ失敗する — 恐らく最終GOP内の
            // サンプル数/端数処理に絡む別の丸め起因の狭いデッドゾーンが keyframe 直前にも
            // 存在する）。正確な境界の追求は本タスクの時間予算外のため、実測で安全と確認できた
            // 1秒の固定バッファを最後のキーフレーム時刻から差し引く、より保守的な安全圏を採用する。
            this.tailSafeLimitUs = (kf[kf.length - 1] as number) - 1_000_000;
          }
        } catch (e) {
          this.onWarning({
            kind: 'decodeTimeout',
            clipId: this.id,
            message: `keyframe index build failed, falling back to exact-only scrub: ${String(e)}`,
          });
        }
        return;
      } catch (e) {
        lastError = e;
        const isLastAttempt = i === attempts.length - 1;
        this.onWarning({
          kind: i === 0 ? 'audioDecoderFallback' : 'hwDecoderDegraded',
          clipId: this.id,
          message: `load attempt ${i + 1}/${attempts.length} failed (${String(e)})${
            isLastAttempt ? '' : ' — retrying with degraded config'
          }`,
          detail: String(e),
        });
      }
    }
    this.state = 'unavailable';
    this.onWarning({
      kind: 'clipUnavailable',
      clipId: this.id,
      message: `all load fallbacks exhausted: ${String(lastError)}`,
      detail: String(lastError),
    });
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /** 静止画ソースの読み込み。MP4Clip/WebCodecs デコーダは一切使わず、fetch + createImageBitmap
   *  だけで完結する（doLoad の段階的フォールバック・keyframeIndex 構築は無関係のため通らない）。 */
  private async loadStillImage(): Promise<void> {
    try {
      const res = await fetch(this.src);
      if (!res.ok) throw new Error(`fetch failed: ${this.src} status=${res.status}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      this.imageBitmap = bitmap;
      // docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定3: a still image has no
      // intrinsic duration -- render-cut/edit-lint already require the timeline (cuts[].out -
      // in) to state the display duration. Infinity here only means "this session itself never
      // runs out of source"; Timeline.resolve()'s own clip.startFrame/endFrame is what actually
      // bounds how long the image is shown for.
      this.meta = { duration: Number.POSITIVE_INFINITY, width: bitmap.width, height: bitmap.height };
      this.state = 'ready';
    } catch (e) {
      this.state = 'unavailable';
      this.onWarning({
        kind: 'clipUnavailable',
        clipId: this.id,
        message: `still image load failed: ${String(e)}`,
        detail: String(e),
      });
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  private async attemptLoad(
    audio: boolean,
    hw: HardwarePreference
  ): Promise<{ clip: MP4Clip; meta: { duration: number; width: number; height: number } }> {
    const res = await fetch(this.src);
    if (!res.ok || !res.body) throw new Error(`fetch failed: ${this.src} status=${res.status}`);

    const clip = new MP4Clip(res.body, { audio, __unsafe_hardwareAcceleration__: hw });

    // ready/tick の Promise 拒否には伝播しない「投げっぱなし」デコーダエラーを
    // このアテンプトの間だけ監視し、race の一員として扱う（guard.ts のコメント参照）。
    let signalError: ((msg: string) => void) | null = null;
    const errorSignal = new Promise<never>((_, reject) => {
      signalError = (msg: string) => reject(new Error(`decoder error: ${msg}`));
    });
    errorSignal.catch(() => {}); // 未使用でも unhandledrejection を出さない
    const stopWatch = watchDecoderErrors((msg) => signalError?.(msg));

    try {
      await withTimeout(Promise.race([clip.ready, errorSignal]), this.opts.loadTimeoutMs, `ready ${this.id}`);
      const meta = clip.meta;
      // 初回フレームを prime しておく — AAC configure の無限リトライは実測上 tick() 実行時に
      // 初めて audio decoder が configure() されるため、load 判定に含めないと再現しない。
      const primed = await withTimeout(
        Promise.race([clip.tick(0), errorSignal]),
        this.opts.tickTimeoutMs,
        `prime-tick ${this.id}`
      );
      primed.video?.close();
      return { clip, meta };
    } catch (e) {
      clip.destroy();
      throw e;
    } finally {
      stopWatch();
    }
  }

  /** 厳密解決（release / programmatic exact seek）。末尾 GOP 安全マージンを常に適用 */
  async tickExact(sourceTimeUs: number): Promise<TickResult> {
    this.foregroundGeneration += 1;
    if (this.isStillImage) return this.tickStillImage(false);
    return this.rawTick(sourceTimeUs, false);
  }

  /** tolerance スクラブ用の近似解決。キーフレームへスナップしてから tick() する（E1） */
  async tickApprox(
    sourceTimeUs: number,
    toleranceUs: number,
    snapBeyondTolerance: boolean
  ): Promise<TickResult> {
    this.foregroundGeneration += 1;
    if (this.isStillImage) return this.tickStillImage(true);
    if (!this.keyframeIndex || this.keyframeIndex.keyframeTimesUs.length === 0) {
      return this.rawTick(sourceTimeUs, false);
    }
    const within = this.keyframeIndex.withinTolerance(sourceTimeUs, toleranceUs);
    if (within != null) {
      return this.rawTick(within, true);
    }
    if (snapBeyondTolerance) {
      const nearest = this.keyframeIndex.nearestAtOrBefore(sourceTimeUs);
      return this.rawTick(nearest, true);
    }
    // 契約の厳密な tolerance のみに従う場合、範囲内にキーフレームが無ければ厳密解決に落ちる
    // （長 GOP 素材ではこの分岐が支配的になりうる — README/report 参照）
    return this.rawTick(sourceTimeUs, false);
  }

  /** 診断/計測用。E1 のキーフレームスナップ・E4 の末尾マージン計算の検証に使う */
  getKeyframeTimesUs(): number[] | null {
    return this.keyframeIndex?.keyframeTimesUs ?? null;
  }

  /**
   * E2 先読み専用の背景 tick。foreground（tickExact/tickApprox/warmup）の要求が
   * 割り込んだら、自分の番が来た時点で実際のデコードをスキップして即終了する
   * （直列キューが背景タスクで詰まり、foreground のレイテンシが悪化するのを防ぐ —
   * 実測で発見した回帰。バックグラウンド側にキャンセル手段が無い WebCodecs/MP4Clip では
   * 「自分の番が来たら鮮度を再確認する」協調的な形でしか優先度を模擬できない）。
   */
  async tickBackground(sourceTimeUs: number): Promise<TickResult> {
    if (this.isStillImage) return this.tickStillImage(false);
    const capturedGeneration = this.foregroundGeneration;
    return this.rawTick(sourceTimeUs, false, () => this.foregroundGeneration !== capturedGeneration);
  }

  /** 静止画ソースの tick*：デコードせず ImageBitmap から都度 VideoFrame を合成するだけ（同期・
   *  ほぼ0コスト）。呼び出し側（renderFrame/thumbnailTrack）は返る VideoFrame を drawImage して
   *  close() するだけなので、動画由来かここで合成したものかを区別しない。 */
  private tickStillImage(approx: boolean): TickResult {
    const t0 = performance.now();
    if (this.state === 'unavailable' || !this.imageBitmap) return { tickMs: performance.now() - t0, approx };
    const video = new VideoFrame(this.imageBitmap, { timestamp: 0, duration: 1e6 / 30 });
    return { video, tickMs: performance.now() - t0, approx };
  }

  private async rawTick(
    sourceTimeUs: number,
    approx: boolean,
    staleCheck?: () => boolean
  ): Promise<TickResult> {
    if (this.state === 'unavailable' || !this.clip) return { tickMs: 0, approx };
    let target = Math.max(0, sourceTimeUs);
    const duration = this.meta?.duration ?? Infinity;
    // キーフレーム情報があれば「最終 GOP を丸ごと回避」、無ければ固定マージンへフォールバック
    const fallbackLimit = duration - this.opts.tailMarginUs;
    const safeLimit = this.tailSafeLimitUs != null ? Math.min(this.tailSafeLimitUs, fallbackLimit) : fallbackLimit;
    if (target > safeLimit) {
      const clamped = Math.max(0, safeLimit);
      if (clamped !== target) {
        target = clamped;
        if (!this.tailWarningEmitted) {
          this.tailWarningEmitted = true;
          this.onWarning({
            kind: 'tailGopMarginClamped',
            clipId: this.id,
            message: this.tailSafeLimitUs != null
              ? `seek near clip end clamped below final (unclosed) GOP's keyframe at ${this.tailSafeLimitUs}us (w3c/webcodecs#116 defense; whole final GOP observed broken, not just last frame)`
              : `seek near clip end clamped to duration-${this.opts.tailMarginUs}us (w3c/webcodecs#116 defense, no keyframe index available)`,
          });
        }
      }
    }
    const t0 = performance.now();
    try {
      const ret = await this.serialize(() => {
        if (staleCheck?.()) return Promise.resolve<{ video?: VideoFrame }>({});
        return withTimeout(this.clip!.tick(Math.floor(target)), this.opts.tickTimeoutMs, `tick ${this.id}`);
      });
      return { video: ret.video, tickMs: performance.now() - t0, approx };
    } catch (e) {
      this.onWarning({
        kind: 'decodeTimeout',
        clipId: this.id,
        message: `tick timed out/errored at t=${target}us: ${String(e)}`,
      });
      return { tickMs: performance.now() - t0, approx };
    }
  }

  /**
   * E3 warmup: 次クリップのデコーダを事前 configure + prime する。
   *
   * 重要な実装上の発見: av-cliper の MP4Clip.tick() は「要求時刻が直前の要求時刻以下」なら
   * 同一時刻の再要求であっても無条件にデコーダをフルリセットする実装になっている
   * （後方シークと区別しない）。そのため実際に必要な開始時刻ちょうどをここで prime すると、
   * 本番の tick が「全く同じ時刻の再要求」になり `t <= lastRequested` を満たして
   * **もう一度リセットが起きてしまい warmup が無駄になる**（実測で発見。1フレーム前を
   * prime するよう変更したところ改善した）。そのため実際の開始時刻より 1 フレーム分手前を
   * prime し、本番の tick が「わずかに前方への継続」（reset ではなく歩行）になるようにする。
   */
  async warmup(nearStartUs: number, frameDurationUs = 1e6 / 30): Promise<number> {
    const t0 = performance.now();
    await this.load();
    if (this.clip) {
      const primeUs = Math.max(0, nearStartUs - Math.round(frameDurationUs));
      const ret = await this.tickExact(primeUs);
      ret.video?.close();
    }
    return performance.now() - t0;
  }

  destroy(): void {
    this.clip?.destroy();
    this.clip = null;
    this.imageBitmap?.close();
    this.imageBitmap = null;
    this.state = 'idle';
  }
}
