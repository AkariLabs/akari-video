import URI from '@theia/core/lib/common/uri';
import { Command, CommandRegistry, MessageService } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { ApplicationShell, FrontendApplicationContribution, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewService, OverlayRuntimeAssets } from '../common/akari-preview-protocol';
import { locatePreviewCaptions, parsePreviewCaptions, PreviewCaption } from './akari-preview-captions';

interface OverlayTransform {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

interface EditSummaryOverlay {
    id: string;
    html: string;
    start: number;
    duration: number;
    track: number;
    transform: OverlayTransform;
    vars: Record<string, string>;
}

interface EditSummaryLayer {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    src?: string;
    transform: OverlayTransform;
    opacity: number;
    blend: string;
    chromaKey: boolean;
    proxyMissing: boolean;
}

interface EditSummaryCut {
    in: number;
    out: number;
    speed?: number;
    transitionOut?: {
        type: 'dissolve' | 'fade-black' | 'fade-white';
        duration: number;
    };
}

interface EditSummaryAudioSource {
    src: string;
    gainDb: number;
}

interface EditSummaryBgm extends EditSummaryAudioSource {
    ducking: boolean;
    fadeIn?: number;
    fadeOut?: number;
}

interface EditSummaryTimedAudio extends EditSummaryAudioSource {
    id: string;
    t: number;
}

interface EditSummaryAudio {
    bgm?: EditSummaryBgm;
    sfx: EditSummaryTimedAudio[];
    narration: EditSummaryTimedAudio[];
}

interface EditSummary {
    output: { width: number; height: number; fps?: number };
    overlays: EditSummaryOverlay[];
    layers: EditSummaryLayer[];
    cuts: EditSummaryCut[];
    audio?: EditSummaryAudio;
    indicators: string[];
}

interface PreviewModel {
    summary: EditSummary;
    editUri?: URI;
    relatedEditUri?: URI;
    sourceUri?: URI;
    overlayUris: URI[];
    assetUris: URI[];
    assetStreamIds: string[];
    captionsUri?: URI;
    captions: PreviewCaption[];
    session?: { muted: boolean; captionsVisible: boolean; hiddenTracks: number[] };
}

interface OverlayWriteRequest {
    type: 'akari-preview-overlay-write';
    requestId: string;
    overlayId: string;
    patch: {
        vars?: Record<string, unknown>;
        transform?: OverlayTransform;
    };
}

interface WaveformFetchRequest {
    type: 'akari-preview-waveform-fetch';
    requestId: string;
}

interface OpenOutputRequest {
    type: 'akari-preview-open-output-request';
}

interface PreviewWidgetMarker extends WebviewWidget {
    akariPreviewConfigured?: boolean;
    akariPreviewConfiguration?: Promise<void>;
    akariPreviewRefresh?: Promise<void>;
    akariPreviewCaptionsUpdate?: Promise<void>;
    akariPreviewEditUri?: URI;
    akariPreviewRelatedEditUri?: URI;
    akariPreviewVideoUri?: URI;
    akariPreviewCaptionsUri?: URI;
    akariPreviewTrackedResources?: Set<string>;
    akariPreviewStreamId?: string;
    akariPreviewAssetStreamIds?: string[];
    akariPreviewSeekable?: boolean;
    akariPreviewMuted?: boolean;
    akariPreviewCaptionsVisible?: boolean;
    akariPreviewHiddenTracks?: Set<number>;
}

// akari-transcript の AKARI_TRANSCRIPT_SEEK_REQUESTED.id（akari-transcript-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.registerHandler に後付け登録する。
const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';
// akari-annotations 側の PREVIEW_PLAYBACK_TICK_EVENT とミラー。
const PREVIEW_PLAYBACK_TICK_EVENT = 'akari.preview.playbackTick';
const TIMELINE_OVERLAY_SELECTED_EVENT = 'akari.timeline.overlaySelected';
const TIMELINE_SET_MUTED_EVENT = 'akari.timeline.setMuted';
const TIMELINE_SET_TRACK_VISIBILITY_EVENT = 'akari.timeline.setTrackVisibility';
const TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT = 'akari.timeline.setCaptionsVisibility';
const PREVIEW_OVERLAY_SELECTED_EVENT = 'akari.preview.overlaySelected';

// akari-annotations の ATTACH_AKARI_ANNOTATIONS_PASSIVE.id（akari-annotations-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.executeCommand に渡す。
const ATTACH_TIMELINE_PASSIVE_COMMAND_ID = 'akari.annotations.attachPassive';

// タイムライン操作時にアウトプットプレビューのタブを前面へ出すための内部コマンド。
// label なし = コマンドパレット非表示（ATTACH_AKARI_ANNOTATIONS_PASSIVE と同じパターン）。
const ENSURE_PREVIEW_VISIBLE_COMMAND: Command = { id: 'akari.preview.ensureVisible' };
const SEEK_OUTPUT_PREVIEW_COMMAND: Command = { id: 'akari.preview.seekOutput' };
const PREVIEW_OPEN_TIMEOUT_MS = 10_000;
const PREVIEW_OPEN_ATTEMPTS = 2;
const PREVIEW_OPEN_ERROR_MESSAGE = '動画プレビューを開けませんでした。しばらく待ってから、もう一度お試しください。';

interface TranscriptSeekRequest {
    videoUri?: string;
    time?: number;
    captionId?: string;
}

interface EnsureVisibleRequest {
    editUri?: string;
}

interface SeekOutputRequest {
    editUri?: string;
    time?: number;
}

interface PreviewPlaybackTickRequest {
    type: 'akari-preview-playback-tick';
    time: number;
    playing: boolean;
}

interface PreviewOverlaySelectedRequest {
    type: 'akari-preview-overlay-selected';
    overlayId: string | null;
}

interface PreviewSessionSettings {
    muted: boolean;
    captionsVisible: boolean;
    hiddenTracks: Set<number>;
}

const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: [],
    layers: [],
    cuts: [],
    indicators: []
};
const SKIPPED_DIRECTORIES = new Set(['.git', '.akari', 'node_modules']);
const PLAYABLE_VIDEO_MIME_TYPES = new Map<string, string>([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/mp4'],
    ['.m4v', 'video/mp4'],
    ['.webm', 'video/webm']
]);
const UNSUPPORTED_VIDEO_EXTENSIONS = new Set(['.mkv', '.avi', '.mts', '.m2ts', '.wmv']);
const CLAIMED_VIDEO_EXTENSIONS = new Set([
    ...PLAYABLE_VIDEO_MIME_TYPES.keys(),
    ...UNSUPPORTED_VIDEO_EXTENSIONS
]);
const UNSUPPORTED_FORMAT_MESSAGE = 'この形式はアプリ内プレビューに未対応です。書き出し後の MP4 をプレビューできます。';
const OUTSIDE_WORKSPACE_MESSAGE = 'ワークスペース外の動画はプレビューできません。';
const THREE_SCENE_KEYS = new Set(['model', 'camera', 'lights', 'animationClip', 'materialOverrides']);
const LAYER_BLEND_TO_CSS = new Map<string, string>([
    ['normal', 'normal'],
    ['screen', 'screen'],
    ['multiply', 'multiply'],
    ['add', 'plus-lighter'],
    ['difference', 'difference'],
    ['darken', 'darken'],
    ['lighten', 'lighten'],
    ['overlay', 'overlay'],
    ['hardlight', 'hard-light'],
    ['softlight', 'soft-light']
]);

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-preview-open-handler';
    protected readonly recentWrites = new Map<string, number>();
    protected readonly openPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly openOutputPreviews = new Map<string, PreviewWidgetMarker>();
    protected readonly previewSessionSettings = new Map<string, PreviewSessionSettings>();
    protected readonly pendingOutputInitialSeek = new Map<string, number>();
    protected overlayWriteTail = Promise.resolve();
    protected readonly lifecycleDisposables = new DisposableCollection();
    protected retryWidgetSequence = 0;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(MessageService)
    protected readonly messages: MessageService;

    onStart(): void {
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            const kind = id.startsWith('akari-output-preview-') ? 'output'
                : id.startsWith('akari-preview-') ? 'raw' : undefined;
            if (kind && viewId) {
                const identityUri = new URI(viewId).normalizePath();
                const initialSeekTime = kind === 'output'
                    ? this.pendingOutputInitialSeek.get(identityUri.toString())
                    : undefined;
                void this.configurePreview(event.widget, identityUri, kind, initialSeekTime).catch(error => {
                    if (!event.widget.isDisposed) {
                        console.warn('[akari-preview] failed to configure created preview widget', viewId, error);
                    }
                });
            }
        });
        this.registerSeekHandler();
        this.registerEnsureVisibleCommand();
        this.registerOutputSeekCommand();
        const onTimelineOverlaySelected = (event: Event): void => {
            const detail = (event as CustomEvent<{ editUri?: string; overlayId?: string | null }>).detail;
            if (!detail?.editUri || (typeof detail.overlayId !== 'string' && detail.overlayId !== null)) {
                return;
            }
            let key: string;
            try {
                key = new URI(detail.editUri).normalizePath().toString();
            } catch {
                return;
            }
            const widget = this.openOutputPreviews.get(key);
            if (widget?.isAttached) {
                widget.sendMessage({ type: 'akari-preview-select-overlay', overlayId: detail.overlayId });
            }
        };
        window.addEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected);
        this.lifecycleDisposables.push({
            dispose: () => window.removeEventListener(TIMELINE_OVERLAY_SELECTED_EVENT, onTimelineOverlaySelected)
        });
        const registerTimelineSetting = <T extends { editUri?: string }>(
            type: string,
            apply: (widget: PreviewWidgetMarker | undefined, detail: T, settings: PreviewSessionSettings) => void
        ): void => {
            const listener = (event: Event): void => {
                const detail = (event as CustomEvent<T>).detail;
                if (!detail?.editUri) {
                    return;
                }
                let key: string;
                try {
                    key = new URI(detail.editUri).normalizePath().toString();
                } catch {
                    return;
                }
                const settings = this.previewSessionSettings.get(key) ?? {
                    muted: false, captionsVisible: true, hiddenTracks: new Set<number>()
                };
                const widget = this.openOutputPreviews.get(key);
                apply(widget?.isAttached ? widget : undefined, detail, settings);
                this.previewSessionSettings.set(key, settings);
            };
            window.addEventListener(type, listener);
            this.lifecycleDisposables.push({ dispose: () => window.removeEventListener(type, listener) });
        };
        registerTimelineSetting<{ editUri?: string; muted?: boolean }>(TIMELINE_SET_MUTED_EVENT, (widget, detail, settings) => {
            if (typeof detail.muted !== 'boolean') return;
            settings.muted = detail.muted;
            if (widget) {
                widget.akariPreviewMuted = detail.muted;
                widget.sendMessage({ type: 'akari-preview-set-muted', muted: detail.muted });
            }
        });
        registerTimelineSetting<{ editUri?: string; track?: number; visible?: boolean }>(
            TIMELINE_SET_TRACK_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (!Number.isInteger(detail.track) || detail.track! < 0 || typeof detail.visible !== 'boolean') return;
                if (detail.visible) settings.hiddenTracks.delete(detail.track!); else settings.hiddenTracks.add(detail.track!);
                if (widget) {
                    widget.akariPreviewHiddenTracks = new Set(settings.hiddenTracks);
                    widget.sendMessage({
                        type: 'akari-preview-set-track-visibility', track: detail.track, visible: detail.visible
                    });
                }
            }
        );
        registerTimelineSetting<{ editUri?: string; visible?: boolean }>(
            TIMELINE_SET_CAPTIONS_VISIBILITY_EVENT, (widget, detail, settings) => {
                if (typeof detail.visible !== 'boolean') return;
                settings.captionsVisible = detail.visible;
                if (widget) {
                    widget.akariPreviewCaptionsVisible = detail.visible;
                    widget.sendMessage({ type: 'akari-preview-set-captions-visibility', visible: detail.visible });
                }
            }
        );
    }

    onStop(): void {
        this.lifecycleDisposables.dispose();
    }

    // 戻り値は 'seeked' | 'mismatched-asset' | 'no-preview' の3値で、'no-preview' は akari-transcript 側のフォールバックハンドラが返す。
    protected registerSeekHandler(): void {
        this.commandRegistry.registerHandler(TRANSCRIPT_SEEK_COMMAND_ID, {
            isEnabled: () => this.openPreviews.size > 0,
            execute: (request?: TranscriptSeekRequest) => {
                const widget = this.findSeekableWidget(request?.videoUri);
                if (widget && Number.isFinite(request?.time)) {
                    widget.sendMessage({ type: 'akari-preview-seek', time: request!.time });
                    return 'seeked';
                }
                return 'mismatched-asset';
            }
        });
    }

    protected findSeekableWidget(videoUri: string | undefined): PreviewWidgetMarker | undefined {
        if (!videoUri) {
            return undefined;
        }
        const key = new URI(videoUri).normalizePath().toString();
        const widget = this.openPreviews.get(key);
        return widget && widget.isAttached && widget.akariPreviewSeekable ? widget : undefined;
    }

    canHandle(uri: URI): number {
        return CLAIMED_VIDEO_EXTENSIONS.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identityUri = uri.normalizePath();
        try {
            const widget = await this.getOrOpenPreview(
                identityUri,
                options?.widgetOptions ?? { area: 'main' },
                'raw'
            );
            this.attachTimelinePassively();
            await this.shell.activateWidget(widget.id);
            return widget;
        } catch (error) {
            this.reportOpenFailure(identityUri, error);
            throw error;
        }
    }

    async openOutput(uri: URI, options?: any): Promise<WebviewWidget> {
        const editUri = uri.normalizePath();
        try {
            const widget = await this.getOrOpenPreview(
                editUri,
                options?.widgetOptions ?? { area: 'main' },
                'output'
            );
            this.attachTimelinePassively();
            await this.shell.activateWidget(widget.id);
            return widget;
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            throw error;
        }
    }

    // 動画がプレビューで開かれるたびにタイムラインの自動アタッチを要求する。重複禁止・
    // セッション内の明示クローズの尊重・フォーカスを奪わない（reveal のみ）判断は
    // 呼び出し先（akari-annotations）に委ねる。取りこぼしてもプレビュー自体は開けるべきなので
    // 結果を待たず、失敗時は握りつぶす。
    protected attachTimelinePassively(): void {
        this.commandRegistry.executeCommand(ATTACH_TIMELINE_PASSIVE_COMMAND_ID)
            .catch(error => console.warn('[akari-preview] failed to auto-attach timeline', error));
    }

    // タイムライン側からの操作で、他のタブを見ていてもアウトプットプレビューのタブを
    // 必ず前面へ出すための内部コマンド。フォーカスは奪わない（revealWidget のみ）。
    protected registerEnsureVisibleCommand(): void {
        this.commandRegistry.registerCommand(ENSURE_PREVIEW_VISIBLE_COMMAND, {
            execute: (request?: EnsureVisibleRequest) => this.ensureVisible(request?.editUri)
        });
    }

    protected async ensureVisible(editUri: string | undefined): Promise<'revealed' | 'opened' | 'unavailable'> {
        if (!editUri) {
            return 'unavailable';
        }
        try {
            const uri = new URI(editUri).normalizePath();
            const existing = this.openOutputPreviews.get(uri.toString());
            if (existing?.akariPreviewConfigured && existing.isAttached && !existing.isDisposed) {
                this.shell.revealWidget(existing.id);
                return 'revealed';
            }
            const widget = await this.getOrOpenPreview(uri, { area: 'main' }, 'output');
            this.shell.revealWidget(widget.id);
            return 'opened';
        } catch (error) {
            this.reportOpenFailure(new URI(editUri), error);
            return 'unavailable';
        }
    }

    protected registerOutputSeekCommand(): void {
        this.commandRegistry.registerCommand(SEEK_OUTPUT_PREVIEW_COMMAND, {
            execute: (request?: SeekOutputRequest) => this.seekOutputPreview(request)
        });
    }

    protected async seekOutputPreview(
        request: SeekOutputRequest | undefined
    ): Promise<'seeked' | 'mismatched-asset'> {
        if (!request?.editUri || !Number.isFinite(request.time)) {
            return 'mismatched-asset';
        }
        const editUri = new URI(request.editUri).normalizePath();
        const key = editUri.toString();
        const existing = this.openOutputPreviews.get(key);
        if (existing?.akariPreviewConfigured && existing.akariPreviewSeekable && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, { area: 'main' });
            }
            this.shell.revealWidget(existing.id);
            existing.sendMessage({ type: 'akari-preview-seek', time: request.time });
            return 'seeked';
        }
        try {
            const widget = await this.getOrOpenPreview(editUri, { area: 'main' }, 'output', request.time);
            this.shell.revealWidget(widget.id);
            this.attachTimelinePassively();
            return 'seeked';
        } catch (error) {
            this.reportOpenFailure(editUri, error);
            return 'mismatched-asset';
        }
    }

    protected async getOrOpenPreview(
        uri: URI,
        widgetOptions: any,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<WebviewWidget> {
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        const existing = previews.get(seekKey);
        if (existing?.akariPreviewConfigured && !existing.isDisposed) {
            if (!existing.isAttached) {
                this.shell.addWidget(existing, widgetOptions);
            }
            if (kind === 'output' && Number.isFinite(initialSeekTime)) {
                existing.sendMessage({ type: 'akari-preview-seek', time: initialSeekTime });
            }
            return existing;
        }

        if (kind === 'output' && Number.isFinite(initialSeekTime)) {
            this.pendingOutputInitialSeek.set(seekKey, initialSeekTime!);
        }
        const baseId = kind === 'output'
            ? `akari-output-preview-${this.hash(uri.toString())}`
            : `akari-preview-${this.hash(uri.toString())}`;
        let lastError: unknown;
        let useFreshIdentifier = false;
        for (let attempt = 1; attempt <= PREVIEW_OPEN_ATTEMPTS; attempt += 1) {
            const identifier = {
                id: useFreshIdentifier ? `${baseId}-retry-${++this.retryWidgetSequence}` : baseId,
                viewId: uri.toString()
            };
            let widget: WebviewWidget | undefined;
            let abandoned = false;
            const operation = (async (): Promise<WebviewWidget> => {
                widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
                if (abandoned) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview open attempt was superseded.');
                }
                await this.configurePreview(widget, uri, kind, initialSeekTime);
                if (abandoned || widget.isDisposed) {
                    this.discardPreviewWidget(widget, uri, kind);
                    throw new Error('Preview widget was disposed while opening.');
                }
                if (!widget.isAttached) {
                    this.shell.addWidget(widget, widgetOptions);
                }
                return widget;
            })();
            try {
                return await this.withOpenTimeout(operation, uri);
            } catch (error) {
                abandoned = true;
                lastError = error;
                if (widget) {
                    this.discardPreviewWidget(widget, uri, kind);
                } else {
                    // WidgetManager は作成中 Promise を同じ ID で再利用する。作成自体が止まった場合は
                    // 次の試行だけ新しい ID にし、遅れて生成された widget は operation 側で破棄する。
                    useFreshIdentifier = true;
                }
                if (attempt < PREVIEW_OPEN_ATTEMPTS) {
                    console.warn(`[akari-preview] open attempt ${attempt} failed; retrying`, uri.toString(), error);
                }
            }
        }
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    protected withOpenTimeout<T>(operation: Promise<T>, uri: URI): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                reject(new Error(`Timed out after ${PREVIEW_OPEN_TIMEOUT_MS}ms while opening ${uri.toString()}`));
            }, PREVIEW_OPEN_TIMEOUT_MS);
            operation.then(value => {
                window.clearTimeout(timeout);
                resolve(value);
            }, error => {
                window.clearTimeout(timeout);
                reject(error);
            });
        });
    }

    protected discardPreviewWidget(widget: WebviewWidget, uri: URI, kind: 'raw' | 'output'): void {
        const marker = widget as PreviewWidgetMarker;
        const seekKey = uri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        if (previews.get(seekKey) === marker) {
            previews.delete(seekKey);
        }
        if (!widget.isDisposed) {
            widget.dispose();
        }
        void this.disposePreviewStreams(marker);
    }

    protected reportOpenFailure(uri: URI, error: unknown): void {
        console.error('[akari-preview] failed to open preview', uri.toString(), error);
        void this.messages.error(`${uri.path.base}: ${PREVIEW_OPEN_ERROR_MESSAGE}`);
    }

    protected async configurePreview(
        widget: WebviewWidget,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const marker = widget as PreviewWidgetMarker;
        if (marker.akariPreviewConfiguration) {
            return marker.akariPreviewConfiguration;
        }
        marker.akariPreviewConfiguration = this.doConfigurePreview(marker, identityUri, kind, initialSeekTime);
        try {
            await marker.akariPreviewConfiguration;
        } finally {
            marker.akariPreviewConfiguration = undefined;
        }
    }

    protected async doConfigurePreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        const seekKey = identityUri.normalizePath().toString();
        const previews = kind === 'output' ? this.openOutputPreviews : this.openPreviews;
        previews.set(seekKey, widget);
        const session = kind === 'output' ? this.previewSessionSettings.get(seekKey) : undefined;
        if (session) {
            widget.akariPreviewMuted = session.muted;
            widget.akariPreviewCaptionsVisible = session.captionsVisible;
            widget.akariPreviewHiddenTracks = new Set(session.hiddenTracks);
        }
        await this.refreshPreview(widget, identityUri, kind, initialSeekTime);
        if (kind === 'output') {
            this.pendingOutputInitialSeek.delete(seekKey);
        }

        if (widget.isDisposed) {
            return;
        }

        if (widget.akariPreviewConfigured) {
            return;
        }
        widget.akariPreviewConfigured = true;
        const disposables = new DisposableCollection();
        disposables.push(widget.onMessage(message => {
            if (this.isOverlayWriteRequest(message)) {
                this.overlayWriteTail = this.overlayWriteTail.then(() => this.handleOverlayWrite(widget, message));
            }
            if (this.isWaveformFetchRequest(message)) {
                void this.handleWaveformFetch(widget, message);
            }
            if (this.isOpenOutputRequest(message)) {
                void this.handleOpenOutputRequest(widget);
            }
            if (message?.type === 'akari-preview-fullscreen-fallback') {
                this.shell.toggleMaximized(widget);
            }
            if (this.isPlaybackTickRequest(message)) {
                this.forwardPlaybackTick(widget, message);
            }
            if (this.isOverlaySelectedRequest(message)) {
                this.forwardOverlaySelection(widget, message);
            }
        }));
        const handleFilesChanged = (event: FileChangesEvent): void => {
            const tracked = widget.akariPreviewTrackedResources ?? new Set<string>();
            const captionsKey = widget.akariPreviewCaptionsUri?.toString();
            let captionsChanged = false;
            let previewChanged = false;
            for (const change of event.changes) {
                const key = change.resource.toString();
                const writtenAt = this.recentWrites.get(key) ?? 0;
                if (key === captionsKey) {
                    captionsChanged ||= Date.now() - writtenAt > 1000;
                    continue;
                }
                if (tracked.has(key)) {
                    previewChanged ||= Date.now() - writtenAt > 1000;
                    continue;
                }
                previewChanged ||= !widget.akariPreviewEditUri && change.resource.path.base === 'edit.json';
            }
            if (captionsChanged) {
                this.queueCaptionsUpdate(widget);
            }
            if (previewChanged) {
                this.queueRefresh(widget, identityUri, kind);
            }
        };
        for (const root of await this.workspaceService.roots) {
            disposables.push(await this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        }
        const videoUri = widget.akariPreviewVideoUri;
        if (videoUri && !(await this.isInsideWorkspace(videoUri))) {
            disposables.push(await this.fileService.watch(videoUri.parent, { recursive: true, excludes: [] }));
        }
        if (widget.isDisposed) {
            disposables.dispose();
            return;
        }
        // watch 登録時の初期イベントで、完成直後の HTML をもう一度ロードしない。
        // 実際のファイル変更は全 watch が確立した後から購読する。
        disposables.push(this.fileService.onDidFilesChange(handleFilesChanged));
        widget.disposed.connect(() => {
            disposables.dispose();
            if (previews.get(seekKey) === widget) {
                previews.delete(seekKey);
            }
            void this.disposePreviewStreams(widget);
        });
    }

    protected isPlaybackTickRequest(message: any): message is PreviewPlaybackTickRequest {
        return message?.type === 'akari-preview-playback-tick'
            && Number.isFinite(message.time)
            && typeof message.playing === 'boolean';
    }

    protected forwardPlaybackTick(widget: PreviewWidgetMarker, message: PreviewPlaybackTickRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_PLAYBACK_TICK_EVENT, {
            detail: {
                videoUri: editUri.normalizePath().toString(),
                time: message.time,
                playing: message.playing
            }
        }));
    }

    protected isOverlaySelectedRequest(message: any): message is PreviewOverlaySelectedRequest {
        return message?.type === 'akari-preview-overlay-selected'
            && (typeof message.overlayId === 'string' || message.overlayId === null);
    }

    protected forwardOverlaySelection(widget: PreviewWidgetMarker, message: PreviewOverlaySelectedRequest): void {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            return;
        }
        window.dispatchEvent(new CustomEvent(PREVIEW_OVERLAY_SELECTED_EVENT, {
            detail: {
                videoUri: editUri.normalizePath().toString(),
                overlayId: message.overlayId
            }
        }));
    }

    protected queueRefresh(widget: PreviewWidgetMarker, identityUri: URI, kind: 'raw' | 'output'): void {
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        widget.akariPreviewRefresh = previous.then(
            () => this.refreshPreview(widget, identityUri, kind),
            () => this.refreshPreview(widget, identityUri, kind)
        ).catch(error => console.error('[akari-preview] failed to refresh preview', error));
    }

    protected queueCaptionsUpdate(widget: PreviewWidgetMarker): void {
        const previous = widget.akariPreviewCaptionsUpdate ?? Promise.resolve();
        widget.akariPreviewCaptionsUpdate = previous.then(async () => {
            const captions = await this.loadPreviewCaptions(widget.akariPreviewCaptionsUri);
            widget.sendMessage({ type: 'akari-preview-captions-update', captions });
        }).catch(error => console.error('[akari-preview] failed to update captions', error));
    }

    protected async refreshPreview(
        widget: PreviewWidgetMarker,
        identityUri: URI,
        kind: 'raw' | 'output',
        initialSeekTime?: number
    ): Promise<void> {
        if (widget.isDisposed) {
            return;
        }
        const [model, assets] = await Promise.all([
            kind === 'output' ? this.loadPreviewModel(identityUri) : this.loadRawPreviewModel(identityUri),
            this.previewService.getOverlayRuntimeAssets()
        ]);
        const videoUri = kind === 'output' ? model.sourceUri : identityUri;
        if (!videoUri) {
            await this.disposeAssetStreams(model.assetStreamIds);
            throw new Error(`${identityUri.toString()} の source.path を解決できませんでした。`);
        }
        const extension = videoUri.path.ext.toLowerCase();
        const mimeType = PLAYABLE_VIDEO_MIME_TYPES.get(extension);
        if (!mimeType) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, UNSUPPORTED_FORMAT_MESSAGE, identityUri, kind);
            return;
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            await this.disposeAssetStreams(model.assetStreamIds);
            this.showMessageCard(widget, videoUri, OUTSIDE_WORKSPACE_MESSAGE, identityUri, kind);
            return;
        }
        if (widget.isDisposed) {
            await this.disposeAssetStreams(model.assetStreamIds);
            return;
        }
        const videoStream = await this.previewService.createVideoStream({
            videoUri: videoUri.toString()
        }).catch(async error => {
            await this.disposeAssetStreams(model.assetStreamIds);
            throw error;
        });
        if (widget.isDisposed) {
            await Promise.all([
                this.disposeVideoStreamId(videoStream.id),
                this.disposeAssetStreams(model.assetStreamIds)
            ]);
            return;
        }
        await this.disposePreviewStreams(widget);
        if (widget.isDisposed) {
            await Promise.all([
                this.disposeVideoStreamId(videoStream.id),
                this.disposeAssetStreams(model.assetStreamIds)
            ]);
            return;
        }
        widget.akariPreviewStreamId = videoStream.id;
        widget.akariPreviewAssetStreamIds = model.assetStreamIds;
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewRelatedEditUri = model.relatedEditUri;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewCaptionsUri = model.captionsUri;
        widget.akariPreviewTrackedResources = new Set([
            ...(model.editUri ? [model.editUri.toString()] : []),
            ...(model.relatedEditUri ? [model.relatedEditUri.toString()] : []),
            ...(model.captionsUri ? [model.captionsUri.toString()] : []),
            ...model.overlayUris.map(uri => uri.toString()),
            ...model.assetUris.map(uri => uri.toString())
        ]);
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true
        });
        widget.akariPreviewSeekable = true;
        model.session = {
            muted: widget.akariPreviewMuted ?? false,
            captionsVisible: widget.akariPreviewCaptionsVisible ?? true,
            hiddenTracks: [...(widget.akariPreviewHiddenTracks ?? new Set<number>())]
        };
        widget.setHTML(this.prepareHtml(videoUri, videoStream.url, model, assets, initialSeekTime));
    }

    protected showMessageCard(
        widget: PreviewWidgetMarker,
        videoUri: URI,
        message: string,
        identityUri: URI,
        kind: 'raw' | 'output'
    ): void {
        widget.akariPreviewSeekable = false;
        void this.disposePreviewStreams(widget);
        widget.akariPreviewEditUri = kind === 'output' ? identityUri : undefined;
        widget.akariPreviewRelatedEditUri = undefined;
        widget.akariPreviewVideoUri = videoUri;
        widget.akariPreviewCaptionsUri = undefined;
        widget.akariPreviewTrackedResources = new Set(kind === 'output' ? [identityUri.toString()] : []);
        widget.viewType = 'akari.preview';
        widget.title.label = kind === 'output' ? '出力プレビュー' : videoUri.path.base;
        widget.title.caption = kind === 'output' ? identityUri.toString() : videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({ allowScripts: false, allowForms: false });
        widget.setHTML(this.prepareMessageHtml(message));
    }

    protected async loadRawPreviewModel(videoUri: URI): Promise<PreviewModel> {
        const relatedEditUri = await this.findEditJson(videoUri);
        return {
            summary: EMPTY_SUMMARY,
            relatedEditUri,
            overlayUris: [],
            assetUris: [],
            assetStreamIds: [],
            captions: []
        };
    }

    protected async loadPreviewModel(editUri: URI): Promise<PreviewModel> {
        const [workspaceRoot] = await this.workspaceService.roots;
        const captionsUri = locatePreviewCaptions(editUri, workspaceRoot?.resource);
        const captions = await this.loadPreviewCaptions(captionsUri);
        const assetStreams = new Map<string, { id: string; url: string }>();
        const assetUris: URI[] = [];
        let sourceUri: URI | undefined;
        try {
            const edit = JSON.parse(await this.readText(editUri));
            if (typeof edit?.source?.path !== 'string' || !edit.source.path.trim()) {
                throw new TypeError('edit.json の source.path が不正です。');
            }
            sourceUri = this.resolveEditAssetUri(edit.source.path, editUri);
            const isTruthyObject = (value: unknown): boolean => Boolean(value)
                && typeof value === 'object' && !Array.isArray(value);
            const width = this.positiveNumber(edit?.output?.width, EMPTY_SUMMARY.output.width);
            const height = this.positiveNumber(edit?.output?.height, EMPTY_SUMMARY.output.height);
            const cuts: EditSummaryCut[] = [];
            for (const value of Array.isArray(edit?.cuts) ? edit.cuts : []) {
                const inSeconds = this.finiteNumber(value?.in, NaN);
                const outSeconds = this.finiteNumber(value?.out, NaN);
                if (Number.isFinite(inSeconds) && Number.isFinite(outSeconds) && outSeconds > inSeconds) {
                    let speed: number | undefined;
                    if (value?.speed !== undefined) {
                        if (typeof value.speed === 'number' && Number.isFinite(value.speed) && value.speed > 0) {
                            speed = value.speed;
                        } else {
                            console.warn('[akari-preview] cut.speed を無視しました（正の有限 number ではありません）', value.speed);
                        }
                    }
                    let transitionOut: EditSummaryCut['transitionOut'];
                    if (value?.transition_out !== undefined && value.transition_out !== null) {
                        const transition = value.transition_out;
                        const validType = transition?.type === 'dissolve'
                            || transition?.type === 'fade-black'
                            || transition?.type === 'fade-white';
                        const validDuration = typeof transition?.duration === 'number'
                            && Number.isFinite(transition.duration) && transition.duration > 0;
                        if (transition && typeof transition === 'object' && !Array.isArray(transition)
                            && validType && validDuration) {
                            transitionOut = { type: transition.type, duration: transition.duration };
                        } else {
                            console.warn('[akari-preview] cut.transition_out を無視しました（type/duration 不正）', transition);
                        }
                    }
                    cuts.push({
                        in: inSeconds,
                        out: outSeconds,
                        ...(speed !== undefined ? { speed } : {}),
                        ...(transitionOut ? { transitionOut } : {})
                    });
                } else {
                    console.warn('[akari-preview] cuts entry を無視しました（in/out 不正）', value);
                }
            }
            const overlays: EditSummaryOverlay[] = [];
            const overlayUris: URI[] = [];
            for (const value of Array.isArray(edit?.overlays) ? edit.overlays : []) {
                if (value?.track !== undefined && (!Number.isInteger(value.track) || value.track < 0)) {
                    console.warn('[akari-preview] overlay track が不正なため track 0 として表示します', value?.id);
                }
                const rawHtml = typeof value?.html === 'string' ? value.html : '';
                let html = rawHtml;
                if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
                    const fragmentUri = editUri.parent.resolve(rawHtml);
                    overlayUris.push(fragmentUri);
                    try {
                        html = await this.readText(fragmentUri);
                    } catch (error) {
                        html = '';
                        console.warn(`[akari-preview] failed to read overlay fragment ${fragmentUri.toString()}`, error);
                    }
                }
                html = await this.resolveThreeSceneAssets(html, editUri, assetStreams, assetUris);
                overlays.push({
                    id: String(value?.id ?? ''),
                    html,
                    start: this.finiteNumber(value?.start, 0),
                    duration: this.finiteNumber(value?.duration, 0),
                    track: Number.isInteger(value?.track) && value.track >= 0 ? value.track : 0,
                    transform: this.transform(value?.transform),
                    vars: this.stringRecord(value?.vars)
                });
            }
            const layers: EditSummaryLayer[] = [];
            let unsupportedBlendCount = 0;
            for (let index = 0; index < (Array.isArray(edit?.layers) ? edit.layers.length : 0); index += 1) {
                const value = edit.layers[index];
                const label = `layers[${index}]`;
                const validObject = value && typeof value === 'object' && !Array.isArray(value);
                const validId = typeof value?.id === 'string' && Boolean(value.id.trim());
                const validT = typeof value?.t === 'number' && Number.isFinite(value.t) && value.t >= 0;
                const validDuration = typeof value?.duration === 'number'
                    && Number.isFinite(value.duration) && value.duration > 0;
                const validKind = value?.kind === 'baked' || value?.kind === 'video';
                const validSrc = typeof value?.src === 'string' && Boolean(value.src.trim());
                if (!validObject || !validId || !validT || !validDuration || !validKind || !validSrc) {
                    console.warn(`[akari-preview] ${label} を無視しました（id/t/duration/kind/src 不正）`, value);
                    continue;
                }

                let opacity = 1;
                if (value.opacity !== undefined) {
                    if (typeof value.opacity === 'number' && Number.isFinite(value.opacity)
                        && value.opacity >= 0 && value.opacity <= 1) {
                        opacity = value.opacity;
                    } else {
                        console.warn(`[akari-preview] ${label}.opacity は 1 で近似します（0〜1 の有限 number ではありません）`, value.opacity);
                    }
                }
                let blend = 'normal';
                if (value.blend !== undefined) {
                    const mapped = typeof value.blend === 'string'
                        ? LAYER_BLEND_TO_CSS.get(value.blend)
                        : undefined;
                    if (mapped) {
                        blend = mapped;
                    } else {
                        unsupportedBlendCount += 1;
                        console.warn(`[akari-preview] ${label}.blend は normal で近似します（未対応値）`, value.blend);
                    }
                }

                const base: Omit<EditSummaryLayer, 'src' | 'proxyMissing'> = {
                    id: value.id,
                    t: value.t,
                    duration: value.duration,
                    kind: value.kind,
                    transform: this.transform(value.transform),
                    opacity,
                    blend,
                    chromaKey: value.kind === 'video' && isTruthyObject(value.chroma_key)
                };
                let sourceUri: URI;
                try {
                    sourceUri = this.resolveEditAssetUri(value.src, editUri);
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（src を解決できません）`, error);
                    continue;
                }
                if (value.kind === 'baked') {
                    const sidecarUri = this.previewProxyUri(sourceUri);
                    if (!assetUris.some(uri => uri.toString() === sidecarUri.toString())) {
                        assetUris.push(sidecarUri);
                    }
                    let src: string | undefined;
                    try {
                        if (await this.fileService.exists(sidecarUri)) {
                            const key = sidecarUri.toString();
                            let stream = assetStreams.get(key);
                            if (!stream) {
                                stream = await this.previewService.createAssetStream({ assetUri: key });
                                assetStreams.set(key, stream);
                            }
                            src = stream.url;
                        }
                    } catch (error) {
                        console.warn(`[akari-preview] ${label} の preview proxy を配信できません`, error);
                    }
                    layers.push({ ...base, ...(src ? { src } : {}), proxyMissing: !src });
                    continue;
                }

                try {
                    const key = sourceUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(sourceUri);
                    }
                    layers.push({ ...base, src: stream.url, proxyMissing: false });
                } catch (error) {
                    console.warn(`[akari-preview] ${label} を無視しました（video レイヤーを配信できません）`, error);
                }
            }
            const audio = await this.resolveAudioAssets(edit?.audio, editUri, assetStreams, assetUris);
            const indicators: string[] = [];
            if (isTruthyObject(edit?.output?.look)) indicators.push('LUT');
            if (isTruthyObject(edit?.source?.chroma_key)
                || (Array.isArray(edit?.sources) && edit.sources.some((source: unknown) =>
                    isTruthyObject((source as { chroma_key?: unknown } | null)?.chroma_key)))
                || (Array.isArray(edit?.layers) && edit.layers.some((layer: unknown) =>
                    isTruthyObject((layer as { chroma_key?: unknown } | null)?.chroma_key)))) {
                indicators.push('クロマキー');
            }
            const missingProxyCount = layers.filter(layer => layer.kind === 'baked' && layer.proxyMissing).length;
            if (missingProxyCount > 0) {
                indicators.push(`テロップ ${missingProxyCount}枚（プレビュー用プロキシ未生成）`);
            }
            if (unsupportedBlendCount > 0) {
                indicators.push(`レイヤー合成モードが未対応（${unsupportedBlendCount}件、normal で近似）`);
            }
            if (isTruthyObject(edit?.audio?.master)) indicators.push('音声マスター処理');
            if (Array.isArray(edit?.cuts) && edit.cuts.some((cut: unknown) =>
                (cut as { transition_out?: { type?: unknown } } | null)?.transition_out?.type === 'dissolve')) {
                indicators.push('ディゾルブ切り替え');
            }
            return {
                editUri,
                sourceUri,
                overlayUris,
                assetUris,
                assetStreamIds: [...assetStreams.values()].map(stream => stream.id),
                captionsUri,
                captions,
                summary: {
                    output: { width, height, fps: this.positiveNumber(edit?.output?.fps, 30) },
                    overlays,
                    layers,
                    cuts,
                    indicators,
                    ...(audio ? { audio } : {})
                }
            };
        } catch (error) {
            await this.disposeAssetStreams([...assetStreams.values()].map(stream => stream.id));
            if (!sourceUri) {
                throw error;
            }
            console.warn(`[akari-preview] failed to load composite data from ${editUri.toString()}; opening source only`, error);
            return {
                editUri,
                sourceUri,
                summary: EMPTY_SUMMARY,
                overlayUris: [],
                assetUris: [],
                assetStreamIds: [],
                captionsUri,
                captions
            };
        }
    }

    protected async resolveAudioAssets(
        value: unknown,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[]
    ): Promise<EditSummaryAudio | undefined> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            if (value !== undefined) {
                console.warn('[akari-preview] audio セクションを無視しました（object ではありません）');
            }
            return undefined;
        }
        const audio = value as { bgm?: unknown; sfx?: unknown; narration?: unknown };
        const resolveSource = async (pathValue: unknown, label: string): Promise<string | undefined> => {
            if (typeof pathValue !== 'string' || !pathValue.trim()) {
                console.warn(`[akari-preview] ${label} を無視しました（path 不正）`);
                return undefined;
            }
            const assetUri = pathValue.startsWith('file:')
                ? new URI(pathValue)
                : pathValue.startsWith('/')
                    ? new URI(pathValue).withScheme('file')
                    : editUri.parent.resolve(pathValue);
            const key = assetUri.toString();
            try {
                let stream = assetStreams.get(key);
                if (!stream) {
                    stream = await this.previewService.createAssetStream({ assetUri: key });
                    assetStreams.set(key, stream);
                    assetUris.push(assetUri);
                }
                return stream.url;
            } catch (error) {
                console.warn(`[akari-preview] ${label} を無視しました（音声ファイルを配信できません）`, error);
                return undefined;
            }
        };
        const gainDb = (gainValue: unknown, label: string): number | undefined => {
            if (gainValue === undefined) {
                return 0;
            }
            if (typeof gainValue !== 'number' || !Number.isFinite(gainValue)) {
                console.warn(`[akari-preview] ${label} を無視しました（gain_db が非有限または number ではありません）`);
                return undefined;
            }
            const clamped = Math.max(-60, Math.min(12, gainValue));
            if (clamped !== gainValue) {
                console.warn(`[akari-preview] ${label}.gain_db を [-60, 12] にクランプしました`, gainValue);
            }
            return clamped;
        };
        const timed = async (items: unknown, kind: 'sfx' | 'narration'): Promise<EditSummaryTimedAudio[]> => {
            if (items === undefined) {
                return [];
            }
            if (!Array.isArray(items)) {
                console.warn(`[akari-preview] audio.${kind} を無視しました（array ではありません）`);
                return [];
            }
            const resolved: EditSummaryTimedAudio[] = [];
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index] as { id?: unknown; path?: unknown; t?: unknown; gain_db?: unknown } | undefined;
                const label = kind === 'narration' && typeof item?.id === 'string' && item.id
                    ? `audio.narration ${item.id}`
                    : `audio.${kind}[${index}]`;
                if (!item || typeof item !== 'object') {
                    console.warn(`[akari-preview] ${label} を無視しました（object ではありません）`);
                    continue;
                }
                if (kind === 'narration' && (typeof item.id !== 'string' || !item.id)) {
                    console.warn(`[akari-preview] ${label} を無視しました（id 不正）`);
                    continue;
                }
                if (typeof item.t !== 'number' || !Number.isFinite(item.t) || item.t < 0) {
                    console.warn(`[akari-preview] ${label} を無視しました（t が非有限・負値・number ではありません）`);
                    continue;
                }
                const normalizedGain = gainDb(item.gain_db, label);
                if (normalizedGain === undefined) {
                    continue;
                }
                const src = await resolveSource(item.path, label);
                if (!src) {
                    continue;
                }
                resolved.push({
                    id: kind === 'narration' ? String(item.id) : `sfx-${index + 1}`,
                    src,
                    t: item.t,
                    gainDb: normalizedGain
                });
            }
            return resolved;
        };

        let bgm: EditSummaryBgm | undefined;
        if (audio.bgm !== undefined) {
            const rawBgm = audio.bgm as {
                path?: unknown;
                gain_db?: unknown;
                ducking?: unknown;
                fadeIn?: unknown;
                fadeOut?: unknown;
            } | undefined;
            if (!rawBgm || typeof rawBgm !== 'object' || Array.isArray(rawBgm)) {
                console.warn('[akari-preview] audio.bgm を無視しました（object ではありません）');
            } else {
                const normalizedGain = gainDb(rawBgm.gain_db, 'audio.bgm');
                if (normalizedGain !== undefined) {
                    const fades: Pick<EditSummaryBgm, 'fadeIn' | 'fadeOut'> = {};
                    for (const [field, raw] of [['fadeIn', rawBgm.fadeIn], ['fadeOut', rawBgm.fadeOut]] as const) {
                        if (raw === undefined) {
                            continue;
                        }
                        if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
                            fades[field] = raw;
                        } else {
                            console.warn(`[akari-preview] audio.bgm.${field} を無視しました（0以上の有限 number ではありません）`, raw);
                        }
                    }
                    const src = await resolveSource(rawBgm.path, 'audio.bgm');
                    if (src) {
                        bgm = { src, gainDb: normalizedGain, ducking: rawBgm.ducking === true, ...fades };
                    }
                }
            }
        }
        const sfx = await timed(audio.sfx, 'sfx');
        const narration = await timed(audio.narration, 'narration');
        if (!bgm && sfx.length === 0 && narration.length === 0) {
            return undefined;
        }
        return { bgm, sfx, narration };
    }

    protected async resolveThreeSceneAssets(
        html: string,
        editUri: URI,
        assetStreams: Map<string, { id: string; url: string }>,
        assetUris: URI[]
    ): Promise<string> {
        if (!html.includes('data-akari-3d-scene')) {
            return html;
        }
        const document = new DOMParser().parseFromString(html, 'text/html');
        const declarations = document.body.querySelectorAll(
            'script[type="application/json"][data-akari-3d-scene]'
        );
        if (declarations.length === 0) {
            return html;
        }
        if (declarations.length !== 1) {
            for (const declaration of Array.from(declarations)) {
                declaration.textContent = JSON.stringify({ model: '' });
            }
            console.warn('[akari-preview] 3D overlay には data-akari-3d-scene 宣言が 1 個必要です');
            return document.body.innerHTML;
        }
        for (const declaration of Array.from(declarations)) {
            try {
                const descriptor = JSON.parse(declaration.textContent || '{}');
                if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)
                    || typeof descriptor.model !== 'string' || !descriptor.model) {
                    throw new TypeError('data-akari-3d-scene.model は edit.json 相対の .glb パスである必要があります');
                }
                if (Object.keys(descriptor).some(key => !THREE_SCENE_KEYS.has(key))) {
                    throw new TypeError('data-akari-3d-scene に未対応の top-level key があります');
                }
                const resolveAsset = async (relativePath: string, field: string): Promise<string> => {
                    if (relativePath.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(relativePath)) {
                        throw new TypeError(`${field} に絶対パスや URL は指定できません`);
                    }
                    const assetUri = editUri.parent.resolve(relativePath);
                    const key = assetUri.toString();
                    let stream = assetStreams.get(key);
                    if (!stream) {
                        stream = await this.previewService.createAssetStream({ assetUri: key });
                        assetStreams.set(key, stream);
                        assetUris.push(assetUri);
                    }
                    return stream.url;
                };
                descriptor.model = await resolveAsset(descriptor.model, 'data-akari-3d-scene.model');
                if (descriptor.materialOverrides !== undefined) {
                    if (!descriptor.materialOverrides
                        || typeof descriptor.materialOverrides !== 'object'
                        || Array.isArray(descriptor.materialOverrides)) {
                        throw new TypeError('materialOverrides は object である必要があります');
                    }
                    for (const [materialName, override] of Object.entries(descriptor.materialOverrides)) {
                        if (!materialName
                            || !override
                            || typeof override !== 'object'
                            || Array.isArray(override)
                            || Object.keys(override).some(key => key !== 'texture')
                            || typeof (override as { texture?: unknown }).texture !== 'string'
                            || !(override as { texture: string }).texture) {
                            throw new TypeError('materialOverrides は material 名ごとに texture 相対パスを指定してください');
                        }
                        const typedOverride = override as { texture: string };
                        typedOverride.texture = await resolveAsset(
                            typedOverride.texture,
                            `materialOverrides.${materialName}.texture`
                        );
                    }
                }
                declaration.textContent = JSON.stringify(descriptor).replace(/</g, '\\u003c');
            } catch (error) {
                declaration.textContent = JSON.stringify({ model: '' });
                console.warn('[akari-preview] failed to resolve declarative 3D scene asset', error);
            }
        }
        return document.body.innerHTML;
    }

    protected async loadPreviewCaptions(captionsUri: URI | undefined): Promise<PreviewCaption[]> {
        if (!captionsUri) {
            return [];
        }
        try {
            return parsePreviewCaptions(await this.readText(captionsUri));
        } catch (error) {
            if (await this.fileService.exists(captionsUri)) {
                console.warn(`[akari-preview] failed to load ${captionsUri.toString()}; hiding captions`, error);
            }
            return [];
        }
    }

    protected async findEditJson(videoUri: URI): Promise<URI | undefined> {
        const adjacent = videoUri.parent.resolve('edit.json');
        if (await this.fileService.exists(adjacent)) {
            return adjacent;
        }

        for (const root of await this.workspaceService.roots) {
            const candidates = await this.findNamedFiles(root.resource, 'edit.json');
            for (const candidate of candidates) {
                try {
                    const parsed = JSON.parse(await this.readText(candidate));
                    if (typeof parsed?.source?.path === 'string'
                        && this.pathBase(parsed.source.path) === videoUri.path.base) {
                        return candidate;
                    }
                } catch {
                    // Invalid candidates do not prevent later edit.json files from matching.
                }
            }
        }
        return undefined;
    }

    protected async findNamedFiles(directory: URI, name: string): Promise<URI[]> {
        const found: URI[] = [];
        const visit = async (uri: URI): Promise<void> => {
            let stat: FileStat;
            try {
                stat = await this.fileService.resolve(uri);
            } catch {
                return;
            }
            if (stat.isFile) {
                if (stat.resource.path.base === name) {
                    found.push(stat.resource);
                }
                return;
            }
            const children = [...(stat.children ?? [])]
                .filter(child => !SKIPPED_DIRECTORIES.has(child.resource.path.base))
                .sort((left, right) => left.resource.toString().localeCompare(right.resource.toString()));
            for (const child of children) {
                await visit(child.resource);
            }
        };
        await visit(directory);
        return found;
    }

    protected async handleOverlayWrite(widget: PreviewWidgetMarker, request: OverlayWriteRequest): Promise<void> {
        const editUri = widget.akariPreviewEditUri;
        if (!editUri) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: '編集中の edit.json がありません'
            });
            return;
        }
        try {
            const edit = JSON.parse(await this.readText(editUri));
            if (!Array.isArray(edit?.overlays)) {
                throw new Error('edit.json の overlays が配列ではありません');
            }
            const overlay = edit.overlays.find((value: any) => String(value?.id) === request.overlayId);
            if (!overlay) {
                throw new Error(`オーバーレイが見つかりません: ${request.overlayId}`);
            }
            if (request.patch.vars) {
                overlay.vars = { ...this.objectRecord(overlay.vars), ...request.patch.vars };
            }
            if (request.patch.transform) {
                overlay.transform = { ...this.objectRecord(overlay.transform), ...request.patch.transform };
            }
            this.recentWrites.set(editUri.toString(), Date.now());
            await this.fileService.writeFile(
                editUri,
                BinaryBuffer.fromString(`${JSON.stringify(edit, undefined, 2)}\n`)
            );
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: true
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-overlay-write-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isOverlayWriteRequest(message: any): message is OverlayWriteRequest {
        return message?.type === 'akari-preview-overlay-write'
            && typeof message.requestId === 'string'
            && typeof message.overlayId === 'string'
            && message.patch
            && typeof message.patch === 'object';
    }

    protected async handleWaveformFetch(widget: PreviewWidgetMarker, request: WaveformFetchRequest): Promise<void> {
        try {
            const videoUri = widget.akariPreviewVideoUri;
            if (!videoUri) {
                throw new Error('波形を生成する動画がありません');
            }
            const content = await this.fileService.readFile(videoUri);
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: true,
                dataBase64: this.toBase64(content.value.buffer)
            });
        } catch (error) {
            widget.sendMessage({
                type: 'akari-preview-waveform-fetch-response',
                requestId: request.requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected isWaveformFetchRequest(message: any): message is WaveformFetchRequest {
        return message?.type === 'akari-preview-waveform-fetch'
            && typeof message.requestId === 'string';
    }

    protected isOpenOutputRequest(message: any): message is OpenOutputRequest {
        return message?.type === 'akari-preview-open-output-request';
    }

    protected async handleOpenOutputRequest(widget: PreviewWidgetMarker): Promise<void> {
        const editUri = widget.akariPreviewRelatedEditUri;
        if (!editUri) {
            return;
        }
        try {
            const output = await this.getOrOpenPreview(editUri.normalizePath(), { area: 'main' }, 'output');
            this.attachTimelinePassively();
            await this.shell.activateWidget(output.id);
        } catch (error) {
            this.reportOpenFailure(editUri, error);
        }
    }

    protected prepareHtml(
        videoUri: URI,
        videoSource: string,
        model: PreviewModel,
        assets: OverlayRuntimeAssets,
        initialSeekTime?: number
    ): string {
        const { width, height } = model.summary.output;
        const captionFontSize = Math.round(height * 0.05);
        const initialState = this.safeJson({
            summary: model.summary,
            captions: model.captions,
            editPath: model.editUri?.toString() ?? null,
            relatedEditUri: model.relatedEditUri?.toString() ?? null,
            videoUri: videoUri.toString(),
            initialSeekTime: Number.isFinite(initialSeekTime) ? initialSeekTime : null,
            muted: model.session?.muted ?? false,
            captionsVisible: model.session?.captionsVisible ?? true,
            hiddenTracks: model.session?.hiddenTracks ?? []
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(this.streamOrigin(videoSource))}; connect-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob:; img-src ${this.escapeHtml(this.streamOrigin(videoSource))} blob: data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
${this.inlineStyle(assets.interactionCss)}
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #141414; color: #eee; }
body { display: grid; grid-template-rows: minmax(0, 1fr) auto; }
.workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); }
.workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 260px; }
.preview-pane { min-width: 0; min-height: 0; padding: 16px; display: grid; place-items: center; background: #090909; }
#preview-wrapper { position: relative; width: 100%; max-height: 100%; aspect-ratio: ${width} / ${height}; overflow: hidden; background: #000; }
#preview-wrapper.is-draggable { cursor: grab; touch-action: none; }
#preview-wrapper.is-dragging { cursor: grabbing; }
#zoom-layer { position: absolute; inset: 0; will-change: transform; }
#preview-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
#preview-layers { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: visible; pointer-events: none; }
#preview-layers > video { position: absolute; display: none; max-width: none; max-height: none; transform-origin: 50% 50%; pointer-events: none; }
#overlay-stage { position: absolute; top: 0; left: 0; z-index: 1; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: visible; }
#transition-plate { position: absolute; inset: 0; z-index: 2147483646; opacity: 0; pointer-events: none; }
#caption-plate { position: absolute; left: 50%; bottom: 7%; z-index: 2147483647; max-width: 88%; transform: translateX(-50%); padding: 0.35em 0.7em; border-radius: 0.18em; background: rgba(0, 0, 0, 0.78); color: #fff; font-size: ${captionFontSize}px; font-weight: 700; line-height: 1.45; text-align: center; text-shadow: 0 1px 2px #000; white-space: pre-wrap; pointer-events: none; user-select: none; }
#caption-plate:empty { display: none; }
#caption-plate.akari-caption-host--styled { inset: 0; max-width: none; transform: none; padding: 0; border-radius: 0; background: none; text-shadow: none; white-space: normal; --caption-font-size: ${captionFontSize}px; }
#preview-indicators { position: absolute; left: 8px; bottom: 8px; z-index: 4; max-width: calc(100% - 16px); padding: 5px 9px; border: 1px solid rgba(255,255,255,0.2); border-radius: 999px; background: rgba(20,20,20,0.78); color: #ddd; font-size: 11px; line-height: 1.35; pointer-events: none; }
#preview-indicators[hidden] { display: none; }
.output-preview-link { position: absolute; top: 8px; left: 8px; z-index: 5; border: 1px solid rgba(255,255,255,0.2); border-radius: 5px; padding: 5px 9px; background: rgba(20,20,20,0.78); color: #d8e9ff; font-size: 11px; line-height: 1.35; cursor: pointer; }
.output-preview-link:hover { color: #fff; background: rgba(45,45,45,0.9); }
.output-preview-link[hidden] { display: none; }
#zoom-minimap { position: absolute; right: 8px; bottom: 8px; z-index: 3; overflow: hidden; border: 1px solid rgba(255,255,255,0.25); border-radius: 2px; background: rgba(0,0,0,0.55); pointer-events: none; }
#zoom-minimap[hidden] { display: none; }
#zoom-minimap-viewport { position: absolute; box-sizing: border-box; border: 1px solid rgba(255,255,255,0.85); background: rgba(255,255,255,0.55); }
.message-card { position: absolute; inset: 0; z-index: 10; display: grid; gap: 16px; place-items: center; padding: 32px; background: #111; }
.message-card[hidden] { display: none; }
.message-card p { max-width: 520px; margin: 0; color: #e5e5e5; font-size: 15px; line-height: 1.7; text-align: center; }
.message-card-reload { border: 1px solid #505050; border-radius: 4px; padding: 8px 18px; background: #303030; color: #fff; font-size: 13px; cursor: pointer; }
.message-card-reload[hidden] { display: none; }
.audio-notice { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); z-index: 4; display: flex; align-items: center; gap: 10px; max-width: 92%; padding: 8px 12px; border-radius: 6px; background: rgba(20, 20, 20, 0.78); color: #f1f1f1; font-size: 12.5px; line-height: 1.5; }
.audio-notice[hidden] { display: none; }
.audio-notice button { flex: none; border: none; background: transparent; color: #ccc; font-size: 14px; line-height: 1; cursor: pointer; padding: 2px 4px; }
#inspector { padding: 16px; border-left: 1px solid #303030; background: #1b1b1b; overflow: auto; }
#inspector[hidden] { display: none; }
#inspector h2 { margin: 0 0 14px; font-size: 14px; }
.field { display: grid; gap: 6px; margin-bottom: 12px; }
.field label { overflow-wrap: anywhere; color: #c8c8c8; font-size: 12px; }
.field input { width: 100%; border: 1px solid #4a4a4a; border-radius: 4px; padding: 7px 8px; background: #111; color: #fff; }
.empty { color: #999; font-size: 12px; }
.transport { display: grid; gap: 8px; padding: 9px 14px 10px; border-top: 1px solid #303030; background: #202020; }
.transport-waveform { position: relative; width: 100%; height: 56px; overflow: hidden; border-top: 1px solid #303030; background: #181818; cursor: pointer; touch-action: none; }
.transport-waveform[hidden] { display: none; }
#waveform-canvas { position: absolute; inset: 0; display: block; width: 100%; height: 100%; }
.transport-waveform-playhead { position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: rgba(255, 255, 255, 0.9); pointer-events: none; }
.transport-seek { display: flex; width: 100%; }
.transport-seek input { width: 100%; }
.transport-controls { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-width: 0; }
.transport-left, .transport-center, .transport-right { display: flex; align-items: center; gap: 8px; }
.transport-left { min-width: 0; justify-self: start; }
.transport-center { justify-self: center; }
.transport-right { position: relative; justify-self: end; }
.icon-button { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; cursor: pointer; }
.icon-button:disabled, .zoom-preset:disabled { opacity: 0.45; cursor: default; }
.icon-button svg { width: 18px; height: 18px; fill: currentColor; stroke: currentColor; }
#time-label { min-width: 104px; color: #d0d0d0; font-variant-numeric: tabular-nums; text-align: left; }
.zoom-popup { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 20; width: 224px; border: 1px solid #505050; border-radius: 6px; padding: 10px; background: #202020; box-shadow: 0 4px 16px rgba(0,0,0,0.45); }
.zoom-popup[hidden] { display: none; }
.zoom-popup-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; color: #d8d8d8; font-size: 12px; }
#zoom-value { color: #fff; font-variant-numeric: tabular-nums; }
#zoom-slider { width: 100%; }
.zoom-presets { display: grid; grid-template-columns: repeat(4, 32px); justify-content: space-between; gap: 5px; margin-top: 8px; }
.zoom-preset { width: 32px; height: 32px; border: 1px solid #505050; border-radius: 4px; padding: 0; background: #303030; color: #fff; font-size: 10px; cursor: pointer; }
@media (max-width: 720px) { .workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 210px; } }
</style>
</head>
<body>
<main class="workspace">
  <section class="preview-pane" aria-label="動画プレビュー">
    <div id="preview-wrapper">
      <div id="zoom-layer">
        <video id="preview-video" src="${this.escapeHtml(videoSource)}" preload="metadata"></video>
        <div id="preview-layers"></div>
        <div id="overlay-stage"><div id="transition-plate"></div><div id="caption-plate"></div></div>
      </div>
      <div id="zoom-minimap" hidden aria-hidden="true"><div id="zoom-minimap-viewport"></div></div>
      <div id="preview-indicators" hidden></div>
      <button id="output-preview-link" class="output-preview-link" type="button"${model.relatedEditUri ? '' : ' hidden'}>合成は出力プレビューで確認（開く）</button>
      <div id="audio-notice" class="audio-notice" hidden role="status">
        <span>音声が検出されていません。無音の素材か、音声形式がプレビュー非対応の可能性があります（書き出しには影響しません）。</span>
        <button id="audio-notice-dismiss" type="button" aria-label="閉じる" title="閉じる">×</button>
      </div>
      <div id="preview-message" class="message-card" hidden role="status">
        <p id="preview-message-text">${UNSUPPORTED_FORMAT_MESSAGE}</p>
        <button id="preview-message-reload" class="message-card-reload" type="button" hidden>再読み込み</button>
      </div>
    </div>
  </section>
  <aside id="inspector" hidden aria-label="オーバーレイインスペクタ">
    <h2 id="inspector-title">オーバーレイ</h2>
    <div id="inspector-fields"></div>
  </aside>
</main>
<div class="transport">
  <div class="transport-waveform" hidden>
    <canvas id="waveform-canvas" aria-label="音声波形"></canvas>
    <div class="transport-waveform-playhead" aria-hidden="true"></div>
  </div>
  <div class="transport-seek">
    <input id="seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置">
  </div>
  <div class="transport-controls">
    <div class="transport-left">
      <button id="waveform-toggle" class="icon-button" type="button" aria-label="波形" title="波形" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h2m2-4v8m3-12v16m3-13v10m3-7v4m3-2h2" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <span id="time-label">0:00 / 0:00</span>
    </div>
    <div class="transport-center">
      <button id="skip-back" class="icon-button" type="button" aria-label="10秒戻る" title="10秒戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5V2L6.5 6 11 10V7a6 6 0 1 1-5.65 8H3.26A8 8 0 1 0 11 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
      <button id="frame-back" class="icon-button" type="button" aria-label="1コマ戻る" title="1コマ戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14l-9-7z"/></svg></button>
      <button id="play-toggle" class="icon-button" type="button" aria-label="再生" title="再生"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></button>
      <button id="frame-forward" class="icon-button" type="button" aria-label="1コマ進む" title="1コマ進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5v14l9-7z"/></svg></button>
      <button id="skip-forward" class="icon-button" type="button" aria-label="10秒進む" title="10秒進む"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 5V2l4.5 4-4.5 4V7a6 6 0 1 0 5.65 8h2.09A8 8 0 1 1 13 5Z"/><text x="8" y="17" fill="currentColor" stroke="none" font-size="7" font-family="system-ui,sans-serif" font-weight="700">10</text></svg></button>
    </div>
    <div class="transport-right">
      <button id="zoom-toggle" class="icon-button" type="button" aria-label="ズーム" title="ズーム" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke-width="2"/><path d="m15.5 15.5 5 5" fill="none" stroke-width="2" stroke-linecap="round"/></svg></button>
      <button id="fullscreen-toggle" class="icon-button" type="button" aria-label="全画面" title="全画面" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"/></svg></button>
      <div id="zoom-popup" class="zoom-popup" hidden>
        <div class="zoom-popup-header"><span>ズーム</span><span id="zoom-value">100%</span></div>
        <input id="zoom-slider" type="range" min="0" max="1" step="0.001" aria-label="ズーム倍率" title="ダブルクリックで100%">
        <div class="zoom-presets">
          <button class="zoom-preset" type="button" data-zoom="0.5" aria-label="50%にズーム" title="50%にズーム">50%</button>
          <button class="zoom-preset" type="button" data-zoom="1" aria-label="100%にズーム" title="100%にズーム">100%</button>
          <button class="zoom-preset" type="button" data-zoom="2" aria-label="200%にズーム" title="200%にズーム">200%</button>
          <button class="zoom-preset" type="button" data-zoom="4" aria-label="400%にズーム" title="400%にズーム">400%</button>
        </div>
      </div>
    </div>
  </div>
</div>
<script>window.__akariPreview = ${initialState};</script>
<script>${this.hostAdapterScript()}</script>
<script>${this.inlineScript(assets.threeJavaScript)}</script>
<script>${this.inlineScript(assets.threeRuntimeJavaScript)}</script>
<script>${this.inlineScript(assets.runtimeJavaScript)}</script>
<script>${this.inlineScript(assets.interactionJavaScript)}</script>
<script>${this.previewBootstrapScript()}</script>
</body>
</html>`;
    }

    protected prepareMessageHtml(message: string): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { display: grid; place-items: center; padding: 32px; }
.message-card { width: min(100%, 560px); border: 1px solid #353535; border-radius: 8px; padding: 28px; background: #1b1b1b; }
.message-card p { margin: 0; font-size: 15px; line-height: 1.7; text-align: center; }
</style>
</head>
<body>
<main class="message-card" role="status"><p>${this.escapeHtml(message)}</p></main>
</body>
</html>`;
    }

    protected hostAdapterScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const vscode = acquireVsCodeApi();
            const pending = new Map();
            let sequence = 0;
            let displayScale = 1;
            let lastPlaybackTickAt = -Infinity;
            const wrapper = document.getElementById('preview-wrapper');
            const outputPreviewLink = document.getElementById('output-preview-link');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const output = initial.summary.output;

            window.akari = window.akari || {};
            window.akari.state = { editPath: initial.editPath, summary: initial.summary };
            window.akari.engine = {
                overlayWrite: (_editPath, overlayId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { kind: 'overlay-write', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write', requestId, overlayId, patch });
                }),
                readWaveformBytes: () => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-waveform-' + (++sequence);
                    pending.set(requestId, { kind: 'waveform-fetch', resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-waveform-fetch', requestId });
                })
            };
            const createPreviewAudio = () => {
                const config = initial.summary && initial.summary.audio;
                const hasAudio = config && (config.bgm
                    || (Array.isArray(config.sfx) && config.sfx.length > 0)
                    || (Array.isArray(config.narration) && config.narration.length > 0));
                if (!hasAudio) return null;

                const video = document.getElementById('preview-video');
                let context;
                try {
                    context = new AudioContext();
                } catch (error) {
                    console.warn('[akari-preview] audio graph unavailable; continuing with video only', error);
                    return null;
                }
                const masterGain = context.createGain();
                masterGain.connect(context.destination);
                const decoded = { bgm: null, sfx: [], narration: [] };
                let timelineDuration = 0;
                let loadPromise = null;
                let generation = 0;
                let active = [];
                let bgmGain = null;
                let lastDuckGainDb = null;

                const dbToLinear = gainDb => Math.pow(10, gainDb / 20);
                const syncMasterGain = () => {
                    const volume = Number.isFinite(video.volume) ? Math.max(0, Math.min(1, video.volume)) : 1;
                    masterGain.gain.value = video.muted ? 0 : volume;
                };
                const warnUnavailable = (kind, id, error) => {
                    console.warn('[akari-preview] ' + kind + ' ' + id
                        + ' unavailable (fetch/decode failed); skipping element', error);
                };
                const decodeOne = async (kind, spec) => {
                    try {
                        const response = await fetch(spec.src);
                        if (!response.ok) throw new Error('fetch status=' + response.status);
                        const buffer = await context.decodeAudioData(await response.arrayBuffer());
                        if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
                            throw new Error('decoded audio duration is invalid');
                        }
                        return { ...spec, buffer, durationSec: buffer.duration };
                    } catch (error) {
                        if (context.state !== 'closed') {
                            warnUnavailable(kind, spec.id || kind, error);
                        }
                        return null;
                    }
                };
                const load = duration => {
                    if (Number.isFinite(duration) && duration > 0) timelineDuration = duration;
                    if (loadPromise || timelineDuration <= 0) return loadPromise || Promise.resolve();
                    loadPromise = (async () => {
                        const timed = async (kind, specs) => {
                            const valid = [];
                            for (const spec of Array.isArray(specs) ? specs : []) {
                                if (!Number.isFinite(spec.t) || spec.t < 0 || spec.t >= timelineDuration) {
                                    console.warn('[akari-preview] ' + kind + ' ' + spec.id
                                        + ' skipped: t is outside timeline duration');
                                    continue;
                                }
                                valid.push(spec);
                            }
                            return (await Promise.all(valid.map(spec => decodeOne(kind, spec)))).filter(Boolean);
                        };
                        const [bgm, sfx, narration] = await Promise.all([
                            config.bgm ? decodeOne('bgm', { ...config.bgm, id: 'bgm' }) : Promise.resolve(null),
                            timed('sfx', config.sfx),
                            timed('narration', config.narration)
                        ]);
                        decoded.bgm = bgm;
                        decoded.sfx = sfx;
                        decoded.narration = narration;
                        if (context.state !== 'closed') {
                            console.info('[akari-preview] audio graph ready', {
                                contextState: context.state,
                                timelineDuration,
                                decoded: {
                                    bgm: Boolean(decoded.bgm),
                                    sfx: decoded.sfx.map(item => item.id),
                                    narration: decoded.narration.map(item => item.id)
                                }
                            });
                        }
                    })();
                    return loadPromise;
                };
                const detachActive = item => {
                    active = active.filter(candidate => candidate !== item);
                    try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                    try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                };
                const stopSources = () => {
                    const sources = active;
                    active = [];
                    bgmGain = null;
                    lastDuckGainDb = null;
                    for (const item of sources) {
                        item.source.onended = null;
                        try { item.source.stop(); } catch (_error) { /* already stopped */ }
                        try { item.source.disconnect(); } catch (_error) { /* already detached */ }
                        try { item.gain.disconnect(); } catch (_error) { /* already detached */ }
                    }
                };
                const registerSource = (source, gain, kind, id) => {
                    const item = { source, gain, kind, id };
                    active.push(item);
                    source.onended = () => detachActive(item);
                    return item;
                };
                const duckGainDbAt = timelineTime => {
                    if (!decoded.bgm || decoded.bgm.ducking !== true) return 0;
                    return decoded.narration.some(item => timelineTime >= item.t
                        && timelineTime < item.t + item.durationSec) ? -12 : 0;
                };
                const fadeMultiplierAt = timelineTime => {
                    if (!decoded.bgm) return 1;
                    const total = timelineDuration;
                    const rawIn = decoded.bgm.fadeIn;
                    const rawOut = decoded.bgm.fadeOut;
                    const fadeIn = Number.isFinite(rawIn) && rawIn > 0 ? Math.min(rawIn, total / 2) : 0;
                    const fadeOut = Number.isFinite(rawOut) && rawOut > 0 ? Math.min(rawOut, total / 2) : 0;
                    let multiplier = 1;
                    if (fadeIn > 0 && timelineTime < fadeIn) multiplier = Math.min(multiplier, timelineTime / fadeIn);
                    if (fadeOut > 0 && timelineTime > total - fadeOut) {
                        multiplier = Math.min(multiplier, (total - timelineTime) / fadeOut);
                    }
                    return Math.max(0, Math.min(1, multiplier));
                };
                const applyBgmDuck = timelineTime => {
                    if (!decoded.bgm) return;
                    const duckGainDb = duckGainDbAt(timelineTime);
                    const fadeMultiplier = fadeMultiplierAt(timelineTime);
                    if (bgmGain) {
                        bgmGain.gain.value = dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier;
                    }
                    if (duckGainDb !== lastDuckGainDb) {
                        lastDuckGainDb = duckGainDb;
                        console.info('[akari-preview] bgm duck gain', {
                            timelineTime,
                            baseGainDb: decoded.bgm ? decoded.bgm.gainDb : null,
                            duckGainDb,
                            appliedGainDb: decoded.bgm ? decoded.bgm.gainDb + duckGainDb : null,
                            fadeMultiplier,
                            appliedLinear: decoded.bgm
                                ? dbToLinear(decoded.bgm.gainDb + duckGainDb) * fadeMultiplier
                                : null
                        });
                    }
                };
                const scheduleFrom = async timelineTime => {
                    const scheduleGeneration = ++generation;
                    stopSources();
                    await load(timelineDuration);
                    if (scheduleGeneration !== generation || video.paused || timelineDuration <= 0) return;
                    const startAt = Math.max(0, Math.min(timelineDuration, timelineTime));
                    const contextStart = context.currentTime + 0.015;
                    const remaining = timelineDuration - startAt;
                    let scheduledBgm = false;
                    let scheduledSfx = 0;
                    let scheduledNarration = 0;
                    if (decoded.bgm && remaining > 0) {
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            source.buffer = decoded.bgm.buffer;
                            source.loop = true;
                            source.connect(gain);
                            gain.connect(masterGain);
                            bgmGain = gain;
                            applyBgmDuck(startAt);
                            registerSource(source, gain, 'bgm', 'bgm');
                            source.start(contextStart, startAt % decoded.bgm.durationSec);
                            source.stop(contextStart + remaining);
                            scheduledBgm = true;
                        } catch (error) {
                            warnUnavailable('bgm', 'bgm', error);
                            bgmGain = null;
                        }
                    }
                    const scheduleTimed = (kind, item) => {
                        const end = item.t + item.durationSec;
                        if (end <= startAt || item.t >= timelineDuration) return false;
                        const delay = Math.max(0, item.t - startAt);
                        const offset = Math.max(0, startAt - item.t);
                        const available = Math.min(item.durationSec - offset, remaining - delay);
                        if (available <= 0) return false;
                        try {
                            const source = context.createBufferSource();
                            const gain = context.createGain();
                            source.buffer = item.buffer;
                            gain.gain.value = dbToLinear(item.gainDb);
                            source.connect(gain);
                            gain.connect(masterGain);
                            registerSource(source, gain, kind, item.id);
                            source.start(contextStart + delay, offset, available);
                            return true;
                        } catch (error) {
                            warnUnavailable(kind, item.id, error);
                            return false;
                        }
                    };
                    for (const item of decoded.sfx) {
                        if (scheduleTimed('sfx', item)) scheduledSfx += 1;
                    }
                    for (const item of decoded.narration) {
                        if (scheduleTimed('narration', item)) scheduledNarration += 1;
                    }
                    console.info('[akari-preview] audio scheduled', {
                        timelineTime: startAt,
                        bgm: scheduledBgm,
                        sfx: scheduledSfx,
                        narration: scheduledNarration
                    });
                };
                const controller = {
                    setTimelineDuration: duration => load(duration),
                    resume: () => context.resume().catch(error => {
                        console.warn('[akari-preview] AudioContext resume failed; continuing with video only', error);
                    }),
                    playFrom: timelineTime => controller.resume().then(() => scheduleFrom(timelineTime)),
                    pause: () => {
                        generation += 1;
                        stopSources();
                    },
                    tick: (timelineTime, playing) => {
                        syncMasterGain();
                        if (playing) applyBgmDuck(timelineTime);
                    },
                    debugState: () => ({
                        contextState: context.state,
                        timelineDuration,
                        decoded: {
                            bgm: Boolean(decoded.bgm),
                            sfx: decoded.sfx.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec })),
                            narration: decoded.narration.map(item => ({ id: item.id, t: item.t, durationSec: item.durationSec }))
                        },
                        active: {
                            bgm: active.filter(item => item.kind === 'bgm').length,
                            sfx: active.filter(item => item.kind === 'sfx').length,
                            narration: active.filter(item => item.kind === 'narration').length
                        },
                        masterGainLinear: masterGain.gain.value,
                        bgmGainLinear: bgmGain ? bgmGain.gain.value : null,
                        duckGainDb: lastDuckGainDb
                    })
                };
                syncMasterGain();
                video.addEventListener('volumechange', syncMasterGain);
                window.addEventListener('pagehide', () => {
                    controller.pause();
                    void context.close().catch(() => undefined);
                }, { once: true });
                return controller;
            };
            window.akari.previewAudio = createPreviewAudio();
            window.akari.previewAudioDebug = () => window.akari.previewAudio
                ? window.akari.previewAudio.debugState()
                : { disabled: true };
            window.akari.stageScale = () => displayScale;
            window.akari.playbackTick = (time, playing, immediate = false) => {
                const now = performance.now();
                if (!immediate && now - lastPlaybackTickAt < 50) return;
                lastPlaybackTickAt = now;
                vscode.postMessage({ type: 'akari-preview-playback-tick', time, playing });
            };
            window.akari.reportOverlaySelection = overlayId => {
                vscode.postMessage({ type: 'akari-preview-overlay-selected', overlayId });
            };
            if (outputPreviewLink && initial.relatedEditUri) {
                outputPreviewLink.addEventListener('click', () => {
                    vscode.postMessage({ type: 'akari-preview-open-output-request' });
                });
            }
            window.akari.toggleFullscreen = () => {
                if (document.fullscreenElement) {
                    return document.exitFullscreen();
                }
                try {
                    return Promise.resolve(document.documentElement.requestFullscreen()).catch(() => {
                        vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    });
                } catch (_error) {
                    vscode.postMessage({ type: 'akari-preview-fullscreen-fallback' });
                    return Promise.resolve();
                }
            };

            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || (message.type !== 'akari-preview-overlay-write-response'
                    && message.type !== 'akari-preview-waveform-fetch-response')) return;
                const request = pending.get(message.requestId);
                if (!request) return;
                const expectedType = request.kind === 'waveform-fetch'
                    ? 'akari-preview-waveform-fetch-response'
                    : 'akari-preview-overlay-write-response';
                if (message.type !== expectedType) return;
                pending.delete(message.requestId);
                if (!message.ok) {
                    const fallback = request.kind === 'waveform-fetch'
                        ? '動画データの読み込みに失敗しました'
                        : 'edit.json の書き込みに失敗しました';
                    request.reject(new Error(message.error || fallback));
                    return;
                }
                if (request.kind !== 'waveform-fetch') {
                    request.resolve(undefined);
                    return;
                }
                try {
                    const binary = atob(String(message.dataBase64 || ''));
                    const bytes = new Uint8Array(binary.length);
                    for (let index = 0; index < binary.length; index += 1) {
                        bytes[index] = binary.charCodeAt(index);
                    }
                    request.resolve(bytes.buffer);
                } catch (error) {
                    request.reject(error);
                }
            });

            const updateStageScale = () => {
                const next = wrapper.clientWidth / Number(output.width || 1280);
                displayScale = Number.isFinite(next) && next > 0 ? next : 1;
                layersStage.style.transform = 'scale(' + displayScale + ')';
                stage.style.transform = 'scale(' + displayScale + ')';
            };
            new ResizeObserver(updateStageScale).observe(wrapper);
            updateStageScale();
        })();`;
    }

    protected previewBootstrapScript(): string {
        return `(() => {
            const initial = window.__akariPreview;
            const summary = initial.summary;
            const video = document.getElementById('preview-video');
            const playToggle = document.getElementById('play-toggle');
            const frameBack = document.getElementById('frame-back');
            const frameForward = document.getElementById('frame-forward');
            const skipBack = document.getElementById('skip-back');
            const skipForward = document.getElementById('skip-forward');
            const waveformToggle = document.getElementById('waveform-toggle');
            const waveformRow = document.querySelector('.transport-waveform');
            const waveformCanvas = document.getElementById('waveform-canvas');
            const waveformPlayhead = document.querySelector('.transport-waveform-playhead');
            const zoomToggle = document.getElementById('zoom-toggle');
            const fullscreenToggle = document.getElementById('fullscreen-toggle');
            const seek = document.getElementById('seek');
            const timeLabel = document.getElementById('time-label');
            const previewPane = document.querySelector('.preview-pane');
            const wrapper = document.getElementById('preview-wrapper');
            const zoomLayer = document.getElementById('zoom-layer');
            const zoomPopup = document.getElementById('zoom-popup');
            const zoomSlider = document.getElementById('zoom-slider');
            const zoomValue = document.getElementById('zoom-value');
            const zoomMinimap = document.getElementById('zoom-minimap');
            const zoomMinimapViewport = document.getElementById('zoom-minimap-viewport');
            const layersStage = document.getElementById('preview-layers');
            const stage = document.getElementById('overlay-stage');
            const transitionPlate = document.getElementById('transition-plate');
            const captionPlate = document.getElementById('caption-plate');
            const previewIndicators = document.getElementById('preview-indicators');
            const previewMessage = document.getElementById('preview-message');
            const previewMessageText = document.getElementById('preview-message-text');
            const previewMessageReload = document.getElementById('preview-message-reload');
            const audioNotice = document.getElementById('audio-notice');
            const audioNoticeDismiss = document.getElementById('audio-notice-dismiss');
            const inspector = document.getElementById('inspector');
            const inspectorTitle = document.getElementById('inspector-title');
            const inspectorFields = document.getElementById('inspector-fields');
            const workspace = document.querySelector('.workspace');
            const fps = Number(summary.output && summary.output.fps) > 0 ? Number(summary.output.fps) : 30;
            const ZOOM_MIN = 0.25;
            const ZOOM_MAX = 8;
            const SNAP_TOLERANCE = 0.025;
            const CLICK_THRESHOLD_PX = 4;
            const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
            const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"></path></svg>';
            const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"></path></svg>';
            const restoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm16 0v2h-3v3h-2v-5z"></path></svg>';
            let captions = Array.isArray(initial.captions) ? initial.captions : [];
            let hiddenTracks = new Set(Array.isArray(initial.hiddenTracks) ? initial.hiddenTracks : []);
            video.muted = initial.muted === true;
            captionPlate.style.visibility = initial.captionsVisible === false ? 'hidden' : 'visible';
            let animationFrame = 0;
            let keepRanges = [];
            let timelineOffsets = [];
            let transitionPlates = [];
            let totalTimelineDuration = 0;
            let currentSegmentIndex = 0;
            let keepRangesReady = false;
            let zoom = 1;
            let pan = { x: 0, y: 0 };
            let drag = null;
            let suppressClick = false;
            let waveformState = 'idle';
            let waveformAudioBuffer = null;
            let waveformPeaks = null;
            let waveformResizeTimer = 0;
            let waveformDragPointer = null;
            let playbackErrored = false;
            let audioNoticeShown = false;
            let activeCaption = null;
            let styledCaptionActive = false;

            const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
            const centeredOffset = value => value >= 0
                ? 'calc(50% + ' + value + 'px)'
                : 'calc(50% - ' + Math.abs(value) + 'px)';
            const layerEntries = (Array.isArray(summary.layers) ? summary.layers : []).map((layer, index) => {
                const layerVideo = document.createElement('video');
                layerVideo.muted = true;
                layerVideo.playsInline = true;
                layerVideo.preload = 'auto';
                layerVideo.tabIndex = -1;
                layerVideo.disablePictureInPicture = true;
                layerVideo.dataset.akariLayerId = String(layer.id);
                layerVideo.dataset.akariLayerIndex = String(index);
                layerVideo.dataset.akariLayerKind = String(layer.kind);
                layerVideo.style.opacity = String(layer.opacity);
                layerVideo.style.mixBlendMode = layer.blend || 'normal';
                const transform = layer.transform || {};
                const x = Number.isFinite(transform.x) ? transform.x : 0;
                const y = Number.isFinite(transform.y) ? transform.y : 0;
                const scale = Number.isFinite(transform.scale) && transform.scale > 0 ? transform.scale : 1;
                const rotate = Number.isFinite(transform.rotate) ? transform.rotate : 0;
                const position = () => {
                    if (!(layerVideo.videoWidth > 0) || !(layerVideo.videoHeight > 0)) return;
                    layerVideo.style.width = (layerVideo.videoWidth * scale) + 'px';
                    layerVideo.style.height = (layerVideo.videoHeight * scale) + 'px';
                    layerVideo.style.left = centeredOffset(x);
                    layerVideo.style.top = centeredOffset(y);
                    layerVideo.style.transform = 'translate(-50%, -50%) rotate(' + rotate + 'deg)';
                };
                layerVideo.addEventListener('loadedmetadata', () => {
                    position();
                    tick(true);
                });
                layerVideo.addEventListener('error', () => {
                    layerVideo.style.display = 'none';
                    console.warn('[akari-preview] layer media failed to load', layer.id);
                });
                if (typeof layer.src === 'string' && layer.src) {
                    layerVideo.src = layer.src;
                }
                layersStage.appendChild(layerVideo);
                return { spec: layer, video: layerVideo };
            });
            const applyTrackVisibility = track => {
                for (const container of stage.querySelectorAll('[data-akari-track]')) {
                    if (Number(container.getAttribute('data-akari-track')) === track) {
                        container.style.display = hiddenTracks.has(track) ? 'none' : '';
                    }
                }
            };
            const applyOverlayTracks = () => {
                for (const container of stage.querySelectorAll('[data-overlay-id]')) {
                    const id = container.getAttribute('data-overlay-id') || '';
                    const overlay = summary.overlays.find(candidate => String(candidate.id) === id);
                    const track = Number.isInteger(overlay?.track) && overlay.track >= 0 ? overlay.track : 0;
                    container.setAttribute('data-akari-track', String(track));
                    container.style.zIndex = String(10 + track);
                    container.style.display = hiddenTracks.has(track) ? 'none' : '';
                }
            };
            const buildExplicitKeepRanges = () => {
                const rawCuts = Array.isArray(summary.cuts) ? summary.cuts : [];
                const valid = [];
                for (let index = 0; index < rawCuts.length; index += 1) {
                    const candidate = rawCuts[index];
                    const start = Number(candidate && candidate.in);
                    const end = Number(candidate && candidate.out);
                    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                        const speed = Number.isFinite(candidate.speed) && candidate.speed > 0 ? candidate.speed : 1;
                        const transition = candidate.transitionOut;
                        const transitionOut = index < rawCuts.length - 1
                            && transition
                            && (transition.type === 'dissolve'
                                || transition.type === 'fade-black'
                                || transition.type === 'fade-white')
                            && Number.isFinite(transition.duration)
                            && transition.duration > 0
                            ? { type: transition.type, duration: transition.duration }
                            : null;
                        valid.push({ in: start, out: end, speed, transitionOut });
                    }
                }
                return valid;
            };
            const syncPlaybackRate = () => {
                const range = keepRangesReady ? keepRanges[currentSegmentIndex] : null;
                const speed = range && Number.isFinite(range.speed) && range.speed > 0 ? range.speed : 1;
                if (video.playbackRate !== speed) video.playbackRate = speed;
            };
            const rebuildKeepRanges = () => {
                const explicit = buildExplicitKeepRanges();
                if (explicit.length > 0) {
                    keepRanges = explicit;
                } else {
                    const duration = videoDuration();
                    keepRanges = duration > 0 ? [{ in: 0, out: duration, speed: 1, transitionOut: null }] : [];
                }
                timelineOffsets = [];
                transitionPlates = [];
                let accumulated = 0;
                for (let index = 0; index < keepRanges.length; index += 1) {
                    const range = keepRanges[index];
                    timelineOffsets.push(accumulated);
                    const segmentDuration = (range.out - range.in) / range.speed;
                    const naturalJump = accumulated + segmentDuration;
                    accumulated = naturalJump;
                    if (range.transitionOut && index < keepRanges.length - 1) {
                        if (range.transitionOut.type === 'fade-black' || range.transitionOut.type === 'fade-white') {
                            const duration = range.transitionOut.duration;
                            transitionPlates.push({
                                start: naturalJump - duration / 2,
                                end: naturalJump + duration / 2,
                                mid: naturalJump,
                                color: range.transitionOut.type === 'fade-black' ? '#000000' : '#ffffff'
                            });
                        }
                        accumulated -= range.transitionOut.duration;
                    }
                }
                totalTimelineDuration = accumulated;
                keepRangesReady = keepRanges.length > 0;
                if (window.akari.previewAudio && totalTimelineDuration > 0) {
                    void window.akari.previewAudio.setTimelineDuration(totalTimelineDuration);
                }
                if (currentSegmentIndex >= keepRanges.length) {
                    currentSegmentIndex = Math.max(0, keepRanges.length - 1);
                }
                syncPlaybackRate();
            };
            const findSegmentForSource = sourceTime => keepRanges.findIndex(
                range => sourceTime >= range.in && sourceTime < range.out
            );
            const clampSourceTime = (sourceTime, preferredIndex) => {
                const preferred = keepRanges[preferredIndex];
                if (preferred && sourceTime >= preferred.in && sourceTime < preferred.out) {
                    return { index: preferredIndex, time: sourceTime, ended: false };
                }
                const hit = findSegmentForSource(sourceTime);
                if (hit !== -1) {
                    return { index: hit, time: sourceTime, ended: false };
                }
                if (preferred && sourceTime >= preferred.out) {
                    const nextIndex = preferredIndex + 1;
                    if (nextIndex < keepRanges.length) {
                        return { index: nextIndex, time: keepRanges[nextIndex].in, ended: false };
                    }
                    return { index: preferredIndex, time: preferred.out, ended: true };
                }
                if (preferred && sourceTime < preferred.in) {
                    return { index: preferredIndex, time: preferred.in, ended: false };
                }
                let fallback = keepRanges.findIndex(range => range.in >= sourceTime);
                if (fallback === -1) {
                    fallback = keepRanges.length - 1;
                }
                return { index: fallback, time: keepRanges[fallback].in, ended: false };
            };
            const applyKeepRangeBoundary = () => {
                if (!keepRangesReady) return;
                const current = video.currentTime || 0;
                const result = clampSourceTime(current, currentSegmentIndex);
                currentSegmentIndex = result.index;
                syncPlaybackRate();
                if (result.ended) {
                    if (!video.paused) video.pause();
                    if (Math.abs(current - result.time) > 0.0005) video.currentTime = result.time;
                    return;
                }
                if (Math.abs(current - result.time) > 0.0005) {
                    video.currentTime = result.time;
                }
            };
            const sourceToTimeline = (sourceTime, segmentIndex) => {
                if (!keepRangesReady) return sourceTime;
                const segment = keepRanges[segmentIndex] || keepRanges[0];
                if (!segment) return sourceTime;
                const offset = timelineOffsets[segmentIndex] || 0;
                return offset + clamp(sourceTime - segment.in, 0, segment.out - segment.in) / segment.speed;
            };
            const timelineToSource = timelineValue => {
                if (!keepRangesReady) return { index: 0, time: timelineValue };
                let index = keepRanges.length - 1;
                for (let candidate = 0; candidate < keepRanges.length; candidate += 1) {
                    const start = timelineOffsets[candidate];
                    const end = start + (keepRanges[candidate].out - keepRanges[candidate].in)
                        / keepRanges[candidate].speed;
                    if (timelineValue < end || candidate === keepRanges.length - 1) {
                        index = candidate;
                        break;
                    }
                }
                const start = timelineOffsets[index];
                const segmentDuration = (keepRanges[index].out - keepRanges[index].in) / keepRanges[index].speed;
                const withinSegment = clamp(timelineValue - start, 0, segmentDuration);
                return { index, time: keepRanges[index].in + withinSegment * keepRanges[index].speed };
            };
            const seekTimelineTime = timelineValue => {
                const mapped = timelineToSource(Math.max(0, timelineValue));
                currentSegmentIndex = mapped.index;
                video.currentTime = mapped.time;
            };
            const zoomToSlider = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                return (Math.log2(clamp(value, ZOOM_MIN, ZOOM_MAX)) - logMin) / (logMax - logMin);
            };
            const sliderToZoom = value => {
                const logMin = Math.log2(ZOOM_MIN);
                const logMax = Math.log2(ZOOM_MAX);
                const sliderValue = clamp(value, 0, 1);
                if (Math.abs(sliderValue - zoomToSlider(1)) <= SNAP_TOLERANCE) return 1;
                return Math.pow(2, logMin + (logMax - logMin) * sliderValue);
            };
            const renderZoom = () => {
                zoomLayer.style.transform = 'translate(' + (pan.x * zoom * 100).toFixed(3) + '%, '
                    + (pan.y * zoom * 100).toFixed(3) + '%) scale(' + zoom + ')';
                zoomValue.textContent = Math.round(zoom * 100) + '%';
                zoomSlider.value = String(zoomToSlider(zoom));
                const isZoomed = zoom > 1.05;
                wrapper.classList.toggle('is-draggable', isZoomed);
                if (!isZoomed) wrapper.classList.remove('is-dragging');
                zoomMinimap.hidden = !isZoomed;
                if (!isZoomed) return;
                const width = Number(summary.output && summary.output.width) || 1280;
                const height = Number(summary.output && summary.output.height) || 720;
                const aspectRatio = width / height;
                zoomMinimap.style.width = (aspectRatio >= 1 ? 64 : 64 * aspectRatio) + 'px';
                zoomMinimap.style.height = (aspectRatio >= 1 ? 64 / aspectRatio : 64) + 'px';
                const innerSize = 1 / zoom;
                zoomMinimapViewport.style.left = (((1 - innerSize) / 2 - pan.x) * 100) + '%';
                zoomMinimapViewport.style.top = (((1 - innerSize) / 2 - pan.y) * 100) + '%';
                zoomMinimapViewport.style.width = (innerSize * 100) + '%';
                zoomMinimapViewport.style.height = (innerSize * 100) + '%';
            };
            const setZoom = value => {
                zoom = clamp(value, ZOOM_MIN, ZOOM_MAX);
                if (zoom <= 1.05) {
                    pan = { x: 0, y: 0 };
                } else {
                    const maxR = (zoom - 1) / (2 * zoom);
                    pan = {
                        x: clamp(pan.x, -maxR, maxR),
                        y: clamp(pan.y, -maxR, maxR)
                    };
                }
                renderZoom();
            };

            const formatTime = value => {
                const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
                const minutes = Math.floor(seconds / 60);
                return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
            };
            const updateTransport = () => {
                const timelineDuration = keepRangesReady ? totalTimelineDuration : videoDuration();
                const timelinePosition = keepRangesReady
                    ? sourceToTimeline(video.currentTime || 0, currentSegmentIndex)
                    : (video.currentTime || 0);
                seek.max = String(timelineDuration);
                seek.value = String(clamp(timelinePosition, 0, timelineDuration));
                timeLabel.textContent = formatTime(timelinePosition) + ' / ' + formatTime(timelineDuration);
                const label = video.paused ? '再生' : '一時停止';
                playToggle.innerHTML = video.paused ? playIcon : pauseIcon;
                playToggle.setAttribute('aria-label', label);
                playToggle.title = label;
            };
            const waveformBinCount = () => {
                const raw = Math.max(96, Math.min(1024, Math.ceil(waveformRow.clientWidth / 2)));
                return Math.max(96, Math.round(raw / 8) * 8);
            };
            const aggregateWaveform = widthBins => {
                if (!waveformAudioBuffer || widthBins <= 0) return null;
                const total = waveformAudioBuffer.length;
                const samplesPerBin = total / widthBins;
                const peaks = new Float32Array(widthBins);
                const rms = new Float32Array(widthBins);
                const channel = waveformAudioBuffer.getChannelData(0);
                let globalMax = 0;
                let rmsMax = 0;
                for (let bin = 0; bin < widthBins; bin += 1) {
                    const start = Math.floor(bin * samplesPerBin);
                    const end = Math.min(total, Math.floor((bin + 1) * samplesPerBin));
                    let peak = 0;
                    let sumSquares = 0;
                    let count = 0;
                    for (let index = start; index < end; index += 1) {
                        const value = Math.abs(channel[index]);
                        if (value > peak) peak = value;
                        sumSquares += value * value;
                        count += 1;
                    }
                    const rootMeanSquare = count > 0 ? Math.sqrt(sumSquares / count) : 0;
                    peaks[bin] = peak;
                    rms[bin] = rootMeanSquare;
                    if (peak > globalMax) globalMax = peak;
                    if (rootMeanSquare > rmsMax) rmsMax = rootMeanSquare;
                }
                return { peaks, rms, globalMax, rmsMax };
            };
            const prepareWaveformCanvas = () => {
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                const width = Math.max(1, Math.floor(waveformRow.clientWidth));
                const height = Math.max(1, Math.floor(waveformRow.clientHeight));
                waveformCanvas.width = Math.floor(width * dpr);
                waveformCanvas.height = Math.floor(height * dpr);
                waveformCanvas.style.width = width + 'px';
                waveformCanvas.style.height = height + 'px';
                const context = waveformCanvas.getContext('2d');
                if (!context) return null;
                context.setTransform(dpr, 0, 0, dpr, 0, 0);
                context.fillStyle = '#181818';
                context.fillRect(0, 0, width, height);
                context.fillStyle = 'rgba(255,255,255,0.06)';
                context.fillRect(0, height / 2 - 0.5, width, 1);
                return { context, width, height };
            };
            const drawWaveformMessage = message => {
                const drawing = prepareWaveformCanvas();
                if (!drawing) return;
                drawing.context.fillStyle = '#999';
                drawing.context.font = '12px system-ui, sans-serif';
                drawing.context.textAlign = 'center';
                drawing.context.textBaseline = 'middle';
                drawing.context.fillText(message, drawing.width / 2, drawing.height / 2);
            };
            const drawWaveform = () => {
                if (waveformState === 'loading') {
                    drawWaveformMessage('波形を生成中…');
                    return;
                }
                if (waveformState === 'error') {
                    drawWaveformMessage('この動画の波形は生成できません');
                    return;
                }
                const drawing = prepareWaveformCanvas();
                if (!drawing || !waveformPeaks) return;
                const { context, width, height } = drawing;
                const maximum = Math.max(0.012, waveformPeaks.rmsMax * 1.08);
                const barWidth = Math.max(1, width / Math.max(1, waveformPeaks.rms.length));
                for (let index = 0; index < waveformPeaks.rms.length; index += 1) {
                    const normalized = Math.min(1, waveformPeaks.rms[index] / maximum);
                    const compressed = Math.pow(normalized, 0.62);
                    const barHeight = Math.max(1, compressed * (height - 10));
                    const x0 = Math.floor(index * barWidth);
                    const x1 = Math.max(x0 + 1, Math.ceil((index + 1) * barWidth) - 1);
                    context.fillStyle = waveformPeaks.peaks[index] >= 0.92 ? '#f97316' : '#22d3ee';
                    context.fillRect(x0, height / 2 - barHeight / 2, x1 - x0, barHeight);
                }
            };
            const waitForWaveformMetadata = () => {
                if (video.readyState >= 1) return Promise.resolve();
                return new Promise((resolve, reject) => {
                    const cleanup = () => {
                        video.removeEventListener('loadedmetadata', onLoaded);
                        video.removeEventListener('error', onError);
                    };
                    const onLoaded = () => {
                        cleanup();
                        resolve();
                    };
                    const onError = () => {
                        cleanup();
                        reject(new Error('video metadata unavailable'));
                    };
                    video.addEventListener('loadedmetadata', onLoaded);
                    video.addEventListener('error', onError);
                });
            };
            const loadWaveform = async () => {
                if (waveformState !== 'idle') return;
                waveformState = 'loading';
                drawWaveform();
                let context = null;
                try {
                    await waitForWaveformMetadata();
                    const bytes = await window.akari.engine.readWaveformBytes();
                    context = new AudioContext();
                    waveformAudioBuffer = await context.decodeAudioData(bytes.slice(0));
                    await context.close().catch(() => undefined);
                    context = null;
                    waveformPeaks = aggregateWaveform(waveformBinCount());
                    if (!waveformPeaks) throw new Error('waveform contains no audio samples');
                    waveformState = 'ready';
                    drawWaveform();
                } catch (error) {
                    if (context) await context.close().catch(() => undefined);
                    waveformAudioBuffer = null;
                    waveformPeaks = null;
                    waveformState = 'error';
                    drawWaveform();
                    console.error('[akari-preview] waveform generation failed', error);
                }
            };
            const updateWaveformPlayhead = () => {
                const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
                const position = duration > 0 ? clamp((video.currentTime || 0) / duration, 0, 1) : 0;
                waveformPlayhead.style.left = (position * 100) + '%';
            };
            const escapeCaptionHtml = value => String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
            const formatCaptionSeconds = value => String(Math.round(value * 1000) / 1000);
            const groupWordsIntoLines = (words, maximum = 13) => {
                const lines = [];
                let current = [];
                let currentLength = 0;
                for (const word of words) {
                    const wordLength = Array.from(word.text).length;
                    if (current.length > 0 && currentLength + wordLength > maximum) {
                        lines.push(current);
                        current = [];
                        currentLength = 0;
                    }
                    current.push(word);
                    currentLength += wordLength;
                }
                if (current.length > 0) lines.push(current);
                return lines;
            };
            const renderCaptionToken = (word, rangeStart, style) => {
                const delay = formatCaptionSeconds(Math.max(0, word.start - rangeStart));
                const className = style === 'karaoke'
                    ? 'akari-caption__tok akari-caption__tok--karaoke'
                    : 'akari-caption__tok akari-caption__tok--pop';
                const vars = style === 'karaoke'
                    ? '--akari-tok-delay: ' + delay + 's; --akari-tok-dur: '
                        + formatCaptionSeconds(Math.max(0.01, word.end - word.start)) + 's'
                    : '--akari-tok-delay: ' + delay + 's';
                return '<span class="' + className + '" style="' + vars + '">'
                    + escapeCaptionHtml(word.text) + '</span>';
            };
            const renderStyledCaptionFragment = caption => {
                const style = caption.style;
                const markup = groupWordsIntoLines(caption.words, 13).map(line =>
                    '<p class="akari-caption__line">'
                    + line.map(word => renderCaptionToken(word, caption.start, style)).join('')
                    + '</p>'
                ).join('');
                return '<div class="akari-caption akari-caption--' + style + '">'
                    + '<style>'
                    + '.akari-caption{position:absolute;inset:0;pointer-events:none;color:var(--caption-color,#fff);font-family:system-ui,-apple-system,sans-serif;font-size:var(--caption-font-size,38px);font-weight:700;line-height:1.42;text-align:center;}'
                    + '.akari-caption__plate{position:absolute;left:0;right:0;bottom:var(--caption-bottom,7%);display:flex;flex-direction:column;gap:var(--plate-gap,4px);}'
                    + '.akari-caption__line{width:max-content;max-width:92%;margin:0 auto;padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em);border-radius:var(--plate-radius,10px);background:var(--plate-bg,rgba(8,12,22,0.74));white-space:pre;}'
                    + '.akari-caption__tok{display:inline-block;will-change:transform,color;}'
                    + '@keyframes akari-caption-karaoke-lit{from{color:var(--caption-color,#fff);}to{color:var(--caption-highlight-color,#ffd94a);}}'
                    + '@keyframes akari-caption-pop{0%{transform:translateY(0) scale(1);}50%{transform:translateY(-0.08em) scale(1.12);}100%{transform:translateY(0) scale(1);}}'
                    + '.akari-caption__tok--karaoke{animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused;}'
                    + '.akari-caption__tok--pop{animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused;}'
                    + '</style><div class="akari-caption__plate">' + markup + '</div></div>';
            };
            const renderCaption = () => {
                const time = video.currentTime || 0;
                const caption = captions.find(candidate => candidate.start <= time && time < candidate.end) || null;
                if (caption !== activeCaption) {
                    activeCaption = caption;
                    styledCaptionActive = Boolean(caption
                        && (caption.style === 'karaoke' || caption.style === 'pop')
                        && Array.isArray(caption.words) && caption.words.length > 0);
                    captionPlate.classList.toggle('akari-caption-host--styled', styledCaptionActive);
                    if (styledCaptionActive) {
                        captionPlate.innerHTML = renderStyledCaptionFragment(caption);
                    } else {
                        captionPlate.textContent = caption ? caption.text : '';
                    }
                }
                if (caption && styledCaptionActive) {
                    const localMs = (clamp(time, caption.start, caption.end) - caption.start) * 1000;
                    for (const animation of captionPlate.getAnimations({ subtree: true })) {
                        animation.pause();
                        animation.currentTime = localMs;
                    }
                }
            };
            const renderTransitionPlate = timelineTime => {
                const plate = transitionPlates.find(candidate =>
                    timelineTime >= candidate.start && timelineTime <= candidate.end);
                if (!plate) {
                    transitionPlate.style.opacity = '0';
                    return;
                }
                const halfDuration = (plate.end - plate.start) / 2;
                const opacity = halfDuration > 0
                    ? clamp(1 - Math.abs(timelineTime - plate.mid) / halfDuration, 0, 1)
                    : 0;
                transitionPlate.style.background = plate.color;
                transitionPlate.style.opacity = String(opacity);
            };
            const renderLayers = timelineTime => {
                for (const entry of layerEntries) {
                    const layer = entry.spec;
                    const layerVideo = entry.video;
                    const active = !layer.proxyMissing
                        && typeof layer.src === 'string' && layer.src
                        && timelineTime >= layer.t && timelineTime < layer.t + layer.duration;
                    if (!active) {
                        layerVideo.style.display = 'none';
                        if (!layerVideo.paused) layerVideo.pause();
                        continue;
                    }
                    layerVideo.style.display = 'block';
                    if (layerVideo.readyState < HTMLMediaElement.HAVE_METADATA) continue;
                    const localTime = clamp(timelineTime - layer.t, 0, layer.duration);
                    const mediaEnd = Number.isFinite(layerVideo.duration) && layerVideo.duration > 0
                        ? Math.max(0, layerVideo.duration - 0.001)
                        : layer.duration;
                    const target = Math.min(localTime, mediaEnd);
                    const tolerance = video.paused ? 0.001 : 0.05;
                    if (Math.abs((layerVideo.currentTime || 0) - target) > tolerance) {
                        try {
                            layerVideo.currentTime = target;
                        } catch (error) {
                            console.warn('[akari-preview] layer seek failed', layer.id, error);
                        }
                    }
                    if (video.paused) {
                        if (!layerVideo.paused) layerVideo.pause();
                    } else if (layerVideo.paused) {
                        void layerVideo.play().catch(() => undefined);
                    }
                }
            };
            const tick = (immediatePlaybackTick = false) => {
                applyKeepRangeBoundary();
                const timelineTime = keepRangesReady
                    ? sourceToTimeline(video.currentTime || 0, currentSegmentIndex)
                    : (video.currentTime || 0);
                renderLayers(timelineTime);
                renderTransitionPlate(timelineTime);
                window.akari.runtime.tick(timelineTime, !video.paused);
                if (window.akari.previewAudio) {
                    window.akari.previewAudio.tick(timelineTime, !video.paused);
                }
                // タイムライン横軸と同じ出力秒（cuts ギャップレス連結後の秒）を送る（音声側も timelineTime で駆動済み）。
                window.akari.playbackTick(timelineTime, !video.paused, immediatePlaybackTick);
                renderCaption();
                updateTransport();
                updateWaveformPlayhead();
            };
            const animate = () => {
                tick();
                if (!video.paused && !video.ended) animationFrame = requestAnimationFrame(animate);
            };
            const startAnimation = () => {
                cancelAnimationFrame(animationFrame);
                animationFrame = requestAnimationFrame(animate);
            };
            const stopAnimation = () => {
                cancelAnimationFrame(animationFrame);
                animationFrame = 0;
                tick(true);
            };
            const hideInspector = () => {
                inspectorFields.replaceChildren();
                if (!initial.editPath) {
                    inspector.hidden = false;
                    workspace.classList.add('inspector-open');
                    inspectorTitle.textContent = 'インスペクタ';
                    const empty = document.createElement('p');
                    empty.className = 'empty';
                    empty.textContent = 'この動画に一致する edit.json はありません。';
                    inspectorFields.appendChild(empty);
                    return;
                }
                inspector.hidden = true;
                workspace.classList.remove('inspector-open');
            };
            const showPlaybackError = () => {
                playbackErrored = true;
                stopAnimation();
                video.pause();
                video.hidden = true;
                layersStage.hidden = true;
                stage.hidden = true;
                captionPlate.textContent = '';
                previewMessageText.textContent = '動画を再生できませんでした。再読み込みを試してください。';
                previewMessageReload.hidden = false;
                previewMessage.hidden = false;
                playToggle.disabled = true;
                frameBack.disabled = true;
                frameForward.disabled = true;
                skipBack.disabled = true;
                skipForward.disabled = true;
                waveformToggle.disabled = true;
                zoomToggle.disabled = true;
                fullscreenToggle.disabled = true;
                seek.disabled = true;
                hideInspector();
            };
            const restorePlayback = () => {
                if (!playbackErrored) return;
                playbackErrored = false;
                previewMessage.hidden = true;
                previewMessageReload.hidden = true;
                video.hidden = false;
                layersStage.hidden = false;
                stage.hidden = false;
                playToggle.disabled = false;
                frameBack.disabled = false;
                frameForward.disabled = false;
                skipBack.disabled = false;
                skipForward.disabled = false;
                waveformToggle.disabled = false;
                zoomToggle.disabled = false;
                fullscreenToggle.disabled = false;
                seek.disabled = false;
                updateTransport();
                tick(true);
            };
            previewMessageReload.addEventListener('click', () => video.load());
            const togglePlayback = () => {
                if (playToggle.disabled) return;
                if (video.paused) {
                    if (window.akari.previewAudio) void window.akari.previewAudio.resume();
                    void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                }
                else video.pause();
            };
            const isEditable = element => element instanceof HTMLElement
                && (element.matches('input, textarea') || element.isContentEditable);
            const videoDuration = () => Number.isFinite(video.duration) ? video.duration : 0;
            const nudgeFrame = direction => {
                video.pause();
                video.currentTime = clamp((video.currentTime || 0) + direction / fps, 0, videoDuration());
                tick();
            };
            const skipSeconds = seconds => {
                video.currentTime = clamp((video.currentTime || 0) + seconds, 0, videoDuration());
                tick();
            };

            playToggle.addEventListener('click', togglePlayback);
            frameBack.addEventListener('click', () => nudgeFrame(-1));
            frameForward.addEventListener('click', () => nudgeFrame(1));
            skipBack.addEventListener('click', () => skipSeconds(-10));
            skipForward.addEventListener('click', () => skipSeconds(10));
            waveformToggle.addEventListener('click', () => {
                const show = waveformRow.hidden;
                waveformRow.hidden = !show;
                waveformToggle.setAttribute('aria-pressed', String(show));
                if (!show) return;
                drawWaveform();
                updateWaveformPlayhead();
                void loadWaveform();
            });
            new ResizeObserver(() => {
                window.clearTimeout(waveformResizeTimer);
                waveformResizeTimer = window.setTimeout(() => {
                    if (waveformRow.hidden) return;
                    if (waveformState === 'ready') {
                        waveformPeaks = aggregateWaveform(waveformBinCount());
                    }
                    drawWaveform();
                }, 300);
            }).observe(waveformRow);
            const seekFromWaveformPointer = event => {
                const rect = waveformCanvas.getBoundingClientRect();
                const duration = videoDuration();
                if (rect.width <= 0 || duration <= 0) return;
                const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
                video.currentTime = fraction * duration;
                tick();
            };
            waveformCanvas.addEventListener('pointerdown', event => {
                if (event.button !== 0) return;
                event.preventDefault();
                waveformDragPointer = event.pointerId;
                waveformCanvas.setPointerCapture(event.pointerId);
                seekFromWaveformPointer(event);
            });
            waveformCanvas.addEventListener('pointermove', event => {
                if (waveformDragPointer !== event.pointerId) return;
                event.preventDefault();
                seekFromWaveformPointer(event);
            });
            const finishWaveformSeek = event => {
                if (waveformDragPointer !== event.pointerId) return;
                seekFromWaveformPointer(event);
                waveformDragPointer = null;
                if (waveformCanvas.hasPointerCapture(event.pointerId)) {
                    waveformCanvas.releasePointerCapture(event.pointerId);
                }
            };
            waveformCanvas.addEventListener('pointerup', finishWaveformSeek);
            waveformCanvas.addEventListener('pointercancel', event => {
                if (waveformDragPointer !== event.pointerId) return;
                waveformDragPointer = null;
            });
            zoomToggle.addEventListener('click', () => {
                zoomPopup.hidden = !zoomPopup.hidden;
                zoomToggle.setAttribute('aria-expanded', String(!zoomPopup.hidden));
            });
            zoomSlider.addEventListener('input', () => setZoom(sliderToZoom(Number(zoomSlider.value))));
            zoomSlider.addEventListener('dblclick', () => setZoom(1));
            for (const preset of document.querySelectorAll('.zoom-preset')) {
                preset.addEventListener('click', () => setZoom(Number(preset.getAttribute('data-zoom'))));
            }
            // capture 段で登録: パン開始の stopPropagation（ズーム中の wrapper pointerdown）に
            // 外側クリック検知が殺されないようにする
            document.addEventListener('pointerdown', event => {
                if (!zoomPopup.hidden && !event.target.closest('.transport-right')) {
                    zoomPopup.hidden = true;
                    zoomToggle.setAttribute('aria-expanded', 'false');
                }
            }, true);
            previewPane.addEventListener('wheel', event => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const factor = Math.exp(-event.deltaY * 0.01);
                setZoom(clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX));
            }, { passive: false });
            wrapper.addEventListener('pointerdown', event => {
                if (zoom <= 1.05 || event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                wrapper.setPointerCapture(event.pointerId);
                drag = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    base: { x: pan.x, y: pan.y },
                    vidW: zoomLayer.offsetWidth * zoom,
                    vidH: zoomLayer.offsetHeight * zoom,
                    didMove: false
                };
            }, true);
            wrapper.addEventListener('pointermove', event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const dx = event.clientX - drag.startX;
                const dy = event.clientY - drag.startY;
                if (!drag.didMove && Math.hypot(dx, dy) > CLICK_THRESHOLD_PX) {
                    drag.didMove = true;
                    wrapper.classList.add('is-dragging');
                }
                if (!drag.didMove) return;
                const maxR = (zoom - 1) / (2 * zoom);
                pan = {
                    x: clamp(drag.base.x + dx / drag.vidW, -maxR, maxR),
                    y: clamp(drag.base.y + dy / drag.vidH, -maxR, maxR)
                };
                renderZoom();
            }, true);
            const finishPan = event => {
                if (!drag || drag.pointerId !== event.pointerId) return;
                event.preventDefault();
                event.stopPropagation();
                const didMove = drag.didMove;
                drag = null;
                wrapper.classList.remove('is-dragging');
                if (wrapper.hasPointerCapture(event.pointerId)) wrapper.releasePointerCapture(event.pointerId);
                if (didMove) suppressClick = true;
            };
            wrapper.addEventListener('pointerup', finishPan, true);
            wrapper.addEventListener('pointercancel', finishPan, true);
            wrapper.addEventListener('click', event => {
                if (!suppressClick) return;
                suppressClick = false;
                event.preventDefault();
                event.stopPropagation();
            }, true);
            fullscreenToggle.addEventListener('click', () => {
                void window.akari.toggleFullscreen().catch(error => console.error('[akari-preview] fullscreen failed', error));
            });
            document.addEventListener('fullscreenchange', () => {
                const isFullscreen = Boolean(document.fullscreenElement);
                fullscreenToggle.setAttribute('aria-pressed', String(isFullscreen));
                fullscreenToggle.setAttribute('aria-label', isFullscreen ? '全画面解除' : '全画面');
                fullscreenToggle.title = isFullscreen ? '全画面解除' : '全画面';
                fullscreenToggle.innerHTML = isFullscreen ? restoreIcon : fullscreenIcon;
            });
            window.addEventListener('keydown', event => {
                if ((event.code !== 'Space' && event.key !== ' ')
                    || isEditable(event.target)
                    || isEditable(document.activeElement)
                    || playToggle.disabled) return;
                event.preventDefault();
                togglePlayback();
            });
            seek.addEventListener('input', () => {
                if (keepRangesReady) {
                    const mapped = timelineToSource(Number(seek.value));
                    currentSegmentIndex = mapped.index;
                    video.currentTime = mapped.time;
                } else {
                    video.currentTime = Number(seek.value);
                }
                tick();
            });
            let requestedOverlayId;
            const applyRequestedOverlaySelection = () => {
                if (requestedOverlayId === undefined) return;
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedId === requestedOverlayId) return;
                if (requestedOverlayId === null) {
                    if (selected) {
                        window.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape', code: 'Escape', bubbles: true, cancelable: true
                        }));
                    }
                    return;
                }
                const target = Array.from(stage.querySelectorAll('[data-overlay-id]'))
                    .find(candidate => candidate.getAttribute('data-overlay-id') === requestedOverlayId);
                if (!target || getComputedStyle(target).visibility === 'hidden') return;
                const fragment = Array.from(target.children)
                    .find(candidate => !candidate.hasAttribute('data-akari-interaction'));
                const rect = (fragment || target).getBoundingClientRect();
                target.dispatchEvent(new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: rect.left + rect.width / 2,
                    clientY: rect.top + rect.height / 2
                }));
            };
            video.addEventListener('loadedmetadata', () => {
                restorePlayback();
                rebuildKeepRanges();
                if (Number.isFinite(initial.initialSeekTime)) {
                    seekTimelineTime(initial.initialSeekTime);
                } else if (keepRangesReady) {
                    currentSegmentIndex = 0;
                    video.currentTime = keepRanges[0].in;
                }
                updateTransport();
            });
            video.addEventListener('canplay', restorePlayback);
            video.addEventListener('play', () => {
                const timelineTime = keepRangesReady
                    ? sourceToTimeline(video.currentTime || 0, currentSegmentIndex)
                    : (video.currentTime || 0);
                if (window.akari.previewAudio) void window.akari.previewAudio.playFrom(timelineTime);
                startAnimation();
            });
            video.addEventListener('play', () => {
                // 無音素材の検知は 1 ドキュメントにつき 1 回だけ。再生開始から 1.5 秒後、
                // まだ再生中で webkitAudioDecodedByteCount が 0（対応ブラウザのみ）なら無音とみなす。
                window.setTimeout(() => {
                    if (audioNoticeShown || video.paused || video.ended) return;
                    if (!('webkitAudioDecodedByteCount' in video)) return;
                    if (video.webkitAudioDecodedByteCount === 0) {
                        audioNoticeShown = true;
                        audioNotice.hidden = false;
                    }
                }, 1500);
            });
            video.addEventListener('pause', () => {
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('ended', () => {
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
                stopAnimation();
            });
            video.addEventListener('seeking', () => {
                if (window.akari.previewAudio) window.akari.previewAudio.pause();
            });
            video.addEventListener('seeked', () => {
                tick(true);
                if (!video.paused && window.akari.previewAudio) {
                    const timelineTime = keepRangesReady
                        ? sourceToTimeline(video.currentTime || 0, currentSegmentIndex)
                        : (video.currentTime || 0);
                    void window.akari.previewAudio.playFrom(timelineTime);
                }
                applyRequestedOverlaySelection();
            });
            video.addEventListener('timeupdate', () => tick());
            video.addEventListener('error', showPlaybackError);
            audioNoticeDismiss.addEventListener('click', () => {
                audioNotice.hidden = true;
            });
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-captions-update') {
                    captions = Array.isArray(message.captions) ? message.captions : [];
                    renderCaption();
                    return;
                }
                if (message && message.type === 'akari-preview-set-muted' && typeof message.muted === 'boolean') {
                    video.muted = message.muted;
                    return;
                }
                if (message && message.type === 'akari-preview-set-track-visibility'
                    && Number.isInteger(message.track) && message.track >= 0 && typeof message.visible === 'boolean') {
                    if (message.visible) hiddenTracks.delete(message.track); else hiddenTracks.add(message.track);
                    applyTrackVisibility(message.track);
                    return;
                }
                if (message && message.type === 'akari-preview-set-captions-visibility'
                    && typeof message.visible === 'boolean') {
                    captionPlate.style.visibility = message.visible ? 'visible' : 'hidden';
                    return;
                }
                if (message && message.type === 'akari-preview-seek' && Number.isFinite(message.time)) {
                    seekTimelineTime(message.time);
                    tick();
                    return;
                }
                if (message && message.type === 'akari-preview-select-overlay'
                    && (typeof message.overlayId === 'string' || message.overlayId === null)) {
                    requestedOverlayId = message.overlayId;
                    applyRequestedOverlaySelection();
                }
            });

            let lastReportedOverlayId = null;
            const renderInspector = () => {
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
                const selectedOverlayId = selected?.getAttribute('data-overlay-id') || null;
                if (selectedOverlayId !== lastReportedOverlayId) {
                    lastReportedOverlayId = selectedOverlayId;
                    requestedOverlayId = undefined;
                    window.akari.reportOverlaySelection(selectedOverlayId);
                }
                if (!selected) {
                    hideInspector();
                    return;
                }
                const overlayId = selected.getAttribute('data-overlay-id') || '';
                const overlay = summary.overlays.find(candidate => String(candidate.id) === overlayId);
                if (!overlay) {
                    hideInspector();
                    return;
                }
                inspector.hidden = false;
                workspace.classList.add('inspector-open');
                inspectorTitle.textContent = 'オーバーレイ: ' + overlayId;
                inspectorFields.replaceChildren();
                const entries = Object.entries(overlay.vars || {});
                if (!entries.length) {
                    const empty = document.createElement('p');
                    empty.className = 'empty';
                    empty.textContent = '宣言されたパラメータはありません。';
                    inspectorFields.appendChild(empty);
                    return;
                }
                for (const [name, value] of entries) {
                    const field = document.createElement('div');
                    field.className = 'field';
                    const label = document.createElement('label');
                    const input = document.createElement('input');
                    label.textContent = name;
                    input.value = String(value);
                    input.setAttribute('aria-label', name);
                    let timer = 0;
                    const persist = () => {
                        window.clearTimeout(timer);
                        const next = input.value;
                        overlay.vars = { ...(overlay.vars || {}), [name]: next };
                        window.akari.engine.overlayWrite(initial.editPath, overlayId, { vars: { [name]: next } })
                            .catch(error => console.error('[akari-preview] variable write failed', error));
                    };
                    input.addEventListener('input', () => {
                        selected.style.setProperty(name, input.value);
                        window.clearTimeout(timer);
                        timer = window.setTimeout(persist, 200);
                    });
                    input.addEventListener('change', persist);
                    field.append(label, input);
                    inspectorFields.appendChild(field);
                }
            };
            new MutationObserver(renderInspector).observe(stage, {
                attributes: true,
                attributeFilter: ['data-akari-interaction-selected'],
                subtree: true
            });

            Promise.resolve(window.akari.runtime.mount(summary)).then(() => {
                applyOverlayTracks();
                stage.append(transitionPlate, captionPlate);
                const indicators = Array.isArray(summary.indicators) ? summary.indicators : [];
                previewIndicators.hidden = indicators.length === 0;
                previewIndicators.textContent = indicators.length > 0
                    ? '書き出しで適用: ' + indicators.join('・')
                    : '';
                rebuildKeepRanges();
                if (keepRangesReady) {
                    currentSegmentIndex = 0;
                    video.currentTime = keepRanges[0].in;
                }
                setZoom(1);
                tick();
                renderInspector();
                applyRequestedOverlaySelection();
            }).catch(error => console.error('[akari-preview] overlay mount failed', error));
        })();`;
    }

    protected async isInsideWorkspace(uri: URI): Promise<boolean> {
        const value = uri.toString();
        return (await this.workspaceService.roots).some(root => {
            const prefix = root.resource.toString().replace(/\/$/, '') + '/';
            return value === root.resource.toString() || value.startsWith(prefix);
        });
    }

    protected streamOrigin(source: string): string {
        const parsed = new URL(source);
        return parsed.origin;
    }

    protected async disposeVideoStream(widget: PreviewWidgetMarker): Promise<void> {
        const id = widget.akariPreviewStreamId;
        widget.akariPreviewStreamId = undefined;
        if (id) {
            await this.disposeVideoStreamId(id);
        }
    }

    protected async disposeVideoStreamId(id: string): Promise<void> {
        try {
            await this.previewService.disposeVideoStream(id);
        } catch (error) {
            console.warn(`[akari-preview] failed to dispose video stream ${id}`, error);
        }
    }

    protected async disposeAssetStreams(ids: string[]): Promise<void> {
        await Promise.all(ids.map(async id => {
            try {
                await this.previewService.disposeAssetStream(id);
            } catch (error) {
                console.warn(`[akari-preview] failed to dispose asset stream ${id}`, error);
            }
        }));
    }

    protected async disposePreviewStreams(widget: PreviewWidgetMarker): Promise<void> {
        const assetIds = widget.akariPreviewAssetStreamIds ?? [];
        widget.akariPreviewAssetStreamIds = [];
        await Promise.all([
            this.disposeVideoStream(widget),
            this.disposeAssetStreams(assetIds)
        ]);
    }

    protected readText(uri: URI): Promise<string> {
        return this.fileService.readFile(uri).then(content => content.value.toString());
    }

    protected toBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    protected transform(value: any): OverlayTransform {
        return {
            x: this.finiteNumber(value?.x, 0),
            y: this.finiteNumber(value?.y, 0),
            scale: this.finiteNumber(value?.scale, 1),
            rotate: this.finiteNumber(value?.rotate, 0)
        };
    }

    protected objectRecord(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
    }

    protected stringRecord(value: unknown): Record<string, string> {
        return Object.fromEntries(Object.entries(this.objectRecord(value)).map(([key, item]) => [key, String(item)]));
    }

    protected finiteNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    protected positiveNumber(value: unknown, fallback: number): number {
        const number = Number(value);
        return Number.isFinite(number) && number > 0 ? number : fallback;
    }

    protected resolveEditAssetUri(pathValue: string, editUri: URI): URI {
        if (pathValue.startsWith('file:')) {
            return new URI(pathValue);
        }
        if (pathValue.startsWith('/')) {
            return new URI(pathValue).withScheme('file');
        }
        return editUri.parent.resolve(pathValue);
    }

    protected previewProxyUri(sourceUri: URI): URI {
        const base = sourceUri.path.base;
        const proxyBase = /\.mov$/i.test(base)
            ? base.replace(/\.mov$/i, '.preview.webm')
            : `${base}.preview.webm`;
        return sourceUri.parent.resolve(proxyBase);
    }

    protected pathBase(value: string): string {
        return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected safeJson(value: unknown): string {
        return JSON.stringify(value)
            .replace(/</g, '\\u003c')
            .replace(/\u2028/g, '\\u2028')
            .replace(/\u2029/g, '\\u2029');
    }

    protected escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected inlineScript(value: string): string {
        return value.replace(/<\/script/gi, '<\\/script');
    }

    protected inlineStyle(value: string): string {
        return value.replace(/<\/style/gi, '<\\/style');
    }

}

@injectable()
export class AkariOutputPreviewOpenHandler implements OpenHandler {
    readonly id = 'akari-output-preview-open-handler';

    @inject(AkariPreviewOpenHandler)
    protected readonly previewHandler: AkariPreviewOpenHandler;

    canHandle(uri: URI): number {
        return uri.path.base === 'edit.json' ? 1200 : 0;
    }

    open(uri: URI, options?: any): Promise<WebviewWidget> {
        return this.previewHandler.openOutput(uri, options);
    }
}
