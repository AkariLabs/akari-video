import {
  buildResolvedTimelinePlan,
  CachedStillImageSource,
  chooseSource,
  ClipSessionPool,
  createPreviewAudioSupply,
  createPreviewScheduler,
  evaluationPlanFromResolvedTimeline,
  evaluateFrame,
  FrameMetrics,
  LookaheadFrameSource,
  parseCube,
  parseSourceSelectionMode,
  probeSourceCodec,
  projectSpeechDeclarations,
  ScrubController,
  setForceSoftwareDecode,
  needsCodecProbe,
  WebGL2Compositor,
} from '../../frame-engine/src/index.ts';
import type {
  CodecSupport,
  EvaluationPlan,
  FrameEngineCut,
  FrameEngineLayer,
  LookaheadAccess,
  NativeFrameSource,
  PreviewScheduler,
  PreviewAudioSupply,
  PreviewAudioSupplyDebug,
  ResolvedTimelinePlan,
} from '../../frame-engine/src/index.ts';
import type { PreviewAudioDeclaration, PreviewSpeechDeclaration } from '../../frame-engine/src/audio/preview-audio-supply.ts';

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
  sources: Array<Omit<SourceChoice, 'support'>>;
}

interface SourceCandidate {
  id: string;
  originalUrl: string;
  proxyUrl: string | null;
}

interface SourceChoice {
  id: string;
  url: string;
  chosen: 'original' | 'proxy' | 'auto-proxy' | 'image';
  reason: string;
  codec?: string;
  support?: CodecSupport | null;
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
  boundaryBefore: { total: number; late: number; hit: number };
  boundaryAfter: { total: number; late: number; hit: number };
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

function audioDeclarations(edit: any): PreviewAudioDeclaration[] {
  const audio = edit?.audio;
  if (!audio || typeof audio !== 'object') return [];
  const declarations: PreviewAudioDeclaration[] = [];
  const append = (kind: 'bgm' | 'sfx' | 'narration', raw: any, fallbackId: string, duckKey = false) => {
    if (!raw || typeof raw !== 'object') return;
    const source = raw.src || raw.path;
    if (typeof source !== 'string' || !source) return;
    const id = typeof raw.id === 'string' && raw.id ? raw.id : fallbackId;
    const sidecar = (raw.sidecarState === 'ready' || raw.sidecarState === undefined) && raw.sidecar?.path ? { ...raw.sidecar, path: mediaUrl(raw.sidecar.path) } : undefined;
    declarations.push({
      kind,
      ...(duckKey ? { duckKey: true } : {}),
      id,
      url: sidecar?.path ?? mediaUrl(source),
      ...(sidecar ? { sourceUrl: mediaUrl(source) } : {}),
      spec: { ...raw, sidecar, sidecarState: raw.sidecarState, id, durationSec: 0 },
    });
  };
  append('bgm', audio.bgm, 'bgm');
  if (Array.isArray(audio.sfx)) {
    audio.sfx.forEach((item: any, index: number) => append('sfx', item, `sfx-${index + 1}`));
  }
  if (Array.isArray(audio.narration)) {
    audio.narration.forEach((item: any, index: number) => append('narration', item, `narration-${index + 1}`));
  }
  if (Array.isArray(audio.speech)) {
    audio.speech.filter((item: any) => item.role === 'speech').forEach((item: any, index: number) =>
      append('narration', item, `speech-${index + 1}`, true));
  }
  return declarations;
}

function speechDeclarations(edit: any, fps: number, choices: Map<string, SourceChoice>): PreviewSpeechDeclaration[] {
  const cuts = normalizedCuts(edit);
  const embedded = edit?.audio?.embeddedSpeech ?? (Array.isArray(edit?.audio?.speech)
    && !edit.audio.speech.some((item: any) => item.role === 'speech') ? edit.audio.speech : undefined);
  const projected = Array.isArray(embedded) ? embedded : projectSpeechDeclarations(cuts, { fps });
  const audibleIds = cuts.length > 0
    ? new Set(projectSpeechDeclarations(cuts, { fps }).map(item => item.id)) : undefined;
  return projected.flatMap((declaration: any) => {
    if (audibleIds && !audibleIds.has(declaration.id)) return [];
    const url = choices.get(declaration.src)?.url;
    if (!url) return [];
    const canUseSidecar = declaration.sidecarState === 'ready' || declaration.sidecarState === undefined;
    return [{
      ...declaration, url, sidecarState: declaration.sidecarState,
      sidecar: canUseSidecar && declaration.sidecar?.path
        ? { ...declaration.sidecar, path: mediaUrl(declaration.sidecar.path) } : undefined,
      atempo: canUseSidecar && !declaration.sidecar?.path && declaration.atempo?.path
        ? { ...declaration.atempo, path: mediaUrl(declaration.atempo.path) } : undefined,
    }];
  });
}

function resolvedItemAdjust(item: any, adjustLutCubeTexts: Record<string, string> | undefined): any {
  const adjust = item?.adjust;
  if (!adjust || typeof adjust !== 'object' || adjust.lut == null || adjust.sections?.lut === false) return item;
  if (typeof adjust.lut?.lut !== 'string') return item;
  const cubeText = adjustLutCubeTexts?.[String(item.id)];
  return {
    ...item,
    adjust: {
      ...adjust,
      lut: typeof cubeText === 'string'
        ? { ...adjust.lut, lut: parseCube(cubeText) }
        : null,
    },
  };
}

function normalizedCuts(edit: any): FrameEngineCut[] {
  const cuts = Array.isArray(edit?.cuts) ? edit.cuts : [];
  const declaredTracks = cuts
    .map((cut: any) => cut?.track)
    .filter((value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0);
  const baseTrack = declaredTracks.length > 0 ? Math.min(...declaredTracks) : 0;
  return cuts.map((cut: any, index: number) => {
    // Track 0 (the main cuts chain) stays on the sequential frame-engine timeline: renderer
    // projection includes derived at/track fields even for that path; remove them so freeze can
    // extend the timeline and transition overlap is recomputed from the declared transition itself.
    // Cuts on upper visual tracks (track >= 1) keep at/track so they are placed absolutely; stripping
    // them chained the clip after the main track and silently dropped it past the end (issue #31).
    // Z order is the frame-engine default (higher track number in front), same as the export runtimes.
    const { at: _derivedAt, track: _derivedTrack, ...sequential } = cut;
    // 最下段は「track 0」ではなく「最小の track」（shell の normalizedCuts と同じ規則。
    // 全カットが track 1 に載る編集で全部を絶対配置にしてしまい、freeze / transition の再計算が
    // 効かなくなる差を塞ぐ — task/2026-09-02-preview-perf: パリティ）。
    const track = Number.isInteger(cut.track) && cut.track > baseTrack ? Number(cut.track) : 0;
    const placement = track > 0
      ? { track, ...(Number.isFinite(cut.at) && cut.at >= 0 ? { at: Number(cut.at) } : {}) }
      : {};
    return resolvedItemAdjust({
      ...sequential,
      ...placement,
      src: cut.src ?? (Array.isArray(edit?.sources) ? edit.sources[0]?.id : 'default'),
      in: Number(cut.in ?? 0),
      out: Number(cut.out ?? cut.in ?? 0),
      transition_out: cut.transition_out ?? cut.transitionOut,
      id: cut.id ?? `cut-${index}`,
    }, edit?.adjustLutCubeTexts);
  });
}

function resolvedEngineLayers(edit: any): any[] {
  const frameEngineIntake = edit?.frameEngine?.intake ?? {};
  const skippedLayers = new Set(Array.isArray(edit?.frameEngine?.skipped) ? edit.frameEngine.skipped : []);
  return (Array.isArray(edit?.layers) ? edit.layers : [])
    .map((layer: any, index: number) => {
      const key = String(layer?.id ?? layer?.src ?? index);
      if (skippedLayers.has(key)) return null;
      const prepared = frameEngineIntake[key];
      const intakeResolved = prepared ? { ...layer, src: prepared.src, mask: prepared.mask } : layer;
      const resolved = resolvedItemAdjust(intakeResolved, edit?.adjustLutCubeTexts);
      if (resolved?.kind !== 'filter' || resolved?.filter?.type !== 'lut'
        || typeof resolved.filter.cubeText !== 'string') return resolved;
      return {
        ...resolved,
        filter: {
          type: 'lut',
          lut: parseCube(resolved.filter.cubeText),
          intensity: Math.max(0, Math.min(1, Number(resolved.filter.intensity ?? 1))),
        },
      };
    })
    .filter(Boolean);
}

function sourceCandidates(
  edit: any,
  timelineData: any,
  cuts: readonly FrameEngineCut[],
  engineLayers: readonly any[] = [],
): Map<string, SourceCandidate> {
  const candidates = new Map<string, SourceCandidate>();
  if (Array.isArray(edit?.sources)) {
    for (const source of edit.sources) {
      if (source?.id && source.path) {
        const id = String(source.id);
        candidates.set(id, {
          id,
          originalUrl: mediaUrl(source.path),
          proxyUrl: source.proxy ? mediaUrl(source.proxy) : null,
        });
      }
    }
  } else if (edit?.source?.path) {
    candidates.set('default', {
      id: 'default', originalUrl: mediaUrl(edit.source.path), proxyUrl: null,
    });
  }
  for (let index = 0; index < cuts.length; index += 1) {
    const clip = timelineData?.clips?.find((item: any) => item.id === `cut-${index}`);
    const sourceId = cuts[index]?.src;
    if (clip?.src && sourceId) {
      const clipUrl = mediaUrl(clip.src);
      const declared = candidates.get(sourceId);
      // edit-to-timeline projects a declared proxy into clips[].src. That is not an override:
      // keep the original/proxy pair so capability selection can still choose the original.
      if (!declared || (clipUrl !== declared.originalUrl && clipUrl !== declared.proxyUrl)) {
        candidates.set(sourceId, { id: sourceId, originalUrl: clipUrl, proxyUrl: null });
      }
    }
  }
  for (const layer of engineLayers) {
    for (const value of [layer?.src, layer?.mask]) {
      if (typeof value !== 'string' || !value) continue;
      candidates.set(value, { id: value, originalUrl: mediaUrl(value), proxyUrl: null });
    }
  }
  return candidates;
}

function autoProxyPath(url: string): string {
  const parsed = new URL(url, window.location.href);
  return decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
}

async function requestAutoProxy(
  candidate: SourceCandidate,
  ui: ReturnType<typeof createUi>,
  isCurrent: () => boolean,
): Promise<string | null> {
  if (!isCurrent()) return null;
  const path = autoProxyPath(candidate.originalUrl);
  ui.showNotice(`プロキシ生成中…（${candidate.id}）`);
  try {
    const start = await fetch('/api/auto-proxy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!start.ok) return null;
    const deadline = Date.now() + 300_000;
    while (isCurrent() && Date.now() < deadline) {
      const response = await fetch(`/api/auto-proxy?path=${encodeURIComponent(path)}`);
      if (!response.ok) return null;
      const result = await response.json();
      if (result.status === 'ready' && typeof result.url === 'string') return result.url;
      if (result.status === 'failed' || result.status === 'unavailable') return null;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return null;
  } catch {
    return null;
  }
}

// Keep this selector self-contained so startup requirements can be checked without a browser.
function initialSourceIds(
  edit: any,
  timelineData: any,
  cuts: readonly FrameEngineCut[],
  layers: readonly FrameEngineLayer[],
  atSeconds: number,
): Set<string> {
  const ids = new Set<string>();
  if (!Number.isFinite(atSeconds) || atSeconds < 0 || cuts.length === 0) return ids;
  const finite = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const cursors = new Map<number, number>();
  const overlaps = new Map<number, number>();
  // Same virtual duration and per-track cursor as buildResolvedTimelinePlan/computeCutTrackSegments.
  for (const cut of cuts) {
    const track = Number.isInteger(cut.track) && Number(cut.track) >= 0 ? Number(cut.track) : 0;
    const speed = finite(cut.speed, 1) > 0 ? finite(cut.speed, 1) : 1;
    const freeze = Math.max(0, finite(cut.freeze?.duration_sec, 0));
    const duration = Math.max(0, cut.out + freeze * speed - cut.in) / speed;
    const at = Number.isFinite(cut.at) && Number(cut.at) >= 0
      ? Number(cut.at) : (cursors.get(track) ?? 0) - (overlaps.get(track) ?? 0);
    const end = at + duration;
    cursors.set(track, end);
    overlaps.set(track, (cut.transition_out ?? cut.transitionOut)?.duration ?? 0);
    if (atSeconds >= at && atSeconds < end) {
      const id = cut.src ?? edit?.sources?.[0]?.id ?? 'default';
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  const fps = finite(timelineData?.fps, 30) > 0 ? finite(timelineData?.fps, 30) : 30;
  const frame = Math.floor(atSeconds * fps + 1e-9);
  for (const layer of layers) {
    const start = Math.max(0, Math.ceil(finite(layer.t, 0) * fps - 1e-6));
    const end = Math.max(start, Math.ceil((finite(layer.t, 0)
      + Math.max(0, finite(layer.duration, 0))) * fps - 1e-6));
    if (frame < start || frame >= end || layer.kind === 'filter') continue;
    for (const id of [layer.src, layer.mask]) {
      if (typeof id === 'string' && id) ids.add(id);
    }
  }
  return ids;
}

async function resolveSourceChoices(
  candidates: Map<string, SourceCandidate>,
  context: {
    mode: 'auto' | 'proxy' | 'original';
    ui: ReturnType<typeof createUi>;
    cutSourceIds: ReadonlySet<string>;
    initialIds: ReadonlySet<string>;
    firstUses: ReadonlyMap<string, number>;
    isCurrent(): boolean;
  },
): Promise<{ choices: Map<string, SourceChoice>; startBackground(runtime: FrameEngineRuntime): void }> {
  const choices = new Map<string, SourceChoice>();
  const completedProxies = new Map<string, SourceChoice>();
  const pendingProxies = new Set<string>();
  const failedProxies = new Set<string>();
  let target: FrameEngineRuntime | null = null;
  const apply = async (choice: SourceChoice) => {
    if (!context.isCurrent() || !target) return;
    await target.applySourceChoice(choice.id, choice);
    // Metadata can finish resolving even when the decoder URL/support are unchanged.
    if (context.isCurrent()) choices.set(choice.id, choice);
  };
  const updateNotice = () => {
    if (!context.isCurrent()) return;
    const failed = failedProxies.values().next().value;
    const pending = pendingProxies.values().next().value;
    if (failed) context.ui.showNotice(`プロキシを生成できませんでした（${failed}）`);
    else if (pending) context.ui.showNotice(`プロキシ生成中…（${pending}）`);
    else context.ui.clearNotice();
  };
  const resolveCandidate = async (candidate: SourceCandidate): Promise<SourceChoice> => {
    if (!context.cutSourceIds.has(candidate.id)) {
      return {
        id: candidate.id,
        url: candidate.originalUrl,
        chosen: 'original',
        reason: 'not-a-cut-source',
        support: null,
      };
    }
    const isImage = /\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/iu.test(candidate.originalUrl);
    if (isImage) {
      return {
        id: candidate.id, url: candidate.originalUrl, chosen: 'image', reason: 'still-image',
      };
    }
    const hasProxy = candidate.proxyUrl != null;
    if (!needsCodecProbe(context.mode, hasProxy)) {
      const decision = chooseSource({ mode: context.mode, hasProxy, support: null });
      return {
        id: candidate.id,
        url: decision.chosen === 'proxy' ? candidate.proxyUrl! : candidate.originalUrl,
        chosen: decision.chosen,
        reason: decision.reason,
        support: null,
      };
    }
    const probe = await probeSourceCodec(candidate.originalUrl, { query: { akariNoProxy: '1' } });
    const codec = probe.info?.codec;
    const decision = chooseSource({ mode: context.mode, hasProxy, support: probe.support });
    if (decision.chosen === 'original') {
      return {
        id: candidate.id,
        url: candidate.originalUrl,
        chosen: 'original',
        reason: decision.reason,
        ...(codec ? { codec } : {}),
        support: probe.support,
      };
    } else if (decision.chosen === 'proxy') {
      return {
        id: candidate.id,
        url: candidate.proxyUrl!,
        chosen: 'proxy',
        reason: decision.reason,
        ...(codec ? { codec } : {}),
        support: null,
      };
    } else {
      const provisional: SourceChoice = {
        id: candidate.id,
        url: candidate.originalUrl,
        chosen: 'original',
        reason: 'auto-proxy-pending',
        ...(codec ? { codec } : {}),
        support: probe.support,
      };
      if (context.isCurrent()) {
        pendingProxies.add(candidate.id);
        void requestAutoProxy(candidate, context.ui, context.isCurrent).then(async proxyUrl => {
          if (!context.isCurrent()) return;
          pendingProxies.delete(candidate.id);
          if (!proxyUrl) failedProxies.add(candidate.id);
          const choice: SourceChoice = {
            ...provisional,
            url: proxyUrl ?? candidate.originalUrl,
            chosen: proxyUrl ? 'auto-proxy' : 'original',
            reason: proxyUrl ? 'auto-proxy' : 'auto-proxy-failed',
            support: proxyUrl ? null : probe.support,
          };
          completedProxies.set(candidate.id, choice);
          updateNotice();
          await apply(choice);
        }).catch(error => {
          if (context.isCurrent()) console.warn('[frame-engine] source replacement failed', error);
        });
      }
      return provisional;
    }
  };
  const remaining: SourceCandidate[] = [];
  for (const candidate of candidates.values()) {
    const immediate = !context.cutSourceIds.has(candidate.id)
      || /\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/iu.test(candidate.originalUrl);
    if (immediate || context.initialIds.has(candidate.id)) {
      choices.set(candidate.id, await resolveCandidate(candidate));
      if (!context.isCurrent()) break;
    } else {
      choices.set(candidate.id, {
        id: candidate.id, url: candidate.originalUrl, chosen: 'original',
        reason: 'pending-probe', support: null,
      });
      remaining.push(candidate);
    }
  }
  remaining.sort((left, right) => (context.firstUses.get(left.id) ?? Infinity)
    - (context.firstUses.get(right.id) ?? Infinity));
  return {
    choices,
    startBackground(runtime) {
      if (!context.isCurrent() || target) return;
      target = runtime;
      for (const choice of completedProxies.values()) {
        void apply(choice).catch(error => console.warn('[frame-engine] source replacement failed', error));
      }
      let cursor = 0;
      const worker = async () => {
        while (context.isCurrent()) {
          const candidate = remaining[cursor++];
          if (!candidate) return;
          try {
            const choice = await resolveCandidate(candidate);
            // A fast proxy completion takes precedence over its provisional choice.
            await apply(completedProxies.get(candidate.id) ?? choice);
          } catch (error) {
            if (context.isCurrent()) console.warn(`[frame-engine] source ${candidate.id}:`, error);
          }
        }
      };
      void worker();
      void worker();
    },
  };
}

function createUi(stage: HTMLElement): {
  root: HTMLDivElement;
  canvas: HTMLCanvasElement;
  metrics: HTMLDivElement;
  error: HTMLDivElement;
  notice: HTMLDivElement;
  showNotice(message: string): void;
  clearNotice(): void;
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

  const notice = document.createElement('div');
  notice.id = 'frame-engine-notice';
  notice.hidden = true;
  Object.assign(notice.style, {
    position: 'absolute', zIndex: '2147483646', inset: 'auto 10% 10%', padding: '10px 12px', borderRadius: '6px',
    border: '1px solid rgba(116,192,252,.65)', background: 'rgba(8,32,56,.92)', color: '#d8efff', textAlign: 'center',
  });

  const showNotice = (message: string) => {
    notice.hidden = false;
    notice.textContent = message;
    root.dataset.frameEngineNotice = message;
  };
  const clearNotice = () => {
    notice.hidden = true;
    notice.textContent = '';
    delete root.dataset.frameEngineNotice;
  };

  root.append(canvas, metrics, notice, error);
  stage.prepend(root);
  return { root, canvas, metrics, error, notice, showNotice, clearNotice };
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
  private readonly sources = new Map<string, NativeFrameSource | CachedStillImageSource>();
  private readonly timeline: ResolvedTimelinePlan;
  private readonly compositor: WebGL2Compositor;
  private readonly frameMetrics = new FrameMetrics();
  private readonly scheduler: PreviewScheduler;
  private readonly scrub: ScrubController;
  private readonly output: EvaluationPlan['output'];
  private readonly audio: PreviewAudioSupply;
  private readonly measurements: Measurements = {
    presentedAt: [], lateFrames: 0, seekLatestMs: null, seekBeforeMs: [], seekAfterMs: [],
    boundaryBefore: { total: 0, late: 0, hit: 0 }, boundaryAfter: { total: 0, late: 0, hit: 0 }, warmupMs: [],
  };
  private rendering: Promise<void> | null = null;
  private lastPlaybackFrame = -1;
  private lastPresentedSec = 0;
  private lastCutIndex: number | null = null;
  private boundaryLastMs: { elapsed: number; decode: number; hit: boolean } | null = null;
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
    private readonly sourceChoices: Map<string, SourceChoice>,
  ) {
    // The compositor owns the visible canvas directly: no per-frame WebGL -> 2D readback/blit.
    this.compositor = new WebGL2Compositor(ui.canvas, {
      synchronization: 'flush',
      uploadPath: requestedUploadPath,
    });
    const cuts = normalizedCuts(edit);
    const urls = new Map([...sourceChoices].map(([id, choice]) => [id, choice.url]));
    const engineLayers = resolvedEngineLayers(edit);
    for (const warning of Array.isArray(edit?.frameEngine?.warnings) ? edit.frameEngine.warnings : []) {
      this.showError(String(warning), false);
    }
    for (const layer of engineLayers) {
      if (!layer?.src) continue;
      const key = String(layer.src);
      if (!urls.has(key)) urls.set(key, mediaUrl(key));
      if (layer.mask) {
        const maskKey = String(layer.mask);
        if (!urls.has(maskKey)) urls.set(maskKey, mediaUrl(maskKey));
      }
    }
    for (const [id, url] of urls) {
      if (/\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/iu.test(url)) {
        const image = new CachedStillImageSource(url);
        this.images.set(id, image);
        this.sources.set(id, image);
        continue;
      }
      this.sources.set(id, this.createVideoSource(id, url));
    }
    this.timeline = buildResolvedTimelinePlan(cuts, {
      fps,
      layers: engineLayers as FrameEngineLayer[],
    });
    this.totalDuration = this.timeline.totalDuration;
    const speech = speechDeclarations(edit, fps, sourceChoices);
    this.audio = createPreviewAudioSupply({
      timelineDurationSec: this.totalDuration,
      declarations: audioDeclarations(edit),
      speech,
      // playbackTime() が rAF ループからしか呼ばれないため、1 フレームがこの時間を超えると
      // 音声が pause → 次フレームで再開になる。150 ms では 3D / 字幕の重いフレームで
      // 途切れが慢性化していたので、タブ非表示の検知が少し遅れるのを受け入れて広げる。
      pauseWatchdogMs: 600,
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

  private createVideoSource(id: string, url: string): NativeFrameSource {
    const choice = this.sourceChoices.get(id);
    const pool = new ClipSessionPool(id, url, {
      codecSupport: choice?.support,
      onWarning: message => this.showError(message, false),
      onSoftwareFallbackDenied: support => {
        if (!(choice?.support?.hw || choice?.support?.any)) {
          this.ui.showNotice(`ソフトウェアデコード非対応: ${support.codec}`);
        }
      },
    });
    // 先読みキャッシュの枚数 = デコーダの出力 surface を握り続ける枚数。12 枚だと Windows の
    // D3D11 HW デコーダ（4K HEVC）が surface 切れで黙り、入力を飲み込んだまま 1 枚も出さなくなる
    // （LookaheadCache.makeRoom の注記 = issue #28 と同じ機構）。実機 2026-09-05・90 秒再生:
    //   12 枚: 凍結 11 回（最長 9 s）・デコーダ作り直し 49 回・17 fps
    //    6 枚: 凍結 0 回・作り直し 0 回・30 fps・カット境界の late 0/1
    //    3 枚: 凍結 0 回・作り直し 3 回・23 fps
    // 6 が滑らかさと境界先読みの両立点。恒久策（内外で surface 予算を共有し、GOP をまたいで
    // 供給を続ける）は別票。
    const source = new LookaheadFrameSource(pool, {
      fps: this.fps,
      capacity: 6,
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
    return observedSource;
  }

  async prime(start = 0): Promise<void> {
    // 音声の先読みは映像の初回描画より前に投げる。後ろに置くと、最初の 2 フレームが
    // 描けない案件（実機 2026-09-05: 9〜10GB の HEVC 4 本 + proxy 生成待ち）で
    // ここへ到達できず、音声を 1 バイトも取りに行かないまま無音になる。
    // prime() は fire-and-forget なので、以降の描画とは並行して進む。
    this.audio.prime();
    const first = performance.now();
    // renderFrame rebuilds the same evaluation plan at the same time; a second draw only hits
    // warmed lookahead/pools, with no change in output quality. One presentation is sufficient.
    await this.renderFrame(start, 'seek', first);
    if (this.disposed) return;
    this.ui.root.dataset.frameEngineReady = 'true';
    this.scheduler.primeHeaders();
    this.scheduler.warmupNextBoundary(start);
  }

  currentTime(): number {
    return this.lastPresentedSec;
  }

  async applySourceChoice(id: string, choice: SourceChoice): Promise<void> {
    if (this.disposed) return;
    const current = this.sourceChoices.get(id);
    const sameSupport = (current?.support ?? null) === (choice.support ?? null)
      || (current?.support != null && choice.support != null
        && current.support.codec === choice.support.codec
        && current.support.hw === choice.support.hw
        && current.support.sw === choice.support.sw
        && current.support.any === choice.support.any);
    if (current?.url === choice.url && sameSupport) return;
    // Wait for every active render, including a newly requested seek. This also protects sources
    // entering the next frame, beyond those used by the last presented base/layer/mask.
    while (this.rendering && !this.disposed) await this.waitForRender();
    if (this.disposed) return;
    this.lookahead.get(id)?.clear();
    this.pools.get(id)?.destroy();
    this.images.get(id)?.destroy();
    this.sourceChoices.set(id, choice);
    if (/\.(png|jpe?g|webp|bmp|gif)(?:$|[?#])/iu.test(choice.url)) {
      this.pools.delete(id);
      this.lookahead.delete(id);
      const image = new CachedStillImageSource(choice.url);
      this.images.set(id, image);
      this.sources.set(id, image);
      this.scheduler.invalidateSource(id);
    } else {
      this.images.delete(id);
      this.sources.set(id, this.createVideoSource(id, choice.url));
      this.scheduler.invalidateSource(id);
    }
    // Keep the maps captured by the scheduler alive; snapshot() reads the current choices.
    this.updateMetrics();
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
    return {
      totalDuration: this.totalDuration,
      segments: this.segments,
      sources: [...this.sourceChoices.values()].map(({ support: _support, ...choice }) => choice),
    };
  }

  updateAudio(edit: any): void {
    if (this.disposed) return;
    this.audio.updateAudio({
      declarations: audioDeclarations(edit),
      speech: speechDeclarations(edit, this.fps, this.sourceChoices),
    });
  }

  audioDebug(): PreviewAudioSupplyDebug {
    return this.audio.debug();
  }

  /** ゲートで共通時計を据え置いている間の開始位置。据え置いていなければ null。 */
  heldStartSec(): number | null {
    const gate = this.audio.debug().supply.gate;
    return gate.holding ? gate.startSec : null;
  }

  dispose(): void {
    if (this.disposed) return;
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
    if (this.disposed) return;
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
      const baseAccesses = this.currentAccesses.filter(access =>
        plan.base.some(layer => layer.id === access.streamId));
      const hit = baseAccesses.length > 0 && baseAccesses.every(access => access.hit === true);
      bucket.total += 1;
      if (late) bucket.late += 1;
      if (hit) bucket.hit += 1;
      this.boundaryLastMs = {
        elapsed,
        decode: Math.max(0, ...baseAccesses.map(access => access.decodeMs)),
        hit,
      };
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
    this.ui.metrics.dataset.boundaryHitAfter = `${m.boundaryAfter.hit}/${m.boundaryAfter.total}`;
    this.ui.metrics.dataset.boundaryLastMs = this.boundaryLastMs == null ? ''
      : `${this.boundaryLastMs.elapsed.toFixed(1)}/${this.boundaryLastMs.decode.toFixed(1)}`;
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
    this.ui.metrics.dataset.audioPrefetchPending = String(audio.prefetch.pending);
    this.ui.metrics.dataset.audioPrefetchBytes = String(audio.prefetch.decodedBytes);
    this.ui.metrics.textContent = [
      `fps (presented/1s)  ${fps}`,
      `late frame          ${m.lateFrames}`,
      `seek reach latest   ${format(m.seekLatestMs)} ms`,
      `seek before (cold)  ${format(before)} ms`,
      `seek after (cache)  ${format(after)} ms`,
      `boundary late       before ${m.boundaryBefore.late}/${m.boundaryBefore.total}`,
      `                    after  ${m.boundaryAfter.late}/${m.boundaryAfter.total}`,
      `boundary last       ${format(this.boundaryLastMs?.elapsed ?? null)} ms / decode ${format(this.boundaryLastMs?.decode ?? null)} ms  hit ${this.boundaryLastMs?.hit ?? '—'}`,
      `warmup median       ${format(percentile(m.warmupMs))} ms`,
      `upload path         ${this.compositor.uploadPath}`,
      `warmup coverage     ${scheduler.coverage.warmed}/${scheduler.coverage.needed}`,
      `live decoders       ${scheduler.liveDecoders}/${scheduler.maxLiveDecoders}`,
      `lead-in             ${scheduler.leadInSeconds.toFixed(2)} s`,
      `speech              ${audio.scheduled.speech}  decode ${format(audio.speechDecode.totalMs)} ms`,
      `audio prefetch      ${audio.prefetch.items - audio.prefetch.pending}/${audio.prefetch.items}`
        + `  ${format(audio.prefetch.elapsedMs)} ms`,
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
  updateAudio(edit: any): void;
  dispose(): void;
  audioDebug(): PreviewAudioSupplyDebug;
  heldStartSec(): number | null;
}> {
  const ui = createUi(options.stage);
  let generation = 0;
  let disposed = false;
  let preparingRuntime: FrameEngineRuntime | null = null;
  const prepareRuntime = async (
    edit: any, timelineData: any, fps: number, start: number,
  ): Promise<FrameEngineRuntime | null> => {
    const token = ++generation;
    const isCurrent = () => !disposed && token === generation;
    ui.clearNotice();
    const params = new URLSearchParams(window.location.search);
    let forceSoftware = params.get('frameEngineForceSw') === '1';
    try {
      const response = await fetch('/api/codec-info');
      if (response.ok) forceSoftware ||= (await response.json()).forceSoftwareDecode === true;
    } catch {
      // Codec capability probing remains optional when the server endpoint is unavailable.
    }
    if (!isCurrent()) return null;
    setForceSoftwareDecode(forceSoftware);
    const cuts = normalizedCuts(edit);
    const layers = resolvedEngineLayers(edit);
    const candidates = sourceCandidates(edit, timelineData, cuts, layers);
    const timeline = buildResolvedTimelinePlan(cuts, { fps, layers });
    start = Math.max(0, Math.min(start, timeline.totalDuration));
    const firstUses = new Map<string, number>();
    const noteUse = (id: string | undefined, seconds: number) => {
      if (id) firstUses.set(id, Math.min(firstUses.get(id) ?? Infinity, seconds));
    };
    for (const placement of timeline.cuts) noteUse(placement.cut.src, placement.at);
    for (const layer of layers) {
      noteUse(layer.src, layer.t);
      noteUse(layer.mask, layer.t);
    }
    const resolution = await resolveSourceChoices(candidates, {
      mode: parseSourceSelectionMode(params.get('frameEngineSource')),
      ui,
      cutSourceIds: new Set(cuts.map(cut => String(cut.src))),
      initialIds: initialSourceIds(edit, { ...timelineData, fps }, cuts, layers, start),
      firstUses,
      isCurrent,
    });
    if (!isCurrent()) return null;
    const prepared = new FrameEngineRuntime(ui, edit, timelineData, fps, resolution.choices);
    preparingRuntime = prepared;
    try {
      await prepared.prime(start);
      if (!isCurrent()) {
        prepared.dispose();
        return null;
      }
      // No remaining probes or completed proxy replacements can block the first presentation.
      resolution.startBackground(prepared);
      return prepared;
    } catch (error) {
      prepared.dispose();
      if (!isCurrent()) return null;
      throw error;
    } finally {
      if (preparingRuntime === prepared) preparingRuntime = null;
    }
  };
  let runtime = (await prepareRuntime(options.edit, options.timelineData, options.fps, 0))!;
  const preview = {
    snapshot: () => runtime.snapshot(),
    seek: seconds => runtime.seek(seconds),
    renderPlayback: seconds => runtime.renderPlayback(seconds),
    async rebuild(edit, timelineData, fps) {
      if (disposed) return;
      const start = runtime.currentTime();
      generation += 1;
      preparingRuntime?.dispose();
      runtime.dispose();
      replaceCanvas(ui);
      ui.error.hidden = true;
      ui.root.dataset.frameEngineReady = 'false';
      const prepared = await prepareRuntime(edit, timelineData, fps, start);
      if (prepared) runtime = prepared;
    },
    dispose() {
      disposed = true;
      generation += 1;
      preparingRuntime?.dispose();
      runtime.dispose();
      ui.root.remove();
    },
    updateAudio: edit => runtime.updateAudio(edit),
    audioDebug: () => runtime.audioDebug(),
    heldStartSec: () => runtime.heldStartSec(),
  };
  (window as any).akariFrameEngineAudioDebug = () => runtime.audioDebug();
  return preview;
}
