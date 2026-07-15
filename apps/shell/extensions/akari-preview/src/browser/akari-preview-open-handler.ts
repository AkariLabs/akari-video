import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { ApplicationShell, FrontendApplicationContribution, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewService, OverlayRuntimeAssets } from '../common/akari-preview-protocol';

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
    akariPreviewEditUri?: URI;
    akariPreviewTrackedResources?: Set<string>;
}

const EMPTY_SUMMARY: EditSummary = {
    output: { width: 1280, height: 720, fps: 30 },
    overlays: []
};
const SKIPPED_DIRECTORIES = new Set(['.git', '.akari', 'node_modules']);

@injectable()
export class AkariPreviewOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-preview-open-handler';
    protected readonly recentWrites = new Map<string, number>();
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
    }

    canHandle(uri: URI): number {
        return uri.path.ext.toLowerCase() === '.mp4' ? 1100 : 0;
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
        const assets = await this.previewService.getOverlayRuntimeAssets();
        await this.refreshPreview(widget, videoUri, assets);

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
            const relevant = event.changes.some(change => {
                const key = change.resource.toString();
                if (tracked.has(key)) {
                    const writtenAt = this.recentWrites.get(key) ?? 0;
                    return Date.now() - writtenAt > 1000;
                }
                return !widget.akariPreviewEditUri && change.resource.path.base === 'edit.json';
            });
            if (relevant) {
                this.queueRefresh(widget, videoUri, assets);
            }
        }));
        for (const root of await this.workspaceService.roots) {
            disposables.push(await this.fileService.watch(root.resource, { recursive: true, excludes: [] }));
        }
        if (!(await this.isInsideWorkspace(videoUri))) {
            disposables.push(await this.fileService.watch(videoUri.parent, { recursive: true, excludes: [] }));
        }
        widget.disposed.connect(() => disposables.dispose());
    }

    protected queueRefresh(widget: PreviewWidgetMarker, videoUri: URI, assets: OverlayRuntimeAssets): void {
        const previous = widget.akariPreviewRefresh ?? Promise.resolve();
        widget.akariPreviewRefresh = previous.then(
            () => this.refreshPreview(widget, videoUri, assets),
            () => this.refreshPreview(widget, videoUri, assets)
        ).catch(error => console.error('[akari-preview] failed to refresh preview', error));
    }

    protected async refreshPreview(widget: PreviewWidgetMarker, videoUri: URI, assets: OverlayRuntimeAssets): Promise<void> {
        const [model, videoContent] = await Promise.all([
            this.loadPreviewModel(videoUri),
            this.fileService.readFile(videoUri)
        ]);
        // v0 trade-off: data URI は動画全体をメモリに保持するため、数百MB〜GB級の書き出しには向かない。
        const videoSource = `data:video/mp4;base64,${this.toBase64(videoContent.value.buffer)}`;
        widget.akariPreviewEditUri = model.editUri;
        widget.akariPreviewTrackedResources = new Set([
            ...(model.editUri ? [model.editUri.toString()] : []),
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
        widget.setHTML(this.prepareHtml(videoUri, videoSource, model, assets));
    }

    protected async loadPreviewModel(videoUri: URI): Promise<PreviewModel> {
        const editUri = await this.findEditJson(videoUri);
        if (!editUri) {
            console.info(`[akari-preview] edit.json was not found for ${videoUri.toString()}; opening video only`);
            return { summary: EMPTY_SUMMARY, overlayUris: [] };
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
                summary: {
                    output: { width, height, fps: this.positiveNumber(edit?.output?.fps, 30) },
                    overlays
                }
            };
        } catch (error) {
            console.warn(`[akari-preview] failed to load ${editUri.toString()}; opening video only`, error);
            return { editUri, summary: EMPTY_SUMMARY, overlayUris: [] };
        }
    }

    protected async findEditJson(videoUri: URI): Promise<URI | undefined> {
        const adjacent = videoUri.parent.resolve('edit.json');
        if (await this.fileService.exists(adjacent)) {
            return adjacent;
        }

        const roots = await this.workspaceService.roots;
        for (const root of roots) {
            const planning = root.resource.resolve('planning');
            const candidates = await this.findNamedFiles(planning, 'edit.json');
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

        for (const root of roots) {
            const candidates = await this.findNamedFiles(root.resource, 'edit.json');
            if (candidates.length) {
                return candidates[0];
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
            editPath: model.editUri?.toString() ?? null,
            videoUri: videoUri.toString()
        });
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
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
      <video id="preview-video" src="${videoSource}" preload="metadata"></video>
      <div id="overlay-stage"></div>
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
            const inspector = document.getElementById('inspector');
            const inspectorTitle = document.getElementById('inspector-title');
            const inspectorFields = document.getElementById('inspector-fields');
            const workspace = document.querySelector('.workspace');
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
            const tick = () => {
                window.akari.runtime.tick(video.currentTime || 0, !video.paused);
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

            const hideInspector = () => {
                inspector.hidden = true;
                workspace.classList.remove('inspector-open');
                inspectorFields.replaceChildren();
            };
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

    protected toBase64(bytes: Uint8Array): string {
        const chunkSize = 0x8000;
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    protected inlineScript(value: string): string {
        return value.replace(/<\/script/gi, '<\\/script');
    }

    protected inlineStyle(value: string): string {
        return value.replace(/<\/style/gi, '<\\/style');
    }

}
