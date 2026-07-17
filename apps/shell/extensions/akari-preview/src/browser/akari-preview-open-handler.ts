import URI from '@theia/core/lib/common/uri';
import { CommandRegistry } from '@theia/core/lib/common';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { ApplicationShell, FrontendApplicationContribution, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
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
    transform: OverlayTransform;
    vars: Record<string, string>;
}

interface EditSummary {
    output: { width: number; height: number; fps?: number };
    overlays: EditSummaryOverlay[];
}

interface PreviewModel {
    summary: EditSummary;
    editUri?: URI;
    overlayUris: URI[];
    captionsUri?: URI;
    captions: PreviewCaption[];
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

interface PreviewWidgetMarker extends WebviewWidget {
    akariPreviewConfigured?: boolean;
    akariPreviewConfiguration?: Promise<void>;
    akariPreviewRefresh?: Promise<void>;
    akariPreviewCaptionsUpdate?: Promise<void>;
    akariPreviewEditUri?: URI;
    akariPreviewCaptionsUri?: URI;
    akariPreviewTrackedResources?: Set<string>;
    akariPreviewStreamId?: string;
    akariPreviewSeekable?: boolean;
}

// akari-transcript の AKARI_TRANSCRIPT_SEEK_REQUESTED.id（akari-transcript-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.registerHandler に後付け登録する。
const TRANSCRIPT_SEEK_COMMAND_ID = 'akari.transcript.seekRequested';

interface TranscriptSeekRequest {
    videoUri?: string;
    time?: number;
    captionId?: string;
}

const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: []
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

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-preview-open-handler';
    protected readonly recentWrites = new Map<string, number>();
    protected readonly openPreviews = new Map<string, PreviewWidgetMarker>();
    protected overlayWriteTail = Promise.resolve();

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

    onStart(): void {
        this.widgetManager.onDidCreateWidget(event => {
            if (event.factoryId !== WebviewWidget.FACTORY_ID || !(event.widget instanceof WebviewWidget)) {
                return;
            }
            const { id, viewId } = event.widget.identifier;
            if (id.startsWith('akari-preview-') && viewId) {
                void this.configurePreview(event.widget, new URI(viewId));
            }
        });
        this.registerSeekHandler();
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
        const identifier = { id: `akari-preview-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        await this.configurePreview(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async configurePreview(widget: WebviewWidget, videoUri: URI): Promise<void> {
        const marker = widget as PreviewWidgetMarker;
        if (marker.akariPreviewConfiguration) {
            return marker.akariPreviewConfiguration;
        }
        marker.akariPreviewConfiguration = this.doConfigurePreview(marker, videoUri);
        try {
            await marker.akariPreviewConfiguration;
        } finally {
            marker.akariPreviewConfiguration = undefined;
        }
    }

    protected async doConfigurePreview(widget: PreviewWidgetMarker, videoUri: URI): Promise<void> {
        const seekKey = videoUri.normalizePath().toString();
        this.openPreviews.set(seekKey, widget);
        await this.refreshPreview(widget, videoUri);

        if (widget.akariPreviewConfigured) {
            return;
        }
        widget.akariPreviewConfigured = true;
        const disposables = new DisposableCollection();
        disposables.push(widget.onMessage(message => {
            if (this.isOverlayWriteRequest(message)) {
                this.overlayWriteTail = this.overlayWriteTail.then(() => this.handleOverlayWrite(widget, message));
            }
        }));
        disposables.push(this.fileService.onDidFilesChange(event => {
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
                this.queueRefresh(widget, videoUri);
            }
        }));
        for (const root of await this.workspaceService.roots) {
            disposables.push(await this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            disposables.push(await this.fileService.watch(videoUri.parent, { recursive: true, excludes: [] }));
        }
        widget.disposed.connect(() => {
            disposables.dispose();
            this.openPreviews.delete(seekKey);
            void this.disposeVideoStream(widget);
        });
    }

    protected queueRefresh(widget: PreviewWidgetMarker, videoUri: URI): void {
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        widget.akariPreviewRefresh = previous.then(
            () => this.refreshPreview(widget, videoUri),
            () => this.refreshPreview(widget, videoUri)
        ).catch(error => console.error('[akari-preview] failed to refresh preview', error));
    }

    protected queueCaptionsUpdate(widget: PreviewWidgetMarker): void {
        const previous = widget.akariPreviewCaptionsUpdate ?? Promise.resolve();
        widget.akariPreviewCaptionsUpdate = previous.then(async () => {
            const captions = await this.loadPreviewCaptions(widget.akariPreviewCaptionsUri);
            widget.sendMessage({ type: 'akari-preview-captions-update', captions });
        }).catch(error => console.error('[akari-preview] failed to update captions', error));
    }

    protected async refreshPreview(widget: PreviewWidgetMarker, videoUri: URI): Promise<void> {
        const extension = videoUri.path.ext.toLowerCase();
        const mimeType = PLAYABLE_VIDEO_MIME_TYPES.get(extension);
        if (!mimeType) {
            this.showMessageCard(widget, videoUri, UNSUPPORTED_FORMAT_MESSAGE);
            return;
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            this.showMessageCard(widget, videoUri, OUTSIDE_WORKSPACE_MESSAGE);
            return;
        }

        const [model, assets] = await Promise.all([
            this.loadPreviewModel(videoUri),
            this.previewService.getOverlayRuntimeAssets()
        ]);
        const videoStream = await this.previewService.createVideoStream({
            videoUri: videoUri.toString()
        });
        await this.disposeVideoStream(widget);
        widget.akariPreviewStreamId = videoStream.id;
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewCaptionsUri = model.captionsUri;
        widget.akariPreviewTrackedResources = new Set([
            ...(model.editUri ? [model.editUri.toString()] : []),
            ...(model.captionsUri ? [model.captionsUri.toString()] : []),
            ...model.overlayUris.map(uri => uri.toString())
        ]);
        widget.viewType = 'akari.preview';
        widget.title.label = videoUri.path.base;
        widget.title.caption = videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({
            allowScripts: true,
            allowForms: true
        });
        widget.akariPreviewSeekable = true;
        widget.setHTML(this.prepareHtml(videoUri, videoStream.url, model, assets));
    }

    protected showMessageCard(widget: PreviewWidgetMarker, videoUri: URI, message: string): void {
        widget.akariPreviewSeekable = false;
        void this.disposeVideoStream(widget);
        widget.akariPreviewEditUri = undefined;
        widget.akariPreviewCaptionsUri = undefined;
        widget.akariPreviewTrackedResources = new Set();
        widget.viewType = 'akari.preview';
        widget.title.label = videoUri.path.base;
        widget.title.caption = videoUri.toString();
        widget.title.iconClass = 'codicon codicon-preview';
        widget.setContentOptions({ allowScripts: false, allowForms: false });
        widget.setHTML(this.prepareMessageHtml(message));
    }

    protected async loadPreviewModel(videoUri: URI): Promise<PreviewModel> {
        const editUri = await this.findEditJson(videoUri);
        const [workspaceRoot] = await this.workspaceService.roots;
        const captionsUri = locatePreviewCaptions(editUri, workspaceRoot?.resource);
        const captions = await this.loadPreviewCaptions(captionsUri);
        if (!editUri) {
            console.info(`[akari-preview] edit.json was not found for ${videoUri.toString()}; opening video only`);
            return { summary: EMPTY_SUMMARY, overlayUris: [], captionsUri, captions };
        }
        try {
            const edit = JSON.parse(await this.readText(editUri));
            const width = this.positiveNumber(edit?.output?.width, EMPTY_SUMMARY.output.width);
            const height = this.positiveNumber(edit?.output?.height, EMPTY_SUMMARY.output.height);
            const overlays: EditSummaryOverlay[] = [];
            const overlayUris: URI[] = [];
            for (const value of Array.isArray(edit?.overlays) ? edit.overlays : []) {
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
                overlays.push({
                    id: String(value?.id ?? ''),
                    html,
                    start: this.finiteNumber(value?.start, 0),
                    duration: this.finiteNumber(value?.duration, 0),
                    transform: this.transform(value?.transform),
                    vars: this.stringRecord(value?.vars)
                });
            }
            return {
                editUri,
                overlayUris,
                captionsUri,
                captions,
                summary: {
                    output: { width, height, fps: this.positiveNumber(edit?.output?.fps, 30) },
                    overlays
                }
            };
        } catch (error) {
            console.warn(`[akari-preview] failed to load ${editUri.toString()}; opening video only`, error);
            return { editUri, summary: EMPTY_SUMMARY, overlayUris: [], captionsUri, captions };
        }
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

    protected prepareHtml(
        videoUri: URI,
        videoSource: string,
        model: PreviewModel,
        assets: OverlayRuntimeAssets
    ): string {
        const { width, height } = model.summary.output;
        const initialState = this.safeJson({
            summary: model.summary,
            captions: model.captions,
            editPath: model.editUri?.toString() ?? null,
            videoUri: videoUri.toString()
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(this.streamOrigin(videoSource))}; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
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
#preview-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
#overlay-stage { position: absolute; top: 0; left: 0; width: ${width}px; height: ${height}px; transform-origin: 0 0; overflow: visible; }
#caption-plate { position: absolute; left: 50%; bottom: 7%; z-index: 2; max-width: 88%; transform: translateX(-50%); padding: 0.35em 0.7em; border-radius: 0.18em; background: rgba(0, 0, 0, 0.78); color: #fff; font-size: clamp(16px, 3vw, 40px); font-weight: 700; line-height: 1.45; text-align: center; text-shadow: 0 1px 2px #000; white-space: pre-wrap; pointer-events: none; user-select: none; }
#caption-plate:empty { display: none; }
.message-card { position: absolute; inset: 0; z-index: 10; display: grid; place-items: center; padding: 32px; background: #111; }
.message-card[hidden] { display: none; }
.message-card p { max-width: 520px; margin: 0; color: #e5e5e5; font-size: 15px; line-height: 1.7; text-align: center; }
#inspector { padding: 16px; border-left: 1px solid #303030; background: #1b1b1b; overflow: auto; }
#inspector[hidden] { display: none; }
#inspector h2 { margin: 0 0 14px; font-size: 14px; }
.field { display: grid; gap: 6px; margin-bottom: 12px; }
.field label { overflow-wrap: anywhere; color: #c8c8c8; font-size: 12px; }
.field input { width: 100%; border: 1px solid #4a4a4a; border-radius: 4px; padding: 7px 8px; background: #111; color: #fff; }
.empty { color: #999; font-size: 12px; }
.transport { display: grid; grid-template-columns: auto minmax(100px, 1fr) auto; gap: 12px; align-items: center; padding: 10px 14px; border-top: 1px solid #303030; background: #202020; }
.transport button { min-width: 72px; border: 1px solid #505050; border-radius: 4px; padding: 6px 10px; background: #303030; color: #fff; cursor: pointer; }
.transport input { width: 100%; }
#time-label { min-width: 104px; color: #d0d0d0; font-variant-numeric: tabular-nums; text-align: right; }
@media (max-width: 720px) { .workspace.inspector-open { grid-template-columns: minmax(0, 1fr) 210px; } }
</style>
</head>
<body>
<main class="workspace">
  <section class="preview-pane" aria-label="動画プレビュー">
    <div id="preview-wrapper">
      <video id="preview-video" src="${this.escapeHtml(videoSource)}" preload="metadata"></video>
      <div id="overlay-stage"></div>
      <div id="caption-plate"></div>
      <div id="preview-message" class="message-card" hidden role="status"><p>${UNSUPPORTED_FORMAT_MESSAGE}</p></div>
    </div>
  </section>
  <aside id="inspector" hidden aria-label="オーバーレイインスペクタ">
    <h2 id="inspector-title">オーバーレイ</h2>
    <div id="inspector-fields"></div>
  </aside>
</main>
<div class="transport">
  <button id="play-toggle" type="button">再生</button>
  <input id="seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置">
  <span id="time-label">0:00 / 0:00</span>
</div>
<script>window.__akariPreview = ${initialState};</script>
<script>${this.hostAdapterScript()}</script>
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
            const wrapper = document.getElementById('preview-wrapper');
            const stage = document.getElementById('overlay-stage');
            const output = initial.summary.output;

            window.akari = window.akari || {};
            window.akari.state = { editPath: initial.editPath, summary: initial.summary };
            window.akari.engine = {
                overlayWrite: (_editPath, overlayId, patch) => new Promise((resolve, reject) => {
                    const requestId = 'akari-preview-' + (++sequence);
                    pending.set(requestId, { resolve, reject });
                    vscode.postMessage({ type: 'akari-preview-overlay-write', requestId, overlayId, patch });
                })
            };
            window.akari.stageScale = () => displayScale;

            window.addEventListener('message', event => {
                const message = event.data;
                if (!message || message.type !== 'akari-preview-overlay-write-response') return;
                const request = pending.get(message.requestId);
                if (!request) return;
                pending.delete(message.requestId);
                if (message.ok) request.resolve(undefined);
                else request.reject(new Error(message.error || 'edit.json の書き込みに失敗しました'));
            });

            const updateStageScale = () => {
                const next = wrapper.clientWidth / Number(output.width || 1280);
                displayScale = Number.isFinite(next) && next > 0 ? next : 1;
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
            const seek = document.getElementById('seek');
            const timeLabel = document.getElementById('time-label');
            const stage = document.getElementById('overlay-stage');
            const captionPlate = document.getElementById('caption-plate');
            const previewMessage = document.getElementById('preview-message');
            const inspector = document.getElementById('inspector');
            const inspectorTitle = document.getElementById('inspector-title');
            const inspectorFields = document.getElementById('inspector-fields');
            const workspace = document.querySelector('.workspace');
            let captions = Array.isArray(initial.captions) ? initial.captions : [];
            let animationFrame = 0;

            const formatTime = value => {
                const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
                const minutes = Math.floor(seconds / 60);
                return minutes + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
            };
            const updateTransport = () => {
                const duration = Number.isFinite(video.duration) ? video.duration : 0;
                seek.max = String(duration);
                seek.value = String(Math.min(video.currentTime || 0, duration));
                timeLabel.textContent = formatTime(video.currentTime) + ' / ' + formatTime(duration);
                playToggle.textContent = video.paused ? '再生' : '停止';
            };
            const renderCaption = () => {
                const time = video.currentTime || 0;
                const caption = captions.find(candidate => candidate.start <= time && time < candidate.end);
                captionPlate.textContent = caption ? caption.text : '';
            };
            const tick = () => {
                window.akari.runtime.tick(video.currentTime || 0, !video.paused);
                renderCaption();
                updateTransport();
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
                tick();
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
                stopAnimation();
                video.pause();
                video.hidden = true;
                stage.hidden = true;
                captionPlate.textContent = '';
                previewMessage.hidden = false;
                playToggle.disabled = true;
                seek.disabled = true;
                hideInspector();
            };

            playToggle.addEventListener('click', () => {
                if (video.paused) void video.play().catch(error => console.error('[akari-preview] playback failed', error));
                else video.pause();
            });
            seek.addEventListener('input', () => {
                video.currentTime = Number(seek.value);
                tick();
            });
            video.addEventListener('loadedmetadata', updateTransport);
            video.addEventListener('play', startAnimation);
            video.addEventListener('pause', stopAnimation);
            video.addEventListener('ended', stopAnimation);
            video.addEventListener('seeked', tick);
            video.addEventListener('timeupdate', tick);
            video.addEventListener('error', showPlaybackError);
            window.addEventListener('message', event => {
                const message = event.data;
                if (message && message.type === 'akari-preview-captions-update') {
                    captions = Array.isArray(message.captions) ? message.captions : [];
                    renderCaption();
                    return;
                }
                if (message && message.type === 'akari-preview-seek' && Number.isFinite(message.time)) {
                    video.currentTime = Math.max(0, message.time);
                    tick();
                }
            });

            const renderInspector = () => {
                const selected = stage.querySelector('[data-overlay-id][data-akari-interaction-selected="true"]');
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
                tick();
                renderInspector();
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
            try {
                await this.previewService.disposeVideoStream(id);
            } catch (error) {
                console.warn(`[akari-preview] failed to dispose video stream ${id}`, error);
            }
        }
    }

    protected readText(uri: URI): Promise<string> {
        return this.fileService.readFile(uri).then(content => content.value.toString());
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
