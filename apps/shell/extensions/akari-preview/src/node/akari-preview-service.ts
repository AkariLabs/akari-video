import { inject, injectable } from '@theia/core/shared/inversify';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import { lintProjectCandidates } from '@akari-video/edit-store/lib/write-gate';
import { projectLegacyEdit, readInternalEdit, resolveCaptionDisplay, toAnchorCaptions } from '@akari-video/edit-store';
import { planMigration } from '@akari-video/edit-store/lib/migrate';
import { spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import { constants as fsConstants, createReadStream, readFileSync, rmdirSync, rmSync, statSync, unlinkSync } from 'fs';
import { FileHandle, lstat, mkdtemp, open, readFile, realpath, rm, rmdir, stat, unlink } from 'fs/promises';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { tmpdir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { rewritePreviewFragmentAssets } from './fragment-assets';
import { FragmentAssetPreviewRequest, FragmentAssetPreviewResult } from '../common/akari-preview-protocol';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import { parse as parseJson } from 'jsonc-parser';
import { PromotePreviewAudioSidecarsRequest, PromotePreviewAudioSidecarsResult } from '../common/preview-audio-priority';
import {
    AppendReviewSessionAudioRequest,
    AppendReviewSessionEventRequest,
    AppendReviewSessionStrokeRequest,
    AssetStreamRequest,
    AkariPreviewService,
    BuildWaveformPeaksRequest,
    BuildWaveformPeaksResult,
    EndReviewSessionRequest,
    LintEditCandidateRequest,
    LintEditCandidateResult,
    ListReviewSessionsRequest,
    OverlayRuntimeAssets,
    OverlayRuntimeAssetUrls,
    ProbeAudioPresenceRequest,
    ProbeAudioPresenceResult,
    ReadReviewSessionStrokesRequest,
    ReadReviewSessionStrokesResult,
    PrepareLegacyEditRequest,
    PrepareLegacyEditResult,
    ReadVideoFxLutRequest,
    ResolveHevcProxyRequest,
    ResolveHevcProxyResult,
    PrepareAlphaIntakeRequest,
    PrepareAlphaIntakeResult,
    ReviewSessionSummary,
    ResolveCaptionDisplayRequest,
    ResolvedCaptionDisplayPayload,
    RasterizeTelopPreviewRequest,
    StartReviewSessionRequest,
    StartReviewSessionResult,
    TranscodeAudioErrorKind,
    TranscodeAudioRequest,
    TranscodeAudioResult,
    VideoStreamReference,
    VideoStreamRequest
} from '../common/akari-preview-protocol';
import {
    readCaptionsEmphasisWords,
    readLegacyEditEmphasisWords,
    resolvePreviewEmphasisWords
} from '../common/preview-emphasis-seat';
import { getH264Proxy, probeHasAudioStream, resolveFfmpegPath } from './hevc-proxy';
import { prepareAlphaIntake } from './alpha-intake';
import { ReviewSessionWriter } from './review-session-writer';

interface StreamTarget {
    path: string;
    mimeType: string;
    extension: string;
    workspaceRoots: string[];
}

interface ByteRange {
    start: number;
    end: number;
}

interface TranscodedAudioStreamTarget extends Omit<StreamTarget, 'extension'> {
    temporaryDirectory: string;
}

interface PrepareSpeechAtempoRequest {
    sourceUri: string;
    projectRootUri: string;
    inSec: number;
    outSec?: number;
    speed: number;
    padBeforeSec?: number;
    padAfterSec?: number;
    heavyWavOnly?: boolean;
    format?: 'flac' | 'pcm-s16le';
    decodedBytesThreshold?: number;
    clipFx?: {
        speed?: number;
        pitch_semitones?: number;
        formant?: 'preserve' | 'shift';
        denoise?: { method: 'fft' | 'nlm'; strength: number };
        lowcut_hz?: number;
    };
    workspaceRoots?: string[];
}

interface PrepareSpeechAtempoResult {
    ok: boolean;
    skipped: boolean;
    durationSec: number;
    generatedMs: number;
    eligible?: boolean;
    key?: string;
    bytes?: number;
    sampleRate?: number;
    channels?: number;
    reason?: string;
    stream?: VideoStreamReference;
}

interface PreviewAudioSidecarModuleResult {
    state: 'ready' | 'queued' | 'generating' | 'no-audio' | 'failed' | 'unavailable' | 'invalid' | 'legacy' | 'missing' | 'not-needed';
    key?: string | null;
    path?: string;
    probe?: { fingerprint?: string; pending?: boolean };
    format?: 'flac' | 'pcm-s16le';
    frames?: number;
    bytesPerSample?: number;
    durationSec?: number;
    bytes?: number;
    sampleRate?: number;
    channels?: number;
    reason?: string;
    retryAfterMs?: number;
}

interface PreviewAudioSidecarRequestResult extends Omit<PreviewAudioSidecarModuleResult, 'state' | 'key' | 'path' | 'probe'> {
    state: 'ready' | 'queued' | 'generating' | 'no-audio' | 'failed' | 'unavailable' | 'not-eligible' | 'not-needed';
    key?: string;
    probe?: { fingerprint: string };
    stream?: VideoStreamReference;
}

type PreviewAudioSidecarOptions = {
    sourcePath: string;
    inSec: number;
    outSec?: number;
    speed: number;
    padBeforeSec: number;
    padAfterSec: number;
    clipFx?: PrepareSpeechAtempoRequest['clipFx'];
    format?: 'flac' | 'pcm-s16le';
    decodedBytesThreshold?: number;
    ffmpeg?: string;
    cacheDir: string;
};

// model-update は既存 webview bootstrap が window.akari.state.summary を差し替えてから tick する。
// runtimeJavaScript 内で overlays の署名を監視すれば、webview HTML 本体を変えずに overlay だけを
// soft remount できる。これにより keyframes の追加・変更・除去と html/transform 更新を、
// keyframes 無しプロジェクトの HTML バイト等価を保ったまま差分適用する。
const ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT = `(() => {
  const runtime = window.akari && window.akari.runtime;
  if (!runtime || runtime.__akariItemKeyframesSoftReload) return;
  const mount = runtime.mount.bind(runtime);
  const tick = runtime.tick.bind(runtime);
  const signature = summary => JSON.stringify(Array.isArray(summary?.overlays) ? summary.overlays : []);
  let mountedSignature;
  let remounting = null;
  const snapshotPresentation = () => new Map([...document.querySelectorAll('[data-overlay-id]')].map(element => [
    element.getAttribute('data-overlay-id') || '',
    {
      track: element.getAttribute('data-akari-track'),
      zIndex: element.style.zIndex,
      display: element.style.display,
      selected: element.getAttribute('data-akari-interaction-selected')
    }
  ]));
  const restorePresentation = snapshot => {
    for (const element of document.querySelectorAll('[data-overlay-id]')) {
      const state = snapshot.get(element.getAttribute('data-overlay-id') || '');
      if (!state) continue;
      if (state.track === null) element.removeAttribute('data-akari-track');
      else element.setAttribute('data-akari-track', state.track);
      element.style.zIndex = state.zIndex;
      element.style.display = state.display;
      if (state.selected === null) element.removeAttribute('data-akari-interaction-selected');
      else element.setAttribute('data-akari-interaction-selected', state.selected);
    }
  };
  runtime.mount = summary => {
    mountedSignature = signature(summary);
    return mount(summary);
  };
  runtime.tick = (timelineTime, isPlaying) => {
    const summary = window.akari?.state?.summary;
    const nextSignature = signature(summary);
    if (nextSignature !== mountedSignature && !remounting) {
      mountedSignature = nextSignature;
      const presentation = snapshotPresentation();
      remounting = Promise.resolve(mount(summary)).then(() => {
        restorePresentation(presentation);
        tick(timelineTime, isPlaying);
      }).catch(error => console.error('[akari-preview] overlay remount failed', error))
        .finally(() => { remounting = null; });
      return;
    }
    if (!remounting) return tick(timelineTime, isPlaying);
  };
  Object.defineProperty(runtime, '__akariItemKeyframesSoftReload', { value: true });
})();`;

type SpeechAtempoModule = {
    requestPreviewAudioSidecar(options: PreviewAudioSidecarOptions): PreviewAudioSidecarModuleResult;
    previewAudioSidecarStatus(options: PreviewAudioSidecarOptions): PreviewAudioSidecarModuleResult;
    ensurePreviewAudioSidecar(options: {
        sourcePath: string;
        inSec: number;
        outSec: number;
        speed: number;
        padBeforeSec: number;
        padAfterSec: number;
        ffmpeg?: string;
        cacheDir: string;
    }): Promise<{
        ok: boolean;
        skipped: boolean;
        path: string | null;
        durationSec: number;
        reason: string | null;
        key: string | null;
        sampleRate: number;
        channels: number;
    }>;
    probePreviewAudioSource(sourcePath: string): {
        ok: boolean;
        durationSec: number;
        reason?: string;
    };
    probePreviewAudioSourceAsync(sourcePath: string): Promise<{
        ok: boolean;
        durationSec: number;
        reason?: string;
    }>;
    promotePreviewAudioSidecars(options: { cacheDir: string; keys: string[]; sourcePaths: string[] }): PromotePreviewAudioSidecarsResult;
    sweepPreviewAudioSidecars(options: { cacheDir: string; keepKeys: string[]; keepProbes?: string[]; minAgeMs?: number }): {
        removed: number;
        bytes: number;
    };
};

const VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const ASSET_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm'],
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.pcm', 'application/octet-stream'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.oga', 'audio/ogg'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav'],
    ['.glb', 'model/gltf-binary'],
    ['.otf', 'font/otf'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.ttf', 'font/ttf'],
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.jfif', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp']
]);
const TRANSCODABLE_AUDIO_MIME_TYPES = new Map<string, string>([
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.oga', 'audio/ogg'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav']
]);
const MAX_TRANSCODE_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_TRANSCODE_OUTPUT_BYTES = 200 * 1024 * 1024;
const TRANSCODE_TIMEOUT_MS = 30_000;
const WAVEFORM_PEAKS_TIMEOUT_MS = 10 * 60 * 1000;

function waveformFfmpegArgs(assetPath: string): string[] {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', assetPath,
        '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'];
}

interface StaticAsset {
    body: Buffer;
    mimeType: string;
}

interface OverlayRuntimeSources {
    three: Buffer;
    threeText: Buffer;
    threeRuntime: Buffer;
    videoFx: Buffer;
    runtime: Buffer;
    interaction: Buffer;
    interactionCss: string;
    webviewKernel: Buffer;
    captionFont: Buffer;
}

@injectable()
export class AkariPreviewServiceImpl implements AkariPreviewService {
    @inject(WorkspaceServer)
    protected readonly workspaceServer: WorkspaceServer;

    protected assets: OverlayRuntimeAssets | undefined;
    protected frameEngineJavaScript: string | undefined;
    // 資産の生バイト（プロセス寿命でメモ化）。getOverlayRuntimeAssets() の文字列形と
    // getOverlayRuntimeAssetUrls() の URL 配信が同じ読み出しを共有する。
    protected overlayRuntimeSources: OverlayRuntimeSources | undefined;
    protected frameEngineSource: Buffer | null | undefined;
    protected previewAudioWorkletSource: Buffer | null | undefined;
    // URL 配信: `/static/<content-hash>/<name>` → 本体。内容が変わらない限り同じ URL を返す
    // （webview 側の immutable キャッシュを setHTML をまたいで有効に保つ）。
    protected staticAssets = new Map<string, StaticAsset>();
    protected staticRoutesByName = new Map<string, string>();
    protected server: Server | undefined;
    protected serverPort: number | undefined;
    protected serverStartup: Promise<number> | undefined;
    protected readonly videoStreams = new Map<string, StreamTarget>();
    protected readonly assetStreams = new Map<string, StreamTarget>();
    protected readonly temporaryAssetDirectories = new Map<string, string>();
    protected readonly transcodedAudioStreams = new Map<string, TranscodedAudioStreamTarget>();
    protected readonly temporaryAudioFiles = new Map<string, string>();
    protected readonly reviewSessionWriter = new ReviewSessionWriter(() => this.resolveAllowedWorkspaceRoots());
    // 台帳で一度裏取りできた要求 root（realpath 済みの絶対パス）。resolveAllowedWorkspaceRoots() を参照。
    protected readonly confirmedWorkspaceRoots = new Set<string>();
    protected speechAtempoModule: Promise<SpeechAtempoModule> | undefined;

    constructor() {
        process.once('exit', () => {
            for (const [filePath, temporaryDirectory] of this.temporaryAudioFiles) {
                try {
                    unlinkSync(filePath);
                } catch {
                    // The stream completion path may already have removed the file.
                }
                try {
                    rmdirSync(temporaryDirectory);
                } catch {
                    // Best-effort synchronous cleanup during process shutdown.
                }
            }
            for (const temporaryDirectory of this.temporaryAssetDirectories.values()) {
                try {
                    rmSync(temporaryDirectory, { recursive: true, force: true });
                } catch {
                    // Best-effort synchronous cleanup during process shutdown.
                }
            }
        });
    }

    protected loadOverlayRuntimeSources(): OverlayRuntimeSources {
        if (!this.overlayRuntimeSources) {
            const directory = this.findOverlayRuntimeDirectory();
            const read = (name: string): Buffer => readFileSync(resolve(directory, name));
            const readText = (name: string): string => read(name).toString('utf8');
            this.overlayRuntimeSources = {
                three: read('vendor/three-bundle.js'),
                threeText: read('vendor/vendor-3d-text-bundle.js'),
                threeRuntime: read('three-runtime.js'),
                videoFx: read('video-fx.js'),
                // slot-params.js は preview mount と render-cut rasterize が共有する唯一の注入実装。
                // viewport-units.js は断片 CSS の vw/vh 系単位をステージ（出力サイズ）基準で解決する
                // 書き換え（overlay-runtime.js の mount が使う）。keyframes.mjs は export 行だけを
                // 除いて browser global を自己登録する。いずれも runtimeJavaScript の先頭へ
                // 同梱し、公開プロトコルの資産フィールドは増やさない。
                runtime: Buffer.from(`${readText('slot-params.js')}\n${
                    readText('viewport-units.js')
                }\n${
                    readText('keyframes.mjs')
                        .replace(/\nexport \{ interpolateKeyframes \};\s*$/u, '\n')
                }\n${
                    readText('overlay-runtime.js')
                }\n${
                    ITEM_KEYFRAMES_SOFT_RELOAD_SCRIPT
                }`, 'utf8'),
                interaction: read('interaction.js'),
                interactionCss: readText('interaction.css'),
                webviewKernel: readFileSync(this.findWebviewKernelBundle()),
                captionFont: readFileSync(this.findCaptionFontPath())
            };
        }
        return this.overlayRuntimeSources;
    }

    protected loadFrameEngineSource(): Buffer | undefined {
        if (this.frameEngineSource === undefined) {
            const bundle = this.findFrameEngineBundle();
            this.frameEngineSource = bundle ? readFileSync(bundle) : null;
        }
        return this.frameEngineSource ?? undefined;
    }

    async getOverlayRuntimeAssets(options?: { includeFrameEngine?: boolean }): Promise<OverlayRuntimeAssets> {
        if (!this.assets) {
            const sources = this.loadOverlayRuntimeSources();
            this.assets = {
                threeJavaScript: sources.three.toString('utf8'),
                threeTextJavaScript: sources.threeText.toString('utf8'),
                threeRuntimeJavaScript: sources.threeRuntime.toString('utf8'),
                videoFxJavaScript: sources.videoFx.toString('utf8'),
                runtimeJavaScript: sources.runtime.toString('utf8'),
                interactionJavaScript: sources.interaction.toString('utf8'),
                interactionCss: sources.interactionCss,
                webviewKernelJavaScript: sources.webviewKernel.toString('utf8'),
                captionFontDataUri: this.readCaptionFontDataUri()
            };
        }
        if (options?.includeFrameEngine !== true) {
            return this.assets;
        }
        const frameEngine = this.loadFrameEngineSource();
        if (!frameEngine) {
            return this.assets;
        }
        this.frameEngineJavaScript ??= frameEngine.toString('utf8');
        return { ...this.assets, frameEngineJavaScript: this.frameEngineJavaScript };
    }

    // 資産を配信サーバーの固定ルートで配る（OverlayRuntimeAssetUrls のコメント参照）。
    // ハッシュは内容の sha256 先頭 16 hex。同じ名前は同じ URL を返す（プロセス内で内容は不変）。
    async getOverlayRuntimeAssetUrls(options?: { includeFrameEngine?: boolean }): Promise<OverlayRuntimeAssetUrls> {
        const sources = this.loadOverlayRuntimeSources();
        const frameEngine = options?.includeFrameEngine === true ? this.loadFrameEngineSource() : undefined;
        const previewAudioWorklet = this.loadPreviewAudioWorkletSource();
        const port = await this.ensureServer();
        const origin = `http://127.0.0.1:${port}`;
        const javascript = 'text/javascript; charset=utf-8';
        const url = (name: string, body: Buffer, mimeType: string): string =>
            `${origin}${this.registerStaticAsset(name, body, mimeType)}`;
        return {
            origin,
            threeJavaScriptUrl: url('three-bundle.js', sources.three, javascript),
            threeTextJavaScriptUrl: url('vendor-3d-text-bundle.js', sources.threeText, javascript),
            threeRuntimeJavaScriptUrl: url('three-runtime.js', sources.threeRuntime, javascript),
            videoFxJavaScriptUrl: url('video-fx.js', sources.videoFx, javascript),
            runtimeJavaScriptUrl: url('overlay-runtime.js', sources.runtime, javascript),
            interactionJavaScriptUrl: url('interaction.js', sources.interaction, javascript),
            interactionCss: sources.interactionCss,
            webviewKernelJavaScriptUrl: url('webview-kernel.js', sources.webviewKernel, javascript),
            ...(frameEngine ? { frameEngineJavaScriptUrl: url('frame-engine.js', frameEngine, javascript) } : {}),
            ...(previewAudioWorklet ? {
                previewAudioWorkletUrl: url('preview-audio-worklet.js', previewAudioWorklet, javascript)
            } : {}),
            captionFontUrl: url('caption-font.ttf', sources.captionFont, 'font/ttf')
        };
    }

    protected registerStaticAsset(name: string, body: Buffer, mimeType: string): string {
        const known = this.staticRoutesByName.get(name);
        if (known) {
            return known;
        }
        const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
        const route = `/static/${hash}/${name}`;
        this.staticAssets.set(route, { body, mimeType });
        this.staticRoutesByName.set(name, route);
        return route;
    }

    async readVideoFxLut(request: ReadVideoFxLutRequest): Promise<string> {
        if (!request || typeof request.projectRootUri !== 'string'
            || typeof request.lutRef !== 'string' || !request.lutRef.trim()) {
            throw new Error('Invalid video FX LUT request');
        }
        let candidate: string;
        if (!request.lutRef.includes('/') && !request.lutRef.includes('\\')) {
            if (!/^[A-Za-z0-9_-]+$/.test(request.lutRef)) {
                throw new Error('Invalid LUT preset id');
            }
            candidate = resolve(this.findPresetLutDirectory(), request.lutRef, `${request.lutRef}.cube`);
        } else {
            const projectRoot = await realpath(this.filePath(request.projectRootUri));
            candidate = await realpath(resolve(projectRoot, request.lutRef));
            if (!this.contains(projectRoot, candidate)) {
                throw new Error('LUT path escapes the project root');
            }
        }
        const actual = await realpath(candidate);
        const info = await stat(actual);
        if (!info.isFile() || extname(actual).toLowerCase() !== '.cube') {
            throw new Error('LUT is not a .cube file');
        }
        return readFile(actual, 'utf8');
    }

    // win2-fonts-wire: assets/font/noto-sans-jp/NotoSansJP-Variable.ttf（win2-fonts-assets 同梱）を
    // base64 data: URI として読み込む。getOverlayRuntimeAssets() のメモ化 (this.assets) に
    // 相乗りするため、この読み込み自体は初回のみ発生する。
    protected readCaptionFontDataUri(): string {
        return `data:font/ttf;base64,${this.loadOverlayRuntimeSources().captionFont.toString('base64')}`;
    }

    protected findCaptionFontPath(): string {
        const relativePath = join('assets', 'font', 'noto-sans-jp', 'NotoSansJP-Variable.ttf');
        const candidates: string[] = [];

        // パッケージ済みアプリ: apps/shell/package.json の extraResources で assets/font/** を
        // Resources/assets/font/**（win/linux は resources/assets/font/**）へコピーする
        // （win2-fonts-wire）。process.resourcesPath は Electron が常に設定する。
        if (typeof process.resourcesPath === 'string') {
            const packagedCandidate = resolve(process.resourcesPath, relativePath);
            candidates.push(packagedCandidate);
            if (this.isFile(packagedCandidate)) {
                return packagedCandidate;
            }
        }

        // 開発時（モノレポ checkout 実行）: findOverlayRuntimeDirectory() と同じ「__dirname から
        // 祖先を辿ってリポジトリルート相対マーカーを探す」方式。
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, relativePath);
            candidates.push(candidate);
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }
        throw new Error(`caption font asset was not found (tried: ${candidates.join(', ')})`);
    }

    protected isFile(candidate: string): boolean {
        try {
            return statSync(candidate).isFile();
        } catch {
            return false;
        }
    }

    async createVideoStream(request: VideoStreamRequest): Promise<VideoStreamReference> {
        const target = await this.resolveVideoStreamTarget(request);
        const port = await this.ensureServer();
        const id = randomBytes(32).toString('hex');
        this.videoStreams.set(id, target);
        return {
            id,
            url: `http://127.0.0.1:${port}/media/${id}`
        };
    }

    async disposeVideoStream(id: string): Promise<void> {
        this.videoStreams.delete(id);
    }

    // task/2026-08-09-drop-hevc-proxy: this RPC is no longer called from the default preview-open
    // path (see AkariPreviewOpenHandler.resolveStreamVideoUri in the browser extension) — its
    // only remaining caller is handleHevcFallbackRequest, invoked after an actual <video>
    // playback failure. Alpha sources become VP9/yuva WebM; opaque HEVC keeps the H.264 fallback.
    async resolveHevcProxy(request: ResolveHevcProxyRequest): Promise<ResolveHevcProxyResult> {
        if (!request || typeof request.videoUri !== 'string' || typeof request.projectRootUri !== 'string') {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        let videoPath: string;
        let projectRoot: string;
        try {
            videoPath = this.filePath(request.videoUri);
            projectRoot = this.filePath(request.projectRootUri);
        } catch {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        const result = await getH264Proxy(projectRoot, videoPath);
        if (result.status === 'ready') {
            return { status: 'ready', proxyUri: pathToFileURL(result.proxyPath).toString() };
        }
        return result;
    }

    // task/2026-09-02-shell-frame-engine-alpha-intake: frame-engine 面のアルファ層を Web UI と同じ
    // media-bin alpha-intake へ通す。派生物（<name>.color.mp4 / <name>.mask.mp4）は入力の隣へ書くので、
    // 入力がプロジェクト内にあることを先に確かめる（ワークスペース外へは 1 バイトも書かない）。
    async prepareAlphaIntake(request: PrepareAlphaIntakeRequest): Promise<PrepareAlphaIntakeResult> {
        if (!request || typeof request.videoUri !== 'string' || typeof request.projectRootUri !== 'string') {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        let videoPath: string;
        let projectRoot: string;
        try {
            videoPath = resolve(this.filePath(request.videoUri));
            projectRoot = resolve(this.filePath(request.projectRootUri));
        } catch {
            return { status: 'unavailable', reason: 'source-missing' };
        }
        if (!this.contains(projectRoot, videoPath)) {
            return { status: 'unavailable', reason: 'outside-project' };
        }
        const outcome = await prepareAlphaIntake(videoPath);
        if (outcome.status === 'opaque') {
            return { status: 'opaque' };
        }
        if (outcome.status === 'unavailable') {
            return { status: 'unavailable', reason: outcome.reason };
        }
        return {
            status: 'alpha',
            colorUri: pathToFileURL(outcome.colorPath).toString(),
            maskUri: pathToFileURL(outcome.maskPath).toString(),
            maskFormat: outcome.maskFormat,
            skipped: outcome.skipped
        };
    }

    // task/2026-08-10-preview-bug-sweep (B1): replaces the browser-side
    // webkitAudioDecodedByteCount heuristic (confirmed stuck at 0 for real audible sources on
    // this app's Electron/Chromium build) with an ffprobe ground-truth check of the source file.
    async probeAudioPresence(request: ProbeAudioPresenceRequest): Promise<ProbeAudioPresenceResult> {
        if (!request || typeof request.videoUri !== 'string') {
            return { hasAudio: undefined };
        }
        let videoPath: string;
        try {
            videoPath = this.filePath(request.videoUri);
        } catch {
            return { hasAudio: undefined };
        }
        return { hasAudio: await probeHasAudioStream(videoPath) };
    }

    async createAssetStream(request: AssetStreamRequest): Promise<VideoStreamReference> {
        const target = await this.resolveAssetStreamTarget(request);
        const port = await this.ensureServer();
        const id = randomBytes(32).toString('hex');
        this.assetStreams.set(id, target);
        return {
            id,
            url: `http://127.0.0.1:${port}/asset/${id}${target.extension}`
        };
    }

    async rewriteFragmentAssets(request: FragmentAssetPreviewRequest): Promise<FragmentAssetPreviewResult> {
        const projectRoot = await realpath(this.filePath(request.projectRootUri));
        const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
        if (!roots.some(root => this.contains(root, projectRoot))) throw new Error('Project is outside the workspace');
        return rewritePreviewFragmentAssets(request.html, {
            projectRoot, htmlPath: request.htmlPath, overlayId: request.overlayId
        }, assetUri => this.createAssetStream({ assetUri, workspaceRoots: request.workspaceRoots }));
    }

    protected async resolveWaveformFfmpegCommand(): Promise<{ command: string; prefixArgs: string[] }> {
        return { command: await resolveFfmpegPath() ?? 'ffmpeg', prefixArgs: [] };
    }

    async buildWaveformPeaks(request: BuildWaveformPeaksRequest): Promise<BuildWaveformPeaksResult> {
        try {
            if (!request || typeof request !== 'object' || typeof request.assetUri !== 'string') {
                return { ok: false, reason: 'invalid waveform peaks request' };
            }
            const buckets = Math.min(20000, Math.max(64, Math.round(
                typeof request.buckets === 'number' && !Number.isNaN(request.buckets) ? request.buckets : 4000
            )));
            const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
            const assetPath = await realpath(this.filePath(request.assetUri));
            if (!roots.some(root => this.contains(root, assetPath))) {
                return { ok: false, reason: 'waveform source must stay inside an open workspace' };
            }
            const { command, prefixArgs } = await this.resolveWaveformFfmpegCommand();
            return await new Promise<BuildWaveformPeaksResult>(resolveResult => {
                const peaks = new Float64Array(buckets);
                let samplesPerBucket = 1024;
                let totalSamples = 0;
                let carry: number | undefined;
                let stderrTail = Buffer.alloc(0);
                let settled = false;
                const child = spawn(command, [...prefixArgs, ...waveformFfmpegArgs(assetPath)], { stdio: ['ignore', 'pipe', 'pipe'] });
                const settle = (result: BuildWaveformPeaksResult): void => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeout);
                    resolveResult(result);
                };
                const timeout = setTimeout(() => {
                    child.kill('SIGKILL');
                    settle({ ok: false, reason: 'waveform peak extraction timed out' });
                }, WAVEFORM_PEAKS_TIMEOUT_MS);
                const addSample = (sample: number): void => {
                    let bucket = Math.floor(totalSamples / samplesPerBucket);
                    if (bucket === buckets) {
                        const half = buckets >> 1;
                        for (let i = 0; i < half; i += 1) {
                            peaks[i] = Math.max(peaks[2 * i], peaks[2 * i + 1]);
                        }
                        // 奇数個なら末尾は新バケットの前半として残す。
                        if (buckets % 2 !== 0) {
                            peaks[half] = peaks[buckets - 1];
                        }
                        peaks.fill(0, Math.ceil(buckets / 2));
                        samplesPerBucket *= 2;
                        bucket = Math.floor(bucket / 2);
                    }
                    peaks[bucket] = Math.max(peaks[bucket], Math.abs(sample) / 32768);
                    totalSamples += 1;
                };
                child.stdout.on('data', (chunk: Buffer) => {
                    if (settled || chunk.length === 0) {
                        return;
                    }
                    let offset = 0;
                    if (carry !== undefined) {
                        const sample = carry | (chunk[0] << 8);
                        addSample(sample >= 32768 ? sample - 65536 : sample);
                        carry = undefined;
                        offset = 1;
                    }
                    for (; offset + 1 < chunk.length; offset += 2) {
                        addSample(chunk.readInt16LE(offset));
                    }
                    if (offset < chunk.length) {
                        carry = chunk[offset];
                    }
                });
                child.stderr.on('data', (chunk: Buffer) => {
                    stderrTail = Buffer.concat([stderrTail, chunk.subarray(-4096)]).subarray(-4096);
                });
                const streamFailed = (error: Error): void => {
                    const lastLine = stderrTail.toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
                    child.kill('SIGKILL');
                    settle({ ok: false, reason: (lastLine || error.message).slice(0, 200) });
                };
                child.stdout.once('error', streamFailed);
                child.stderr.once('error', streamFailed);
                child.once('error', () => settle({ ok: false, reason: 'ffmpeg not found' }));
                child.once('close', () => {
                    if (settled) {
                        return;
                    }
                    if (totalSamples === 0) {
                        settle({ ok: false, reason: 'no audio stream' });
                        return;
                    }
                    const resultPeaks = Array.from(peaks.subarray(0, Math.min(buckets, Math.ceil(totalSamples / samplesPerBucket))));
                    settle({ ok: true, peaks: resultPeaks, durationSec: totalSamples / 8000, buckets: resultPeaks.length });
                });
            });
        } catch (error) {
            return { ok: false, reason: error instanceof Error ? error.message : String(error) };
        }
    }

    private async validatePreviewAudioSidecarRequest(request: PrepareSpeechAtempoRequest): Promise<{
        projectRoot: string; sourcePath: string; eligible: boolean;
    }> {
        if (!request || typeof request.sourceUri !== 'string'
            || typeof request.projectRootUri !== 'string'
            || !Number.isFinite(request.inSec) || request.inSec < 0
            || (request.outSec !== undefined
                && (!Number.isFinite(request.outSec) || request.outSec <= request.inSec))
            || !Number.isFinite(request.speed) || request.speed <= 0
            || (request.padBeforeSec !== undefined
                && (!Number.isFinite(request.padBeforeSec) || request.padBeforeSec < 0))
            || (request.padAfterSec !== undefined
                && (!Number.isFinite(request.padAfterSec) || request.padAfterSec < 0))) {
            throw new Error('Invalid preview audio sidecar request');
        }
        const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
        const projectRoot = await realpath(this.filePath(request.projectRootUri));
        const sourcePath = await realpath(this.filePath(request.sourceUri));
        if (!roots.some(root => this.contains(root, projectRoot))
            || !roots.some(root => this.contains(root, sourcePath))) {
            throw new Error('Preview audio sidecar paths must stay inside an open workspace');
        }
        const sourceStat = await stat(sourcePath);
        const eligible = !(request.heavyWavOnly === true && request.clipFx === undefined
            && (extname(sourcePath).toLowerCase() !== '.wav' || sourceStat.size <= 8 * 1024 * 1024));
        return { projectRoot, sourcePath, eligible };
    }

    async preparePreviewAudioSidecar(request: PrepareSpeechAtempoRequest): Promise<PrepareSpeechAtempoResult> {
        const startedAt = Date.now();
        try {
            const { projectRoot, sourcePath, eligible } = await this.validatePreviewAudioSidecarRequest(request);
            if (!eligible) {
                return {
                    ok: false, skipped: false, eligible: false,
                    durationSec: 0, generatedMs: Date.now() - startedAt,
                    reason: 'source is not a WAV over 8 MB'
                };
            }
            const module = await this.loadSpeechAtempoModule();
            // This process also serves media bytes to the preview (HTTP Range server), so the probe
            // and the transcode below are awaited (spawn), never run through spawnSync.
            const probe = request.outSec === undefined
                ? await module.probePreviewAudioSourceAsync(sourcePath) : undefined;
            if (probe && !probe.ok) throw new Error(probe.reason ?? 'audio duration probe failed');
            const outSec = request.outSec ?? probe!.durationSec;
            const result = await module.ensurePreviewAudioSidecar({
                sourcePath,
                inSec: request.inSec,
                outSec,
                speed: request.speed,
                padBeforeSec: request.padBeforeSec ?? 0,
                padAfterSec: request.padAfterSec ?? 0,
                ...(request.clipFx !== undefined ? { clipFx: request.clipFx } : {}),
                ffmpeg: await resolveFfmpegPath(),
                cacheDir: join(projectRoot, '.akari', 'cache')
            });
            const generatedMs = Date.now() - startedAt;
            if (!result.ok || !result.path) {
                return {
                    ok: false,
                    skipped: false,
                    durationSec: 0,
                    generatedMs,
                    eligible: true,
                    reason: `${request.clipFx !== undefined
                        ? 'preview approximation will differ from export: ' : ''}${
                        result.reason ?? 'preview audio sidecar generation failed'}`
                };
            }
            const stream = await this.createAssetStream({
                assetUri: pathToFileURL(result.path).toString(),
                workspaceRoots: request.workspaceRoots
            });
            return {
                ok: true,
                skipped: result.skipped,
                eligible: true,
                key: result.key ?? undefined,
                bytes: (await stat(result.path)).size,
                sampleRate: result.sampleRate,
                channels: result.channels,
                durationSec: result.durationSec,
                generatedMs,
                stream
            };
        } catch (error) {
            return {
                ok: false,
                skipped: false,
                durationSec: 0,
                generatedMs: Date.now() - startedAt,
                reason: `${request?.clipFx !== undefined
                    ? 'preview approximation will differ from export: ' : ''}${
                    error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    async prepareSpeechAtempo(request: PrepareSpeechAtempoRequest): Promise<PrepareSpeechAtempoResult> {
        return this.preparePreviewAudioSidecar({ ...request, padBeforeSec: 0, padAfterSec: 0 });
    }

    async requestPreviewAudioSidecar(request: PrepareSpeechAtempoRequest): Promise<PreviewAudioSidecarRequestResult> {
        try {
            const { projectRoot, sourcePath, eligible } = await this.validatePreviewAudioSidecarRequest(request);
            if (!eligible) return { state: 'not-eligible' };
            const ffmpeg = await resolveFfmpegPath();
            if (!ffmpeg) return { state: 'unavailable', reason: 'ffmpeg-missing' };
            const module = await this.loadSpeechAtempoModule();
            const result = module.requestPreviewAudioSidecar({
                sourcePath,
                inSec: request.inSec,
                ...(request.outSec !== undefined ? { outSec: request.outSec } : {}),
                ...(request.format !== undefined ? { format: request.format } : {}),
                ...(request.decodedBytesThreshold !== undefined ? { decodedBytesThreshold: request.decodedBytesThreshold } : {}),
                speed: request.speed,
                padBeforeSec: request.padBeforeSec ?? 0,
                padAfterSec: request.padAfterSec ?? 0,
                ...(request.clipFx !== undefined ? { clipFx: request.clipFx } : {}),
                ffmpeg,
                cacheDir: join(projectRoot, '.akari', 'cache')
            });
            const { path: sidecarPath, key, probe, state, ...metadata } = result;
            if (state === 'not-needed') return { state: 'not-needed' };
            const mapped: PreviewAudioSidecarRequestResult = {
                ...metadata,
                state: state === 'ready' || state === 'queued' || state === 'generating'
                    || state === 'no-audio' || state === 'failed' ? state : 'unavailable',
                ...(key ? { key } : {}),
                ...(probe?.fingerprint ? { probe: { fingerprint: probe.fingerprint } } : {})
            };
            if (state === 'ready') {
                if (!sidecarPath) throw new Error('ready preview audio sidecar has no path');
                mapped.bytes ??= (await stat(sidecarPath)).size;
                mapped.stream = await this.createAssetStream({
                    assetUri: pathToFileURL(sidecarPath).toString(),
                    workspaceRoots: request.workspaceRoots
                });
            }
            return mapped;
        } catch (error) {
            return {
                state: 'unavailable',
                reason: `${request?.clipFx !== undefined
                    ? 'preview approximation will differ from export: ' : ''}${
                    error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    async sweepPreviewAudioSidecars(request: {
        projectRootUri: string;
        keepKeys: string[];
        keepProbes?: string[];
        minAgeMs?: number;
        workspaceRoots?: string[];
    }): Promise<{ removed: number; bytes: number }> {
        if (!request || typeof request.projectRootUri !== 'string' || !Array.isArray(request.keepKeys)) {
            throw new Error('Invalid preview audio sweep request');
        }
        const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
        const projectRoot = await realpath(this.filePath(request.projectRootUri));
        if (!roots.some(root => this.contains(root, projectRoot))) {
            throw new Error('Preview audio cache must stay inside an open workspace');
        }
        const module = await this.loadSpeechAtempoModule();
        return module.sweepPreviewAudioSidecars({
            cacheDir: join(projectRoot, '.akari', 'cache'),
            keepKeys: request.keepKeys,
            ...(request.keepProbes !== undefined ? { keepProbes: request.keepProbes } : {}),
            ...(request.minAgeMs !== undefined ? { minAgeMs: request.minAgeMs } : {})
        });
    }

    async promotePreviewAudioSidecars(request: PromotePreviewAudioSidecarsRequest): Promise<PromotePreviewAudioSidecarsResult> {
        if (!request || typeof request.projectRootUri !== 'string') {
            throw new Error('Invalid preview audio priority request');
        }
        const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
        const projectRoot = await realpath(this.filePath(request.projectRootUri));
        if (!roots.some(root => this.contains(root, projectRoot))) {
            throw new Error('Preview audio cache must stay inside an open workspace');
        }
        const sourcePaths: string[] = [];
        for (const value of Array.isArray(request.sourcePaths) ? request.sourcePaths : []) {
            if (typeof value !== 'string' || !isAbsolute(value)) continue;
            try {
                const sourcePath = await realpath(value);
                if (roots.some(root => this.contains(root, sourcePath))) sourcePaths.push(sourcePath);
            } catch { /* Missing or inaccessible sources cannot refer to a pending probe. */ }
        }
        const module = await this.loadSpeechAtempoModule();
        return module.promotePreviewAudioSidecars({
            cacheDir: join(projectRoot, '.akari', 'cache'),
            keys: Array.isArray(request.keys) ? request.keys.filter(key => typeof key === 'string') : [],
            sourcePaths
        });
    }

    protected loadSpeechAtempoModule(): Promise<SpeechAtempoModule> {
        if (this.speechAtempoModule) return this.speechAtempoModule;
        this.speechAtempoModule = (async () => {
            const candidates: string[] = [];
            if (typeof process.resourcesPath === 'string') {
                candidates.push(resolve(process.resourcesPath,
                    'packages', 'media-bin', 'src', 'preview-audio-sidecar.mjs'));
            }
            let ancestor = resolve(__dirname);
            for (let depth = 0; depth < 10; depth += 1) {
                candidates.push(resolve(ancestor, 'packages', 'media-bin', 'src', 'preview-audio-sidecar.mjs'));
                const parent = dirname(ancestor);
                if (parent === ancestor) break;
                ancestor = parent;
            }
            const candidate = candidates.find(value => this.isFile(value));
            if (!candidate) throw new Error('preview audio sidecar helper could not be found');
            const importModule = Function('specifier', 'return import(specifier)') as
                (specifier: string) => Promise<SpeechAtempoModule>;
            return importModule(pathToFileURL(candidate).toString());
        })();
        return this.speechAtempoModule;
    }

    async disposeAssetStream(id: string): Promise<void> {
        this.assetStreams.delete(id);
        const temporaryDirectory = this.temporaryAssetDirectories.get(id);
        if (temporaryDirectory) {
            this.temporaryAssetDirectories.delete(id);
            await rm(temporaryDirectory, { recursive: true, force: true });
        }
    }

    async rasterizeTelopPreview(_request: RasterizeTelopPreviewRequest): Promise<VideoStreamReference> {
        // Keep the RPC boundary explicit for older clients; no rendering process is started.
        throw new Error('telop.retired: テロップ（ATF）の描画は退役しました。Lab の HTML 素材版へ差し替えてください。');
    }

    async transcodeAudioToWav(request: TranscodeAudioRequest): Promise<TranscodeAudioResult> {
        let outputPath: string | undefined;
        let temporaryDirectory: string | undefined;
        try {
            if (!request || typeof request.audioUri !== 'string') {
                return { ok: false, error: 'transcode-failed' };
            }
            const input = await this.resolveLocalStreamTarget(
                request.audioUri,
                TRANSCODABLE_AUDIO_MIME_TYPES,
                'Asset',
                request.workspaceRoots
            );
            const inputStat = await stat(input.path);
            if (inputStat.size > MAX_TRANSCODE_INPUT_BYTES) {
                return { ok: false, error: 'input-too-large' };
            }

            temporaryDirectory = await mkdtemp(join(tmpdir(), 'akari-audio-'));
            outputPath = join(temporaryDirectory, `${randomBytes(16).toString('hex')}.wav`);
            this.temporaryAudioFiles.set(outputPath, temporaryDirectory);
            const transcodeError = await this.runAudioTranscode(input.path, outputPath);
            if (transcodeError) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: transcodeError };
            }

            const outputStat = await stat(outputPath);
            if (!outputStat.isFile()) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: 'transcode-failed' };
            }
            if (outputStat.size > MAX_TRANSCODE_OUTPUT_BYTES) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
                return { ok: false, error: 'output-too-large' };
            }

            const port = await this.ensureServer();
            const id = randomBytes(32).toString('hex');
            this.transcodedAudioStreams.set(id, {
                path: outputPath,
                mimeType: 'audio/wav',
                workspaceRoots: [await realpath(temporaryDirectory)],
                temporaryDirectory
            });
            return {
                ok: true,
                stream: {
                    id,
                    url: `http://127.0.0.1:${port}/transcoded-audio/${id}`
                }
            };
        } catch (error) {
            if (outputPath && temporaryDirectory) {
                await this.cleanupTemporaryAudio(outputPath, temporaryDirectory);
            }
            console.warn('[akari-preview] audio conversion failed', error);
            return { ok: false, error: 'transcode-failed' };
        }
    }

    async disposeTranscodedAudioStream(id: string): Promise<void> {
        const target = this.transcodedAudioStreams.get(id);
        if (target) {
            await this.cleanupTranscodedAudioStreamById(id, target);
        }
    }

    async startReviewSession(request: StartReviewSessionRequest): Promise<StartReviewSessionResult> {
        return this.reviewSessionWriter.start(request);
    }

    async appendReviewSessionEvent(request: AppendReviewSessionEventRequest): Promise<void> {
        await this.reviewSessionWriter.appendEvent(request);
    }

    async appendReviewSessionAudio(request: AppendReviewSessionAudioRequest): Promise<void> {
        await this.reviewSessionWriter.appendAudio(request);
    }

    async appendReviewSessionStroke(request: AppendReviewSessionStrokeRequest): Promise<void> {
        await this.reviewSessionWriter.appendStroke(request);
    }

    async readReviewSessionStrokes(request: ReadReviewSessionStrokesRequest): Promise<ReadReviewSessionStrokesResult> {
        return this.reviewSessionWriter.readStrokes(request);
    }

    async endReviewSession(request: EndReviewSessionRequest): Promise<void> {
        await this.reviewSessionWriter.end(request);
    }

    async listReviewSessions(request: ListReviewSessionsRequest): Promise<ReviewSessionSummary[]> {
        return this.reviewSessionWriter.list(request);
    }

    // CF-write: layerWrite/audioWrite/captionWrite の書き込み前ゲート。実装は
    // packages/edit-store の共有カーネル（lintProjectCandidates — 一時ディレクトリに兄弟を
    // symlink で写し、候補だけを置いて edit-lint --json・bin 不在は fail-open）へ委譲する。
    // request.editUri は対象ファイルの URI（edit.json のほか captions.json 候補も検証できる —
    // URI の basename が候補ファイル名になる）。
    async lintEditCandidate(request: LintEditCandidateRequest): Promise<LintEditCandidateResult> {
        const targetPath = this.filePath(request.editUri);
        const result = await lintProjectCandidates(
            dirname(targetPath), { [basename(targetPath)]: request.candidateText }
        );
        return { pass: result.pass, errors: result.errors };
    }

    async prepareLegacyEdit(request: PrepareLegacyEditRequest): Promise<PrepareLegacyEditResult> {
        const roots = await this.resolveWorkspaceRoots();
        const text = await this.readWorkspaceRegularFile(request.editUri, roots, 'edit.json');
        const editPath = this.filePath(request.editUri);
        const planned = planMigration(dirname(editPath), editPath, text);
        if ('blockers' in planned) return planned;
        return {
            ok: true,
            version: planned.version,
            nextText: planned.nextText,
            changes: planned.changes
        };
    }

    async resolveCaptionDisplay(request: ResolveCaptionDisplayRequest): Promise<ResolvedCaptionDisplayPayload | null> {
        if (!request || typeof request.captionsUri !== 'string' || typeof request.editUri !== 'string') {
            throw new Error('Invalid caption display request');
        }
        const roots = await this.resolveWorkspaceRoots(request.workspaceRoots);
        // Bind each parse to the regular file actually opened. A prior realpath followed by
        // readFile(path) is a TOCTOU boundary: an attacker can retarget the path between those
        // calls. readWorkspaceRegularFile opens with O_NOFOLLOW where available, reads from the
        // descriptor, and verifies file/parent identity and workspace containment before and
        // after the read. Any rename or symlink race therefore fails closed.
        const captionsRoot = JSON.parse(await this.readWorkspaceRegularFile(
            request.captionsUri, roots, 'captions.json'
        ));
        if (Array.isArray(captionsRoot) || !captionsRoot || typeof captionsRoot !== 'object'
            || captionsRoot.display_policy === undefined) {
            return null;
        }
        const captionsEmphasisWords = readCaptionsEmphasisWords(captionsRoot);
        const editText = await this.readWorkspaceRegularFile(request.editUri, roots, 'edit.json');
        let rawEdit = JSON.parse(editText);
        const legacyEmphasisWords = readLegacyEditEmphasisWords(rawEdit);
        if (rawEdit?.version !== 2) {
            const planned = planMigration(dirname(this.filePath(request.editUri)), this.filePath(request.editUri), editText);
            if ('blockers' in planned) {
                throw new Error(`古い edit.json を読み取り専用で開けません: ${planned.blockers.join(' / ')}`);
            }
            rawEdit = JSON.parse(planned.nextText);
        }
        const internal = readInternalEdit(rawEdit, { captions: toAnchorCaptions(captionsRoot) });
        const legacy = projectLegacyEdit(internal);
        const edit = {
            output: internal.output,
            cuts: this.captionCompatibleCuts(internal, legacy.cuts),
            ...(internal.sourceTableDeclared ? {
                sources: internal.sources.map(source => ({ id: source.id, path: source.path }))
            } : {}),
            ...(internal.declaration.emphasisWords !== undefined
                ? { emphasis_words: internal.declaration.emphasisWords } : {})
        };
        // 出力サイズは旧経路と同じく生 edit.json の宣言をそのまま渡す。InternalOutput の
        // optional width/height を既定値で埋めると、未宣言時の字幕レイアウト挙動が変わる。
        const projectRoot = dirname(this.filePath(request.editUri));
        // 単語帳が配布物に無い場合も補助語なし（[]）へ縮退し、字幕表示そのものは止めない。
        let extraProtectedTerms: string[] = [];
        try {
            let cursor = __dirname;
            let wordBookPath: string | undefined;
            let reachedRoot = false;
            while (!reachedRoot) {
                const candidate = join(cursor, 'packages', 'word-book', 'src', 'index.mjs');
                try {
                    if (statSync(candidate).isFile()) {
                        wordBookPath = candidate;
                        break;
                    }
                } catch { /* 探索を続ける */ }
                const parent = dirname(cursor);
                reachedRoot = parent === cursor;
                cursor = parent;
            }
            if (wordBookPath) {
                const importWordBook = new Function('specifier', 'return import(specifier)') as
                    (specifier: string) => Promise<{
                        resolveWordBookSync(options: { projectRoot: string }): { entries: unknown[] };
                        protectedTermsFrom(entries: unknown[]): string[];
                    }>;
                const wordBookModule = await importWordBook(pathToFileURL(wordBookPath).href);
                const wordBook = wordBookModule.resolveWordBookSync({ projectRoot });
                extraProtectedTerms = wordBookModule.protectedTermsFrom(wordBook.entries);
            }
        } catch {
            // 単語帳は字幕表示の補助情報なので、解決・import 失敗時も従来の字幕表示を維持する。
            extraProtectedTerms = [];
        }
        const resolved = resolveCaptionDisplay(captionsRoot, edit, {
            output: rawEdit.output,
            extra_protected_terms: extraProtectedTerms
        });
        if (!resolved) return null;
        const emphasisWords = resolvePreviewEmphasisWords(captionsEmphasisWords, legacyEmphasisWords);
        return { schema: resolved.schema, captions: resolved.display_cues, emphasisWords };
    }

    /**
     * display_policy の既存 resolver は線形 cuts[] を入力契約にしている。v2 は線形でも
     * at/track を常に持つため、内部フレーム列が 0 から隙間なく連続する場合に限って
     * その 2 フィールドを省く。ギャップ・重なりは残し、resolver の既存拒否を維持する。
     */
    protected captionCompatibleCuts(
        internal: ReturnType<typeof readInternalEdit>,
        cuts: ReturnType<typeof projectLegacyEdit>['cuts']
    ): ReturnType<typeof projectLegacyEdit>['cuts'] {
        const items = internal.tracks
            .flatMap(track => track.items)
            .filter(item => item.legacy.collection === 'cuts')
            .sort((left, right) => left.legacy.index - right.legacy.index);
        let cursor = 0;
        const linear = items.length === cuts.length && items.every(item => {
            const contiguous = item.atFrames === cursor;
            cursor = item.atFrames + item.durationFrames;
            return contiguous;
        });
        if (!linear) return cuts;
        return cuts.map(cut => Object.fromEntries(
            Object.entries(cut).filter(([key]) => key !== 'at' && key !== 'track')
        ) as typeof cut);
    }

    protected async readWorkspaceRegularFile(uri: string, roots: string[], label: string): Promise<string> {
        const uriPath = resolve(this.filePath(uri));
        // Resolve the parent once and then bind all operations to that canonical directory.
        // This both normalizes platform aliases such as macOS /var -> /private/var and prevents
        // a later retarget of an URI-level directory symlink from changing the opened namespace.
        const requestedPath = join(await realpath(dirname(uriPath)), basename(uriPath));
        const containingRoot = roots.find(root => this.contains(root, requestedPath));
        if (!containingRoot) {
            throw new Error(`Caption display ${label} must be inside the workspace`);
        }

        await this.assertSafePathBinding(containingRoot, requestedPath, undefined, label);
        let handle: FileHandle | undefined;
        try {
            const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
            handle = await open(requestedPath, fsConstants.O_RDONLY | noFollow);
            const initial = await handle.stat({ bigint: true });
            if (!initial.isFile()) {
                throw new Error(`Caption display ${label} must be a regular file`);
            }
            await this.assertSafePathBinding(containingRoot, requestedPath, initial, label);
            const content = await handle.readFile({ encoding: 'utf8' });
            const final = await handle.stat({ bigint: true });
            if (!this.sameFileVersion(initial, final)) {
                throw new Error(`Caption display ${label} changed while it was being read`);
            }
            await this.assertSafePathBinding(containingRoot, requestedPath, final, label);
            return content;
        } catch (error) {
            const detail = error instanceof Error ? `: ${error.message}` : '';
            throw new Error(`Caption display ${label} could not be read safely${detail}`);
        } finally {
            await handle?.close();
        }
    }

    protected async assertSafePathBinding(
        workspaceRoot: string,
        requestedPath: string,
        openedStat: Awaited<ReturnType<FileHandle['stat']>> | undefined,
        label: string
    ): Promise<void> {
        const pathStat = await lstat(requestedPath, { bigint: true });
        if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
            throw new Error(`Caption display ${label} symlinks and non-regular files are forbidden`);
        }
        if (openedStat && !this.sameFileIdentity(pathStat, openedStat)) {
            throw new Error(`Caption display ${label} path no longer identifies the opened file`);
        }
        const resolvedPath = await realpath(requestedPath);
        if (!this.contains(workspaceRoot, resolvedPath)) {
            throw new Error(`Caption display ${label} resolved outside the workspace`);
        }

        let parent = dirname(requestedPath);
        for (;;) {
            const parentStat = await lstat(parent, { bigint: true });
            if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
                throw new Error(`Caption display ${label} has an unsafe parent directory`);
            }
            const resolvedParent = await realpath(parent);
            if (!this.contains(workspaceRoot, resolvedParent)) {
                throw new Error(`Caption display ${label} parent resolved outside the workspace`);
            }
            if (parent === workspaceRoot) break;
            const next = dirname(parent);
            if (next === parent || !this.contains(workspaceRoot, next)) {
                throw new Error(`Caption display ${label} parent escaped the workspace`);
            }
            parent = next;
        }
    }

    protected sameFileIdentity(
        left: { dev: bigint | number; ino: bigint | number; mode: bigint | number },
        right: { dev: bigint | number; ino: bigint | number; mode: bigint | number }
    ): boolean {
        return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
    }

    protected sameFileVersion(
        left: { dev: bigint | number; ino: bigint | number; mode: bigint | number; size: bigint | number; mtimeNs?: bigint },
        right: { dev: bigint | number; ino: bigint | number; mode: bigint | number; size: bigint | number; mtimeNs?: bigint }
    ): boolean {
        return this.sameFileIdentity(left, right)
            && left.size === right.size
            && left.mtimeNs === right.mtimeNs;
    }

    protected async runAudioTranscode(inputPath: string, outputPath: string): Promise<TranscodeAudioErrorKind | undefined> {
        // task/2026-07-31-shell-ffmpeg-bundle: PATH に無ければ hevc-proxy.ts と同じ優先順位
        // （明示指定env → PATH → アプリ同梱バイナリ）でアプリ同梱の ffmpeg を使う。
        const ffmpegPath = await resolveFfmpegPath() ?? 'ffmpeg';
        return new Promise(resolveResult => {
            let settled = false;
            const child = spawn(ffmpegPath, [
                '-hide_banner',
                '-loglevel', 'error',
                '-nostdin',
                '-y',
                '-i', inputPath,
                '-vn',
                '-acodec', 'pcm_s16le',
                '-f', 'wav',
                outputPath
            ], { stdio: 'ignore' });
            const finish = (result: TranscodeAudioErrorKind | undefined): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                resolveResult(result);
            };
            const timeout = setTimeout(() => {
                child.kill('SIGKILL');
                finish('timeout');
            }, TRANSCODE_TIMEOUT_MS);
            child.once('error', () => finish('ffmpeg-not-found'));
            child.once('close', code => finish(code === 0 ? undefined : 'transcode-failed'));
        });
    }

    protected async cleanupTemporaryAudio(filePath: string, temporaryDirectory: string): Promise<void> {
        let fileRemoved = false;
        try {
            await unlink(filePath);
            fileRemoved = true;
        } catch (error) {
            fileRemoved = (error as { code?: string }).code === 'ENOENT';
        }
        if (!fileRemoved) {
            return;
        }
        this.temporaryAudioFiles.delete(filePath);
        try {
            await rmdir(temporaryDirectory);
        } catch {
            // The directory may already have been removed by another cleanup path.
        }
    }

    protected async cleanupTranscodedAudioStreamById(id: string, target: TranscodedAudioStreamTarget): Promise<void> {
        if (this.transcodedAudioStreams.get(id) !== target) {
            return;
        }
        this.transcodedAudioStreams.delete(id);
        await this.cleanupTemporaryAudio(target.path, target.temporaryDirectory);
    }

    protected async resolveVideoStreamTarget(request: VideoStreamRequest): Promise<StreamTarget> {
        if (!request || typeof request.videoUri !== 'string') {
            throw new Error('Invalid video stream request');
        }
        return this.resolveLocalStreamTarget(request.videoUri, VIDEO_MIME_TYPES, 'Video', request.workspaceRoots);
    }

    protected async resolveAssetStreamTarget(request: AssetStreamRequest): Promise<StreamTarget> {
        if (!request || typeof request.assetUri !== 'string') {
            throw new Error('Invalid asset stream request');
        }
        return this.resolveLocalStreamTarget(request.assetUri, ASSET_MIME_TYPES, 'Asset', request.workspaceRoots);
    }

    protected async resolveLocalStreamTarget(
        uri: string,
        mimeTypes: Map<string, string>,
        kind: 'Video' | 'Asset',
        requestRoots?: string[]
    ): Promise<StreamTarget> {
        const extension = extname(this.filePath(uri)).toLowerCase();
        const mimeType = mimeTypes.get(extension);
        if (!mimeType) {
            throw new Error(`Unsupported ${kind.toLowerCase()} format`);
        }
        const targetPath = await realpath(this.filePath(uri));
        const roots = await this.resolveWorkspaceRoots(requestRoots);
        if (!roots.some(root => this.contains(root, targetPath))) {
            throw new Error(`${kind} files outside the workspace cannot be streamed`);
        }
        const targetStat = await stat(targetPath);
        if (!targetStat.isFile()) {
            throw new Error('The stream target is not a file');
        }
        return { path: targetPath, mimeType, extension, workspaceRoots: roots };
    }

    protected async resolveWorkspaceRoots(requestRoots?: string[]): Promise<string[]> {
        if (requestRoots !== undefined && !Array.isArray(requestRoots)) {
            throw new Error('Invalid workspace roots request');
        }
        if (requestRoots?.length) {
            const requestedRoots = await Promise.all(requestRoots.map(async uri => {
                const root = await realpath(this.filePath(uri));
                if (!(await stat(root)).isDirectory()) {
                    throw new Error('The requested workspace root must be a directory');
                }
                return root;
            }));
            const allowedRoots = await this.resolveAllowedWorkspaceRoots();
            if (!requestedRoots.every(requested => allowedRoots.some(allowed => this.contains(allowed, requested)))) {
                throw new Error('The requested workspace root is not an open workspace');
            }
            for (const requested of requestedRoots) {
                this.confirmedWorkspaceRoots.add(requested);
            }
            return requestedRoots;
        }
        const workspaceUri = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        if (!workspaceUri) {
            throw new Error('A workspace must be open to stream video');
        }
        return this.expandWorkspaceUri(workspaceUri, false);
    }

    protected async resolveAllowedWorkspaceRoots(): Promise<string[]> {
        const recentWorkspaces = await this.workspaceServer.getRecentWorkspaces();
        const mostRecentlyUsed = await this.workspaceServer.getMostRecentlyUsedWorkspace();
        const workspaceUris = [...new Set([...recentWorkspaces, mostRecentlyUsed])];
        // 台帳で一度「開いているワークスペース」と確認できた root は、このバックエンドの
        // 寿命の間ずっと許可側に残す。台帳は永続ファイルなので、別ウィンドウの書き込みや
        // 破損で開いているプロジェクトの行が落ちうる（akari-workspace-server.ts の頭）。
        // 落ちた瞬間に配信を取り上げると「起動直後は見られたのに途中から拒否される」になる。
        // 中身は必ず一度は台帳で裏取りした root だけで、要求値がそのまま入ることはない。
        const roots: string[] = [...this.confirmedWorkspaceRoots];
        for (const workspaceUri of workspaceUris) {
            if (!workspaceUri) {
                continue;
            }
            roots.push(...await this.expandWorkspaceUri(workspaceUri, true));
        }
        return [...new Set(roots)];
    }

    protected async expandWorkspaceUri(workspaceUri: string, discardMissing: false): Promise<string[]>;
    protected async expandWorkspaceUri(workspaceUri: string, discardMissing: true): Promise<string[]>;
    protected async expandWorkspaceUri(workspaceUri: string, discardMissing: boolean): Promise<string[]> {
        let workspacePath: string;
        try {
            workspacePath = await realpath(this.filePath(workspaceUri));
        } catch (error) {
            if (discardMissing && this.isMissingFileError(error)) {
                return [];
            }
            throw error;
        }
        const workspaceStat = await stat(workspacePath);
        if (workspaceStat.isDirectory()) {
            return [workspacePath];
        }
        if (!workspaceStat.isFile()) {
            throw new Error('The current workspace is invalid');
        }
        const data = parseJson(await readFile(workspacePath, 'utf8'));
        if (!data || !Array.isArray(data.folders)) {
            throw new Error('The current workspace file is invalid');
        }
        const roots = await Promise.all(data.folders.map(async (folder: unknown) => {
            if (!folder || typeof folder !== 'object' || typeof (folder as { path?: unknown }).path !== 'string') {
                throw new Error('The current workspace file contains an invalid folder');
            }
            const folderPath = (folder as { path: string }).path;
            const absolutePath = folderPath.startsWith('file:')
                ? this.filePath(folderPath)
                : fileURLToPath(new URL(folderPath, pathToFileURL(`${dirname(workspacePath)}${sep}`)));
            try {
                return await realpath(absolutePath);
            } catch (error) {
                if (discardMissing && this.isMissingFileError(error)) {
                    return undefined;
                }
                throw error;
            }
        }));
        return roots.filter((root): root is string => root !== undefined);
    }

    protected isMissingFileError(error: unknown): boolean {
        return (error as { code?: string }).code === 'ENOENT';
    }

    protected filePath(uri: string): string {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'file:') {
            throw new Error('Only local file URIs can be streamed');
        }
        return fileURLToPath(parsed);
    }

    protected contains(root: string, target: string): boolean {
        const path = relative(root, target);
        return path === '' || (!path.startsWith('..') && !isAbsolute(path));
    }

    protected ensureServer(): Promise<number> {
        if (this.server && this.serverPort !== undefined) {
            return Promise.resolve(this.serverPort);
        }
        if (this.serverStartup) {
            return this.serverStartup;
        }
        this.serverStartup = new Promise((resolvePort, reject) => {
            const server = createServer((request, response) => void this.handleRequest(request, response));
            const fail = (error: Error): void => {
                this.serverStartup = undefined;
                server.close();
                reject(error);
            };
            server.once('error', fail);
            server.listen(0, '127.0.0.1', () => {
                server.off('error', fail);
                const address = server.address();
                if (!address || typeof address === 'string') {
                    this.serverStartup = undefined;
                    server.close();
                    reject(new Error('Failed to bind the preview streaming server'));
                    return;
                }
                this.server = server;
                this.serverPort = address.port;
                server.on('error', error => console.error('[akari-preview] streaming server error', error));
                resolvePort(address.port);
            });
        });
        return this.serverStartup;
    }

    protected async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
        const staticAsset = this.staticAssets.get(request.url ?? '');
        if (staticAsset) {
            this.serveStaticAsset(request, response, staticAsset);
            return;
        }
        const mediaMatch = /^\/media\/([a-f0-9]{64})$/.exec(request.url ?? '');
        const assetMatch = /^\/asset\/([a-f0-9]{64})(\.[a-z0-9]+)?$/.exec(request.url ?? '');
        const transcodedAudioMatch = /^\/transcoded-audio\/([a-f0-9]{64})$/.exec(request.url ?? '');
        const target = mediaMatch
            ? this.videoStreams.get(mediaMatch[1])
            : assetMatch
                ? this.assetStreams.get(assetMatch[1])
                : transcodedAudioMatch
                    ? this.transcodedAudioStreams.get(transcodedAudioMatch[1])
                    : undefined;
        if (!target) {
            this.respond(response, 404);
            return;
        }
        if (assetMatch?.[2] && assetMatch[2] !== this.assetStreams.get(assetMatch[1])?.extension) {
            this.respond(response, 404);
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            this.respond(response, 405);
            return;
        }
        try {
            const currentPath = await realpath(target.path);
            if (!target.workspaceRoots.some(root => this.contains(root, currentPath))) {
                this.respond(response, 404);
                return;
            }
            const targetStat = await stat(currentPath);
            if (!targetStat.isFile()) {
                this.respond(response, 404);
                return;
            }
            const range = this.parseRange(request.headers.range, targetStat.size);
            if (request.headers.range && !range) {
                response.setHeader('Content-Range', `bytes */${targetStat.size}`);
                this.respond(response, 416);
                return;
            }
            const start = range?.start ?? 0;
            const end = range?.end ?? Math.max(0, targetStat.size - 1);
            response.statusCode = range ? 206 : 200;
            response.setHeader('Access-Control-Allow-Origin', '*');
            // webview（<id>.webview.localhost）から 127.0.0.1 の配信サーバへは cross-origin。
            // Content-Range / Accept-Ranges は CORS の safelist 外なので、明示的に expose しないと
            // frame-engine の fetch から見えず「Range 非対応」と判定されて原本を丸ごと読みに行く
            // （実機 2026-09-05: 4K HEVC 9.7GB で 'this host does not support byte ranges' →
            //  Range header exceeded 10000ms → カットが 1 枚も出ず、再生も音も始まらない）。
            response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('Content-Type', target.mimeType);
            response.setHeader('Content-Length', targetStat.size === 0 ? 0 : end - start + 1);
            if (range) {
                response.setHeader('Content-Range', `bytes ${start}-${end}/${targetStat.size}`);
            }
            if (request.method === 'HEAD' || targetStat.size === 0) {
                response.end();
                return;
            }
            const stream = createReadStream(currentPath, { start, end });
            stream.on('error', error => response.destroy(error));
            stream.pipe(response);
        } catch {
            this.respond(response, 404);
        }
    }

    // 内容ハッシュ付きの固定ルートなので immutable。フォントは別オリジン（webview）から
    // 読まれるため CORS を開ける（@font-face は CORS 必須。script は不要だが害も無い）。
    protected serveStaticAsset(request: IncomingMessage, response: ServerResponse, asset: StaticAsset): void {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            this.respond(response, 405);
            return;
        }
        response.statusCode = 200;
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        response.setHeader('Content-Type', asset.mimeType);
        response.setHeader('Content-Length', asset.body.byteLength);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (request.method === 'HEAD') {
            response.end();
            return;
        }
        response.end(asset.body);
    }

    protected parseRange(value: string | undefined, size: number): ByteRange | undefined {
        if (!value) {
            return undefined;
        }
        const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
        if (!match || size <= 0 || (!match[1] && !match[2])) {
            return undefined;
        }
        if (!match[1]) {
            const suffixLength = Number(match[2]);
            if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
                return undefined;
            }
            return { start: Math.max(0, size - suffixLength), end: size - 1 };
        }
        const start = Number(match[1]);
        const requestedEnd = match[2] ? Number(match[2]) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
            return undefined;
        }
        return { start, end: Math.min(requestedEnd, size - 1) };
    }

    protected respond(response: ServerResponse, statusCode: number): void {
        response.statusCode = statusCode;
        response.setHeader('Cache-Control', 'no-store');
        response.end();
    }

    protected findOverlayRuntimeDirectory(): string {
        const candidates: string[] = [];

        // Packaged app location: prepackage copies the assets to lib/overlay-runtime,
        // and the bundled backend's __dirname resolves to lib/backend at runtime.
        const packagedCandidate = resolve(__dirname, '../overlay-runtime');
        candidates.push(packagedCandidate);
        if (this.isOverlayRuntimeDirectory(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, 'packages/overlay-runtime/src');
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }

        // Keep cwd-based locations only as a last-resort development fallback.
        const cwdCandidates = [
            resolve(process.cwd(), '../../packages/overlay-runtime/src'),
            resolve(process.cwd(), 'packages/overlay-runtime/src'),
            resolve(process.cwd(), '../packages/overlay-runtime/src')
        ];
        for (const candidate of cwdCandidates) {
            if (candidates.includes(candidate)) {
                continue;
            }
            candidates.push(candidate);
            if (this.isOverlayRuntimeDirectory(candidate)) {
                return candidate;
            }
        }
        throw new Error(`overlay-runtime assets were not found (tried: ${candidates.join(', ')})`);
    }

    protected findPresetLutDirectory(): string {
        const candidates: string[] = [];
        if (typeof process.resourcesPath === 'string') {
            candidates.push(resolve(process.resourcesPath, 'presets/luts'));
        }
        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth += 1) {
            candidates.push(resolve(ancestor, 'presets/luts'));
            const parent = dirname(ancestor);
            if (parent === ancestor) break;
            ancestor = parent;
        }
        candidates.push(
            resolve(process.cwd(), 'presets/luts'),
            resolve(process.cwd(), '../../presets/luts')
        );
        for (const candidate of candidates) {
            try {
                if (statSync(candidate).isDirectory()) return candidate;
            } catch {
                // Try the next packaged/development location.
            }
        }
        throw new Error(`LUT presets were not found (tried: ${candidates.join(', ')})`);
    }

    // 共有カーネルの webview 用 IIFE バンドル（generated — 正本は packages/edit-store/src/
    // webview-kernel.ts、`npm run build` が lib/webview-kernel.js を再生成する）。
    // overlay-runtime と違い生成物のため src/ には置けず、edit-store の lib/ から読む。
    // パッケージ済みアプリでは copy-native-helpers.mjs が lib/overlay-runtime/ へ同梱する。
    protected findWebviewKernelBundle(): string {
        const fileName = 'webview-kernel.js';
        const candidates: string[] = [];

        const packagedCandidate = resolve(__dirname, '../overlay-runtime', fileName);
        candidates.push(packagedCandidate);
        if (this.isFile(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(ancestor, 'packages/edit-store/lib', fileName);
            candidates.push(candidate);
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }
        throw new Error(`webview-kernel bundle was not found (tried: ${candidates.join(', ')})`);
    }

    // frame-engine の webview 用 IIFE。配布時は overlay-runtime と同居し、開発時は
    // akari-preview の追跡済み generated/ を読む。legacy 明示時は呼ばれない任意資産。
    protected findFrameEngineBundle(): string | undefined {
        const fileName = 'frame-engine.js';
        const packagedCandidate = resolve(__dirname, '../overlay-runtime', fileName);
        if (this.isFile(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(
                ancestor,
                'apps/shell/extensions/akari-preview/generated',
                fileName
            );
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }
        return undefined;
    }

    protected loadPreviewAudioWorkletSource(): Buffer | undefined {
        if (this.previewAudioWorkletSource === undefined) {
            const bundle = this.findPreviewAudioWorkletBundle();
            this.previewAudioWorkletSource = bundle ? readFileSync(bundle) : null;
        }
        return this.previewAudioWorkletSource ?? undefined;
    }

    protected findPreviewAudioWorkletBundle(): string | undefined {
        const fileName = 'preview-audio-worklet.js';
        const packagedCandidate = resolve(__dirname, '../overlay-runtime', fileName);
        if (this.isFile(packagedCandidate)) {
            return packagedCandidate;
        }

        let ancestor = resolve(__dirname);
        for (let depth = 0; depth < 10; depth++) {
            const candidate = resolve(
                ancestor,
                'apps/shell/extensions/akari-preview/generated',
                fileName
            );
            if (this.isFile(candidate)) {
                return candidate;
            }
            const parent = dirname(ancestor);
            if (parent === ancestor) {
                break;
            }
            ancestor = parent;
        }
        return undefined;
    }

    protected isOverlayRuntimeDirectory(candidate: string): boolean {
        try {
            return statSync(resolve(candidate, 'overlay-runtime.js')).isFile()
                && statSync(resolve(candidate, 'keyframes.mjs')).isFile()
                && statSync(resolve(candidate, 'three-runtime.js')).isFile()
                && statSync(resolve(candidate, 'video-fx.js')).isFile()
                && statSync(resolve(candidate, 'vendor/three-bundle.js')).isFile()
                && statSync(resolve(candidate, 'interaction.js')).isFile()
                && statSync(resolve(candidate, 'interaction.css')).isFile();
        } catch {
            return false;
        }
    }
}
