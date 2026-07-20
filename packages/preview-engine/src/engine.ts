// PreviewEngine — シェル非依存の公開 API 本体。
// mount / loadTimeline / seek / play / pause / dispose + イベント（README.md 記載の公開面）。
import { TypedEmitter } from './eventEmitter.js';
import type { EngineEvents, PreviewEngineOptions, SeekMode, TimelineAudioSpec, TimelineSpec } from './types.js';
import { Timeline, type ResolvedFrame } from './timeline.js';
import { ClipSession } from './clipSession.js';
import { LookaheadCache } from './lookaheadCache.js';
import { ScrubController } from './scrubController.js';
import { WarmupManager } from './warmupManager.js';
import { ThumbnailTrack } from './thumbnailTrack.js';
import { NarrationTrack } from './narrationTrack.js';
import { computeBgmDuckGainDb } from './duckingGain.js';

type ResolvedOptions = Required<PreviewEngineOptions>;

const DEFAULT_OPTIONS: ResolvedOptions = {
  scrubThrottleMs: 1000 / 30,
  keyframeSnapBeyondTolerance: true,
  lookaheadCacheSize: 24,
  warmupLeadInSec: 0.75,
  loadTimeoutMs: 4000,
  tickTimeoutMs: 4000,
  tailMarginUs: Math.round((1e6 / 30) * 2),
  enableThumbnailScrub: true,
  thumbnailMaxCount: 40,
  thumbnailIntervalSec: 2,
  thumbnailWidth: 160,
};

export class PreviewEngine {
  private emitter = new TypedEmitter<EngineEvents>();
  private timeline: Timeline | null = null;
  private sessions = new Map<string, ClipSession>();
  private cache = new Map<string, LookaheadCache>();
  private prefetchInFlight = new Set<string>();
  private thumbnailTracks = new Map<string, ThumbnailTrack>();
  private thumbnailBuildStarted = new Set<string>();
  private thumbnailSourceRanges = new Map<string, { startUs: number; endUs: number }>();
  private lastThumbnailKey: string | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private scrub: ScrubController;
  private warmupMgr: WarmupManager;
  private currentFrame = 0;
  private playing = false;
  private renderInFlight = false;
  private playHandle: ReturnType<typeof setTimeout> | null = null;
  private opts: ResolvedOptions;
  private tailMarginUserSet: boolean;
  private disposed = false;
  // narration 再生（Wave 20 T4）。BGM/SFX 自体のプレビュー再生は本パッケージ未実装のため、
  // audioCtx は narration 専用（README「narration 再生」節 / report.md 参照）。
  private audioCtx: AudioContext | null = null;
  private narrationTrack: NarrationTrack | null = null;
  private audioSpec: TimelineAudioSpec | null = null;

  constructor(options: PreviewEngineOptions = {}) {
    this.tailMarginUserSet = options.tailMarginUs != null;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.scrub = new ScrubController(this.opts.scrubThrottleMs, (frame, gen) => this.executeScrubTick(frame, gen));
    this.warmupMgr = new WarmupManager(this.opts.warmupLeadInSec);
  }

  on<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): () => void {
    return this.emitter.on(event, cb);
  }

  off<K extends keyof EngineEvents>(event: K, cb: (payload: EngineEvents[K]) => void): void {
    this.emitter.off(event, cb);
  }

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  async loadTimeline(spec: TimelineSpec): Promise<void> {
    this.disposeSessions();
    this.timeline = new Timeline(spec);
    if (!this.tailMarginUserSet) {
      this.opts.tailMarginUs = Math.round((1e6 / spec.fps) * 2);
    }
    for (const clip of spec.clips) {
      this.sessions.set(
        clip.id,
        new ClipSession(
          clip.id,
          clip.src,
          {
            loadTimeoutMs: this.opts.loadTimeoutMs,
            tickTimeoutMs: this.opts.tickTimeoutMs,
            tailMarginUs: this.opts.tailMarginUs,
          },
          (w) => this.emitter.emit('warning', w)
        )
      );
      this.cache.set(clip.id, new LookaheadCache(this.opts.lookaheadCacheSize));
      if (this.opts.enableThumbnailScrub) {
        const sourceStartUs = clip.sourceInUs ?? 0;
        const sourceDurationUs = (Math.max(0, clip.endFrame - clip.startFrame) / spec.fps) * 1e6;
        this.thumbnailSourceRanges.set(clip.id, {
          startUs: sourceStartUs,
          endUs: sourceStartUs + sourceDurationUs,
        });
        this.thumbnailTracks.set(
          clip.id,
          new ThumbnailTrack({
            maxThumbnails: this.opts.thumbnailMaxCount,
            intervalSec: this.opts.thumbnailIntervalSec,
            thumbWidth: this.opts.thumbnailWidth,
          })
        );
      }
    }
    this.currentFrame = 0;
    // 「4K ソース投入直後・無準備でスクラブが滑らか」の体感基準に対応するため、
    // 先頭フレームのクリップだけは eager load する。
    const first = this.timeline.resolve(0);
    if (first) {
      const session = this.getSession(first.clip.id);
      await session.load();
      this.startThumbnailBuild(first.clip.id, session);
    }

    this.audioSpec = spec.audio ?? null;
    await this.loadNarration(spec.audio, this.timeline.totalFrames() / spec.fps);
  }

  /**
   * narration 付きプロジェクトなら decode/検証まで済ませておく（play() 時点で await せず
   * 即座にスケジュールできるようにするため）。narration が無ければ何もしない
   * （既存タイムラインの挙動を一切変えない — 契約 §0 の後方互換方針）。
   */
  private async loadNarration(audio: TimelineAudioSpec | undefined, timelineDurationSec: number): Promise<void> {
    if (!audio?.narration || audio.narration.length === 0) return;
    const AudioContextCtor: typeof AudioContext | undefined =
      typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (!AudioContextCtor) {
      this.emitter.emit('warning', {
        kind: 'narrationUnavailable',
        clipId: 'narration',
        message: 'AudioContext unavailable in this environment; narration playback disabled',
      });
      return;
    }
    this.audioCtx = this.audioCtx ?? new AudioContextCtor();
    const track = new NarrationTrack(this.audioCtx);
    await track.load(audio.narration, timelineDurationSec, (w) => this.emitter.emit('warning', w));
    this.narrationTrack = track;
  }

  /**
   * bgm.ducking:true のときの静的ダッキング近似値(dB)を返す（契約 §3「固定 -12dB」）。
   * narration が無い/その位置がどの narration 区間にも入っていない場合は 0（無効果 = 元のゲインのまま）。
   * BGM 自体の GainNode は本パッケージが管理しない（README 参照）ため、呼び出し側が自前の BGM
   * ゲインにこの値を加算適用する想定の公開ユーティリティ。
   */
  narrationDuckGainDbAt(atSec: number): number {
    if (!this.narrationTrack || !this.audioSpec?.bgm?.ducking) return 0;
    return computeBgmDuckGainDb(this.narrationTrack.getDuckIntervals(), true, atSec);
  }

  /**
   * @param frame タイムラインフレーム番号
   * @param mode 'exact' | 'interactiveScrub'（Palmier 同型の2モード）
   */
  async seek(frame: number, mode: SeekMode): Promise<void> {
    if (this.disposed || !this.timeline) return;
    if (mode === 'interactiveScrub') {
      this.tryDrawThumbnail(frame);
      this.scrub.requestScrub(frame);
      return;
    }
    this.scrub.cancelPending();
    await this.resolveAndRender(frame, false);
    if (this.playing) {
      // 再生中のプログラム的シーク（例: ユーザーがタイムラインバーをクリック）。
      // narration は「呼びっぱなしで直近1件」ではなく毎回総入れ替えなので、新しい位置から再スケジュールする。
      this.rescheduleNarrationFrom(frame);
    }
  }

  play(): void {
    if (this.playing || !this.timeline) return;
    this.playing = true;
    const fps = this.timeline.fps;
    const frameMs = 1000 / fps;
    this.rescheduleNarrationFrom(this.currentFrame);
    let last = performance.now();
    const loop = () => {
      if (!this.playing) return;
      const now = performance.now();
      if (!this.renderInFlight && now - last >= frameMs) {
        last = now;
        const total = this.timeline!.totalFrames();
        if (this.currentFrame >= total) {
          this.pause();
          return;
        }
        this.renderInFlight = true;
        void this.resolveAndRender(this.currentFrame, true).then(() => {
          this.currentFrame += 1;
          this.renderInFlight = false;
        });
      }
      this.playHandle = setTimeout(loop, Math.max(1, frameMs / 4));
    };
    this.emitter.emit('play', { frame: this.currentFrame });
    loop();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.playHandle != null) {
      clearTimeout(this.playHandle);
      this.playHandle = null;
    }
    this.narrationTrack?.stopAll();
    this.emitter.emit('pause', { frame: this.currentFrame });
  }

  dispose(): void {
    this.pause();
    this.scrub.dispose();
    this.disposeSessions(); // narrationTrack/audioSpec のリセットもここで行う
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => undefined);
      this.audioCtx = null;
    }
    this.timeline = null;
    this.canvas = null;
    this.ctx = null;
    this.disposed = true;
    this.emitter.emit('dispose', {});
    this.emitter.removeAll();
  }

  // --- 内部実装 ---

  /** frame（タイムラインフレーム）秒換算の位置から narration を再スケジュールする。narration 無し/未ロードなら no-op */
  private rescheduleNarrationFrom(frame: number): void {
    if (!this.narrationTrack || !this.audioCtx || !this.timeline) return;
    const atSec = frame / this.timeline.fps;
    this.narrationTrack.scheduleFrom(atSec, this.audioCtx.currentTime, this.audioCtx.destination);
  }

  private getSession(clipId: string): ClipSession {
    const s = this.sessions.get(clipId);
    if (!s) throw new Error(`unknown clip session: ${clipId}`);
    return s;
  }

  private async executeScrubTick(frame: number, generation: number): Promise<void> {
    if (this.disposed || !this.timeline) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const session = this.getSession(resolved.clip.id);
    if (session.state === 'idle') {
      // 未ロードのままスクラブをブロックしない。裏でロードだけ進めて次回に賭ける（30Hz なので実害小）。
      void session.load().then(
        () => this.startThumbnailBuild(resolved.clip.id, session),
        () => undefined
      );
      return;
    }
    if (session.state === 'ready' || session.state === 'degraded') {
      this.startThumbnailBuild(resolved.clip.id, session);
    }

    const toleranceUs = Math.min(0.75, 0.15 * resolved.activeLayerCount) * 1e6;
    const cache = this.cache.get(resolved.clip.id);
    const cached = cache?.getClone(resolved.localFrame);

    let video: VideoFrame | undefined;
    let tickMs: number;
    let approx = true;
    if (cached) {
      video = cached.frame;
      tickMs = 0;
    } else {
      const ret = await session.tickApprox(resolved.sourceTimeUs, toleranceUs, this.opts.keyframeSnapBeyondTolerance);
      video = ret.video;
      tickMs = ret.tickMs;
      approx = ret.approx;
    }

    if (this.scrub.isStale(generation)) {
      // 毎回陳腐シーク破棄
      video?.close();
      return;
    }

    this.currentFrame = frame;
    this.renderFrame(video, resolved.clip.id, frame, approx, tickMs);
    this.maybeWarmup(resolved);
  }

  private async resolveAndRender(frame: number, fromPlay: boolean): Promise<void> {
    if (!this.timeline) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const session = this.getSession(resolved.clip.id);
    if (session.state === 'idle') {
      try {
        await session.load();
      } catch {
        // warning は ClipSession 側で既に emit 済み
      }
    }
    if (session.state === 'ready' || session.state === 'degraded') {
      this.startThumbnailBuild(resolved.clip.id, session);
    }

    const cache = this.cache.get(resolved.clip.id);
    const cached = cache?.getClone(resolved.localFrame);
    let video: VideoFrame | undefined;
    let tickMs = 0;
    if (cached) {
      video = cached.frame;
    } else {
      const ret = await session.tickExact(resolved.sourceTimeUs);
      video = ret.video;
      tickMs = ret.tickMs;
      if (video && cache) {
        cache.put(resolved.localFrame, video.clone(), tickMs);
      }
    }

    this.currentFrame = frame;
    this.renderFrame(video, resolved.clip.id, frame, false, tickMs);
    this.maybeWarmup(resolved);
    if (!fromPlay) this.prefetchForward(resolved);
  }

  private maybeWarmup(resolved: ResolvedFrame): void {
    if (!resolved.nextClip) return;
    const nextSession = this.sessions.get(resolved.nextClip.id) ?? null;
    this.warmupMgr.maybeWarmup(
      resolved.secondsToBoundary,
      nextSession,
      resolved.nextClip.sourceInUs ?? 0,
      (clipId, tookMs) => {
        this.emitter.emit('warmup', { clipId, primedAtFrame: this.currentFrame, tookMs });
      },
      this.timeline ? 1e6 / this.timeline.fps : 1e6 / 30
    );
  }

  private prefetchForward(resolved: ResolvedFrame): void {
    const cache = this.cache.get(resolved.clip.id);
    const session = this.sessions.get(resolved.clip.id);
    if (!cache || !session || session.state === 'unavailable' || !this.timeline) return;
    // 重要: resolveAndRender は連続シーク/再生のたび毎回呼ばれる。ここで無条件に新しい
    // 先読みチェーンを起動すると、前のチェーンがまだ ClipSession の直列キューを消化中の間に
    // 新しいチェーンが次々積み上がり、キューが指数的に肥大化して foreground 側のレイテンシを
    // 悪化させる回帰を実測で踏んだ（Test5 で 55 フレームの単純逐次シークが 60 秒かかった）。
    // クリップ単位で「同時に走る先読みチェーンは高々1本」に制限して解消する。
    if (this.prefetchInFlight.has(resolved.clip.id)) return;
    this.prefetchInFlight.add(resolved.clip.id);
    const fps = this.timeline.fps;
    const startLocal = resolved.localFrame + 1;
    const count = Math.min(4, this.opts.lookaheadCacheSize);
    void (async () => {
      try {
        for (let i = 0; i < count; i++) {
          const lf = startLocal + i;
          if (cache.has(lf)) continue;
          const srcTimeUs = (resolved.clip.sourceInUs ?? 0) + (lf / fps) * 1e6;
          const ret = await session.tickBackground(srcTimeUs);
          if (ret.video) cache.put(lf, ret.video, ret.tickMs);
          else break;
        }
      } finally {
        this.prefetchInFlight.delete(resolved.clip.id);
      }
    })();
  }

  private renderFrame(
    video: VideoFrame | undefined,
    clipId: string,
    frame: number,
    approx: boolean,
    tickMs: number
  ): void {
    let drawn = false;
    if (video) {
      if (this.ctx && this.canvas) {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        drawn = true;
        // 実フレームがサムネを上書きした後は、同じ最近傍サムネでも次の入力時に再表示する。
        this.lastThumbnailKey = null;
      }
      video.close();
    }
    this.emitter.emit('frame', { frame, clipId, approx, tickMs, drawn });
  }

  private startThumbnailBuild(clipId: string, session: ClipSession): void {
    if (!this.opts.enableThumbnailScrub || this.thumbnailBuildStarted.has(clipId) || !session.meta) return;
    const track = this.thumbnailTracks.get(clipId);
    const sourceRange = this.thumbnailSourceRanges.get(clipId);
    if (!track || !sourceRange) return;
    this.thumbnailBuildStarted.add(clipId);
    void track
      .build(session, sourceRange.startUs, sourceRange.endUs, session.getKeyframeTimesUs())
      .catch((e) => {
        if (this.disposed || !this.sessions.has(clipId)) return;
        this.emitter.emit('error', {
          clipId,
          message: `thumbnail track build failed: ${String(e)}`,
          detail: e,
        });
      });
  }

  private tryDrawThumbnail(frame: number): void {
    if (!this.opts.enableThumbnailScrub || !this.timeline || !this.ctx || !this.canvas) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const entry = this.thumbnailTracks.get(resolved.clip.id)?.nearest(resolved.sourceTimeUs);
    if (!entry) return;
    const key = `${resolved.clip.id}:${entry.timeUs}`;
    if (key === this.lastThumbnailKey) return;
    this.ctx.drawImage(entry.bitmap, 0, 0, this.canvas.width, this.canvas.height);
    this.lastThumbnailKey = key;
    this.emitter.emit('thumbnail', { frame, clipId: resolved.clip.id, drawnAtMs: performance.now() });
  }

  private disposeSessions(): void {
    // loadTimeline() の再ロード（新しいタイムライン差し替え）時、前のタイムラインの narration が
    // 鳴り続けないようにここで一緒に破棄する。AudioContext 自体は dispose() まで使い回す
    // （生成/破棄コストと同時起動数制限を避けるため）。
    this.narrationTrack?.dispose();
    this.narrationTrack = null;
    this.audioSpec = null;
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
    for (const c of this.cache.values()) c.clear();
    this.cache.clear();
    this.prefetchInFlight.clear();
    for (const track of this.thumbnailTracks.values()) track.clear();
    this.thumbnailTracks.clear();
    this.thumbnailBuildStarted.clear();
    this.thumbnailSourceRanges.clear();
    this.lastThumbnailKey = null;
    this.warmupMgr.reset();
  }
}
