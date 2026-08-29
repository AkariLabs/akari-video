import {
  buildResolvedTimelinePlan,
  CachedStillImageSource,
  ClipSessionPool,
  createPreviewAudioSupply,
  createPreviewScheduler,
  evaluationPlanFromResolvedTimeline,
  evaluateFrame,
  FrameMetrics,
  LookaheadFrameSource,
  parseCube,
  projectSpeechDeclarations,
  ScrubController,
  WebGL2Compositor,
} from '../../frame-engine/src/index.ts';
import type {
  EvaluationPlan,
  FrameEngineCut,
  FrameEngineLayer,
  LookaheadAccess,
  NativeFrameSource,
  PreviewScheduler,
  PreviewAudioSupply,
  PreviewAudioSupplyDebug,
  ResolvedTimelinePlan,
  TimelineSourceRegistry,
} from '../../frame-engine/src/index.ts';
import type { WebAudioDecodedItem } from '../../edit-store/src/audio-schedule.ts';

interface PreviewOptions {
  edit: any;
  timelineData: any;
  stage: HTMLElement;
  fps: number;
}

interface TimelineUiSegment {
  index: number;
  isGap: false;
  inSec: number;
  outSec: number;
  speed: number;
  outStart: number;
  outEnd: number;
  durationSec: number;
  framing?: unknown;
  freeze?: unknown;
  transform?: unknown;
  opacity?: number;
}

interface PreviewSnapshot {
  totalDuration: number;
  segments: TimelineUiSegment[];
}

const requestedUploadPath = new URLSearchParams(window.location.search).get('uploadPath') === 'copyTo'
  ? 'copyTo'
  : 'direct';

interface Measurements {
  presentedAt: number[];
  lateFrames: number;
  seekLatestMs: number | null;
  seekBeforeMs: number[];
  seekAfterMs: number[];
  boundaryBefore: { total: number; late: number };
  boundaryAfter: { total: number; late: number };
  warmupMs: number[];
}

interface DecodedFrameObservation {
  streamId: string;
  requestedUs: number;
  timestampUs: number;
  durationUs: number | null;
}

function percentile(values: readonly number[], fraction = 0.5): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
}

function mediaUrl(value: unknown): string {
  const source = String(value ?? '');
  if (/^(https?:|blob:|\/)/u.test(source)) return source;
  return `/${source.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

function audioDeclarations(edit: any): Array<{
  kind: 'bgm' | 'sfx' | 'narration';
  id: string;
  url: string;
  spec: WebAudioDecodedItem;
}> {
  const audio = edit?.audio;
  if (!audio || typeof audio !== 'object') return [];
  const declarations: Array<{
    kind: 'bgm' | 'sfx' | 'narration';
    id: string;
    url: string;
    spec: WebAudioDecodedItem;
  }> = [];
  const append = (kind: 'bgm' | 'sfx' | 'narration', raw: any, fallbackId: string) => {
    if (!raw || typeof raw !== 'object') return;
    const source = raw.src || raw.path;
    if (typeof source !== 'string' || !source) return;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    declarations.push({ kind, id, url: mediaUrl(source), spec: { ...raw, id, durationSec: 0 } });
  };
  append('bgm', audio.bgm, 'bgm');
  if (Array.isArray(audio.sfx)) {
    audio.sfx.forEach((item: any, index: number) => append('sfx', item, `sfx-${index + 1}`));
  }
  if (Array.isArray(audio.narration)) {
    audio.narration.forEach((item: any, index: number) => append('narration', item, `narration-${index + 1}`));
  }
  return declarations;
}

function normalizedCuts(edit: any): FrameEngineCut[] {
  const cuts = Array.isArray(edit?.cuts) ? edit.cuts : [];
  return cuts.map((cut: any, index: number) => {
    // The v0 frame-engine timeline is the sequential cuts path. Renderer projection includes
    // derived at/track fields even for that path; remove them so freeze can extend the timeline
    // and transition overlap is recomputed from the declared transition itself.
    const { at: _derivedAt, track: _derivedTrack, ...sequential } = cut;
    return {
      ...sequential,
      src: cut.src ?? (Array.isArray(edit?.sources) ? edit.sources[0]?.id : 'default'),
      in: Number(cut.in ?? 0),
      out: Number(cut.out ?? cut.in ?? 0),
      transition_out: cut.transition_out ?? cut.transitionOut,
      id: cut.id ?? `cut-${index}`,
    };
  });
}

function sourceUrls(edit: any, timelineData: any, cuts: readonly FrameEngineCut[]): Map<string, string> {
  const urls = new Map<string, string>();
  if (Array.isArray(edit?.sources)) {
    for (const source of edit.sources) {
      if (source?.id && (source.proxy || source.path)) {
        urls.set(String(source.id), mediaUrl(source.proxy || source.path));
      }
    }
  } else if (edit?.source?.path) {
    urls.set('default', mediaUrl(edit.source.path));
  }
  for (let index = 0; index < cuts.length; index += 1) {
    const clip = timelineData?.clips?.find((item: any) => item.id === `cut-${index}`);
    const sourceId = cuts[index]?.src;
    if (clip?.src && sourceId) urls.set(sourceId, mediaUrl(clip.src));
  }
  return urls;
}

function createUi(stage: HTMLElement): {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  metrics: HTMLDivElement;
  error: HTMLDivElement;
} {
  const root = document.createElement('div');
  root.id = 'frame-engine-preview';
  root.dataset.frameEngineReady = 'false';
  Object.assign(root.style, { position: 'absolute', inset: '0', background: '#000' });

  const canvas = document.createElement('canvas');
  canvas.id = 'frame-engine-canvas';
  canvas.setAttribute('aria-label', 'Frame engine canvas preview');
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', objectFit: 'contain' });

  const metrics = document.createElement('div');
  metrics.id = 'frame-engine-metrics';
  metrics.hidden = new URLSearchParams(window.location.search).get('frameEngineMetrics') !== '1';
  Object.assign(metrics.style, {
    position: 'absolute', zIndex: '2147483647', right: '8px', top: '8px', minWidth: '250px', padding: '7px 9px',
    border: '1px solid rgba(116,192,252,.65)', borderRadius: '4px', background: 'rgba(4,12,20,.88)',
    color: '#d8efff', font: '11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace', whiteSpace: 'pre',
  });

  const error = document.createElement('div');
  error.id = 'frame-engine-error';
  error.hidden = true;
  Object.assign(error.style, {
    position: 'absolute', zIndex: '2147483647', inset: '40% 10% auto', padding: '12px', borderRadius: '6px',
    background: 'rgba(80,0,0,.9)', color: '#fff', textAlign: 'center',
  });

  root.append(canvas, metrics, error);
  stage.prepend(root);
  return { root, canvas, metrics, error };
}

function replaceCanvas(ui: ReturnType<typeof createUi>): void {
  const canvas = ui.canvas.cloneNode(false) as HTMLCanvasElement;
  ui.root.replaceChild(canvas, ui.canvas);
  ui.canvas = canvas;
}

class FrameEngineRuntime {
  readonly totalDuration: number;
  readonly segments: TimelineUiSegment[];
  private readonly pools = new Map<string, ClipSessionPool>();
  private readonly lookahead = new Map<string, LookaheadFrameSource>();
  private readonly images = new Map<string, CachedStillImageSource>();
  private readonly sources: TimelineSourceRegistry;
  private readonly timeline: ResolvedTimelinePlan;
  private readonly compositor: WebGL2Compositor;
  private readonly frameMetrics = new FrameMetrics();
  private readonly scheduler: PreviewScheduler;
  private readonly scrub: ScrubController;
  private readonly output: EvaluationPlan['output'];
  private readonly audio: PreviewAudioSupply;
  private readonly measurements: Measurements = {
    presentedAt: [], lateFrames: 0, seekLatestMs: null, seekBeforeMs: [], seekAfterMs: [],
    boundaryBefore: { total: 0, late: 0 }, boundaryAfter: { total: 0, late: 0 }, warmupMs: [],
  };
  private rendering: Promise<void> | null = null;
  private lastPlaybackFrame = -1;
  private lastPresentedSec = 0;
  private lastCutIndex: number | null = null;
  private currentAccesses: LookaheadAccess[] | null = null;
  private currentDecodedFrames: DecodedFrameObservation[] | null = null;
  private lastRequestedTimeUs: number | null = null;
  private lastBaseFrame: DecodedFrameObservation | null = null;
  private disposed = false;

  constructor(
    private readonly ui: ReturnType<typeof createUi>,
    private readonly edit: any,
    private readonly timelineData: any,
    private readonly fps: number,
  ) {
    // The compositor owns the visible canvas directly: no per-frame WebGL -> 2D readback/blit.
    this.compositor = new WebGL2Compositor(ui.canvas, {
      synchronization: 'flush',
      uploadPath: requestedUploadPath,
    });
    const cuts = normalizedCuts(edit);
    const urls = sourceUrls(edit, timelineData, cuts);
    const videoSources = new Map<string, NativeFrameSource>();
    const frameEngineIntake = edit?.frameEngine?.intake ?? {};
    const skippedLayers = new Set(Array.isArray(edit?.frameEngine?.skipped) ? edit.frameEngine.skipped : []);
    const engineLayers = (Array.isArray(edit?.layers) ? edit.layers : [])
      .map((layer: any, index: number) => {
        const key = String(layer?.id ?? layer?.src ?? index);
        if (skippedLayers.has(key)) return null;
        const prepared = frameEngineIntake[key];
        return prepared ? { ...layer, src: prepared.src, mask: prepared.mask } : layer;
      })
      .filter(Boolean);
    for (const warning of Array.isArray(edit?.frameEngine?.warnings) ? edit.frameEngine.warnings : []) {
      this.showError(String(warning), false);
    }
    for (const layer of engineLayers) {
      if (!layer?.src) continue;
      const key = String(layer.src);
      urls.set(key, mediaUrl(key));
      if (layer.mask) {
        const maskKey = String(layer.mask);
        urls.set(maskKey, mediaUrl(maskKey));
      }
    }
    for (const [id, url] of urls) {
      if (/\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/iu.test(url)) {
        this.images.set(id, new CachedStillImageSource(url));
        continue;
      }
      const pool = new ClipSessionPool(id, url, { onWarning: message => this.showError(message, false) });
      const source = new LookaheadFrameSource(pool, {
        fps,
        capacity: 12,
        onAccess: access => this.currentAccesses?.push(access),
      });
      const observedSource: NativeFrameSource = {
        decode: async (timeUs, metrics, request) => {
          const frame = await source.decode(timeUs, metrics, request);
          this.currentDecodedFrames?.push({
            streamId: request?.streamId ?? 'default',
            requestedUs: timeUs,
            timestampUs: frame.timestamp,
            durationUs: frame.duration ?? null,
          });
          return frame;
        },
      };
      this.pools.set(id, pool);
      this.lookahead.set(id, source);
      videoSources.set(id, observedSource);
    }
    this.sources = new Map([...videoSources, ...this.images]);
    this.timeline = buildResolvedTimelinePlan(cuts, {
      fps,
      layers: engineLayers as FrameEngineLayer[],
    });
    this.totalDuration = this.timeline.totalDuration;
    const projectedSpeech = Array.isArray(edit?.audio?.speech)
      ? edit.audio.speech : projectSpeechDeclarations(cuts, { fps });
    const speech = projectedSpeech.flatMap((declaration: any) => {
      const url = urls.get(declaration.src);
      if (!url) return [];
      return [{
        ...declaration,
        url,
        ...(declaration.atempo?.path ? {
          atempo: { ...declaration.atempo, path: mediaUrl(declaration.atempo.path) },
        } : {}),
      }];
    });
    this.audio = createPreviewAudioSupply({
      timelineDurationSec: this.totalDuration,
      declarations: audioDeclarations(edit),
      speech,
      pauseWatchdogMs: 150,
    });
    this.segments = (this.timeline as any).cuts.map((placement: any, index: number) => {
      const cut = placement.cut ?? cuts[index] ?? {};
      return {
        index,
        isGap: false as const,
        inSec: Number(cut.in ?? 0),
        outSec: Number(cut.out ?? cut.in ?? 0),
        speed: Number(cut.speed) > 0 ? Number(cut.speed) : 1,
        outStart: placement.at,
        outEnd: placement.end,
        durationSec: placement.end - placement.at,
        framing: cut.framing,
        freeze: cut.freeze,
        transform: cut.transform,
        opacity: Number.isFinite(cut.opacity) ? Number(cut.opacity) : undefined,
      };
    });
    const size = edit?.output ?? {};
    const projectedLook = edit?.videoFx?.look;
    const intensity = Number(projectedLook?.intensity ?? 1);
    this.output = {
      width: Number(size.width) > 0 ? Number(size.width) : 1280,
      height: Number(size.height) > 0 ? Number(size.height) : 720,
      colorSpace: 'bt709-limited',
      look: typeof projectedLook?.cubeText === 'string'
        ? {
            lut: parseCube(projectedLook.cubeText),
            intensity: Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 1)),
          }
        : null,
    };
    this.scheduler = createPreviewScheduler({
      timeline: this.timeline,
      sources: this.sources,
      output: this.output,
      fps,
      pools: this.pools,
      lookahead: this.lookahead,
      metrics: {
        warmupMs: this.measurements.warmupMs,
        onChanged: () => this.updateMetrics(),
        onWarning: message => this.showError(message, false),
      },
    });
    this.scrub = new ScrubController(Math.min(24, 1000 / fps), async (frameNumber, generation) => {
      const started = performance.now();
      await this.waitForRender();
      if (this.scrub.isStale(generation) || this.disposed) return;
      const operation = this.renderFrame(frameNumber / fps, 'seek', started)
        .catch(error => this.showError(String(error), true));
      this.rendering = operation;
      try {
        await operation;
      } finally {
        if (this.rendering === operation) this.rendering = null;
      }
    });
    this.updateMetrics();
  }

  async prime(): Promise<void> {
    const first = performance.now();
    await this.renderFrame(0, 'seek', first);
    const second = performance.now();
    await this.renderFrame(0, 'seek', second);
    this.ui.root.dataset.frameEngineReady = 'true';
    this.scheduler.primeHeaders();
  }

  seek(seconds: number): number {
    const clamped = Math.max(0, Math.min(seconds, this.totalDuration));
    this.audio.seek(clamped);
    const frameNumber = Math.round(clamped * this.fps);
    this.scrub.requestScrub(frameNumber);
    return frameNumber / this.fps;
  }

  renderPlayback(seconds: number): number {
    const audioClockSeconds = this.audio.playbackTime(seconds);
    const frameNumber = Math.round(audioClockSeconds * this.fps);
    if (frameNumber === this.lastPlaybackFrame) return this.lastPresentedSec;
    this.lastPlaybackFrame = frameNumber;
    if (this.rendering) {
      this.measurements.lateFrames += 1;
      this.updateMetrics();
      return this.lastPresentedSec;
    }
    const operation = this.renderFrame(frameNumber / this.fps, 'playback')
      .catch(error => this.showError(String(error), true));
    this.rendering = operation;
    void operation.finally(() => {
      if (this.rendering === operation) this.rendering = null;
    });
    return this.lastPresentedSec;
  }

  snapshot(): PreviewSnapshot {
    return { totalDuration: this.totalDuration, segments: this.segments };
  }

  audioDebug(): PreviewAudioSupplyDebug {
    return this.audio.debug();
  }

  dispose(): void {
    this.disposed = true;
    this.scrub.dispose();
    this.audio.dispose();
    this.scheduler.dispose();
    for (const source of this.lookahead.values()) source.clear();
    for (const image of this.images.values()) image.destroy();
    for (const pool of this.pools.values()) pool.destroy();
    this.compositor.dispose();
  }

  private async waitForRender(): Promise<void> {
    if (this.rendering) await this.rendering;
  }

  private async renderFrame(seconds: number, reason: 'playback' | 'seek', requestedAt = performance.now()): Promise<void> {
    if (this.disposed) return;
    const timeUs = Math.round(Math.max(0, Math.min(seconds, this.totalDuration)) * 1e6);
    const plan = evaluationPlanFromResolvedTimeline(this.timeline, timeUs, this.sources, this.output);
    if (plan.base.length === 0 && plan.layers.length === 0) {
      const context = this.ui.canvas.getContext('2d');
      context?.clearRect(0, 0, this.ui.canvas.width, this.ui.canvas.height);
      return;
    }
    this.currentAccesses = [];
    this.currentDecodedFrames = [];
    const started = performance.now();
    let frame;
    try {
      frame = await evaluateFrame(plan, { compositor: this.compositor, metrics: this.frameMetrics });
    } finally {
      frame?.close();
    }
    const elapsed = performance.now() - started;
    this.lastRequestedTimeUs = timeUs;
    this.audio.noteRendered(timeUs / 1e6);
    this.lastBaseFrame = this.currentDecodedFrames.find(observation =>
      plan.base.some(layer => layer.id === observation.streamId)) ?? null;
    const late = elapsed > 1000 / this.fps;
    if (late) this.measurements.lateFrames += 1;
    const cutIndex = Number(plan.base[0]?.id.replace('cut-', ''));
    if (Number.isInteger(cutIndex) && cutIndex !== this.lastCutIndex) {
      const streamId = `cut-${cutIndex}`;
      const bucket = this.scheduler.isWarmed(streamId)
        ? this.measurements.boundaryAfter : this.measurements.boundaryBefore;
      bucket.total += 1;
      if (late) bucket.late += 1;
      this.lastCutIndex = cutIndex;
    }
    if (reason === 'seek') {
      const reached = performance.now() - requestedAt;
      this.measurements.seekLatestMs = reached;
      const allHit = this.currentAccesses.length > 0 && this.currentAccesses.every(access => access.hit);
      (allHit ? this.measurements.seekAfterMs : this.measurements.seekBeforeMs).push(reached);
    }
    const presented = performance.now();
    this.lastPresentedSec = timeUs / 1e6;
    this.measurements.presentedAt.push(presented);
    this.measurements.presentedAt = this.measurements.presentedAt.filter(value => value >= presented - 1000);
    this.scheduler.notePresented(timeUs, { reason });
    this.currentAccesses = null;
    this.currentDecodedFrames = null;
    this.updateMetrics();
  }

  private updateMetrics(): void {
    const m = this.measurements;
    const before = percentile(m.seekBeforeMs);
    const after = percentile(m.seekAfterMs);
    const fps = m.presentedAt.length;
    const format = (value: number | null) => value == null ? '—' : value.toFixed(1);
    const scheduler = this.scheduler.state();
    const audio = this.audio.debug();
    this.ui.metrics.dataset.fps = String(fps);
    this.ui.metrics.dataset.lateFrames = String(m.lateFrames);
    this.ui.metrics.dataset.seekMs = m.seekLatestMs == null ? '' : m.seekLatestMs.toFixed(3);
    this.ui.metrics.dataset.seekBeforeMs = before == null ? '' : before.toFixed(3);
    this.ui.metrics.dataset.seekAfterMs = after == null ? '' : after.toFixed(3);
    this.ui.metrics.dataset.boundaryLateBefore = `${m.boundaryBefore.late}/${m.boundaryBefore.total}`;
    this.ui.metrics.dataset.boundaryLateAfter = `${m.boundaryAfter.late}/${m.boundaryAfter.total}`;
    this.ui.metrics.dataset.uploadPath = this.compositor.uploadPath;
    this.ui.metrics.dataset.requestedTimeUs = this.lastRequestedTimeUs == null
      ? '' : String(this.lastRequestedTimeUs);
    this.ui.metrics.dataset.baseFrameTimestampUs = this.lastBaseFrame == null
      ? '' : String(this.lastBaseFrame.timestampUs);
    this.ui.metrics.dataset.baseFrameDurationUs = this.lastBaseFrame?.durationUs == null
      ? '' : String(this.lastBaseFrame.durationUs);
    this.ui.metrics.dataset.warmupCoverage = `${scheduler.coverage.warmed}/${scheduler.coverage.needed}`;
    this.ui.metrics.dataset.liveDecoders = `${scheduler.liveDecoders}/${scheduler.maxLiveDecoders}`;
    this.ui.metrics.dataset.leadInSec = scheduler.leadInSeconds.toFixed(2);
    this.ui.metrics.dataset.audioSpeech = String(audio.scheduled.speech);
    this.ui.metrics.dataset.speechDecodeMs = audio.speechDecode.totalMs.toFixed(3);
    this.ui.metrics.textContent = [
      `fps (presented/1s)  ${fps}`,
      `late frame          ${m.lateFrames}`,
      `seek reach latest   ${format(m.seekLatestMs)} ms`,
      `seek before (cold)  ${format(before)} ms`,
      `seek after (cache)  ${format(after)} ms`,
      `boundary late       before ${m.boundaryBefore.late}/${m.boundaryBefore.total}`,
      `                    after  ${m.boundaryAfter.late}/${m.boundaryAfter.total}`,
      `warmup median       ${format(percentile(m.warmupMs))} ms`,
      `upload path         ${this.compositor.uploadPath}`,
      `warmup coverage     ${scheduler.coverage.warmed}/${scheduler.coverage.needed}`,
      `live decoders       ${scheduler.liveDecoders}/${scheduler.maxLiveDecoders}`,
      `lead-in             ${scheduler.leadInSeconds.toFixed(2)} s`,
      `speech              ${audio.scheduled.speech}  decode ${format(audio.speechDecode.totalMs)} ms`,
    ].join('\n');
  }

  private showError(message: string, fatal: boolean): void {
    if (fatal) {
      this.ui.error.hidden = false;
      this.ui.error.textContent = `Frame engine: ${message}`;
    } else {
      console.warn(`[frame-engine] ${message}`);
    }
  }
}

export async function createFrameEnginePreview(options: PreviewOptions): Promise<{
  snapshot(): PreviewSnapshot;
  seek(seconds: number): number;
  renderPlayback(seconds: number): number;
  rebuild(edit: any, timelineData: any, fps: number): Promise<void>;
  dispose(): void;
  audioDebug(): PreviewAudioSupplyDebug;
}> {
  const ui = createUi(options.stage);
  let runtime = new FrameEngineRuntime(ui, options.edit, options.timelineData, options.fps);
  await runtime.prime();
  const preview = {
    snapshot: () => runtime.snapshot(),
    seek: seconds => runtime.seek(seconds),
    renderPlayback: seconds => runtime.renderPlayback(seconds),
    async rebuild(edit, timelineData, fps) {
      runtime.dispose();
      replaceCanvas(ui);
      ui.error.hidden = true;
      ui.root.dataset.frameEngineReady = 'false';
      runtime = new FrameEngineRuntime(ui, edit, timelineData, fps);
      await runtime.prime();
    },
    dispose() {
      runtime.dispose();
      ui.root.remove();
    },
    audioDebug: () => runtime.audioDebug(),
  };
  (window as any).akariFrameEngineAudioDebug = () => runtime.audioDebug();
  return preview;
}
