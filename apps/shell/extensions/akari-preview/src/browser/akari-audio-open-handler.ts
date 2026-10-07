import { MaterialPreviewSlot } from './material-preview-slot';
import URI from '@theia/core/lib/common/uri';
import { CommandRegistry, MessageService } from '@theia/core/lib/common';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import {
    ApplicationShell,
    FrontendApplicationContribution,
    OpenHandler,
    WidgetManager
} from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    AkariPreviewService,
    TranscodeAudioErrorKind,
    TranscodeAudioResult
} from '../common/akari-preview-protocol';
import { MaterialPreviewRangeHost, materialPreviewContext } from './preview-script-host-adapter';
import { materialRangeWebviewScript, materialRangeWebviewStyle } from './preview-script-bootstrap';

interface AudioWidgetMarker extends WebviewWidget {
    akariAudioRangeHost?: MaterialPreviewRangeHost;
    akariAudioConfigured?: boolean;
    akariAudioFallbackAttempted?: boolean;
    akariAudioUri?: string;
    akariAudioFileSize?: number;
    akariAudioStreamId?: string;
    akariAudioLastKnownTime?: number;
}

const AUDIO_MIME_TYPES = new Map<string, string>([
    ['.aac', 'audio/aac'],
    ['.flac', 'audio/flac'],
    ['.m4a', 'audio/mp4'],
    ['.mp3', 'audio/mpeg'],
    ['.oga', 'audio/ogg'],
    ['.ogg', 'audio/ogg'],
    ['.opus', 'audio/ogg'],
    ['.wav', 'audio/wav']
]);
const MAX_INLINE_BYTES = 50 * 1024 * 1024;
const TRANSCODE_FIRST_EXTENSIONS = new Set(['.aac', '.m4a']);
const TOO_LARGE_MESSAGE = '大きすぎるためアプリ内で再生できません。';
const PLAYBACK_ERROR_MESSAGE = 'このファイルはアプリ内で再生できません。';
const FFMPEG_REQUIRED_MESSAGE = 'このファイルはアプリ内で再生できません。再生には ffmpeg が必要です。';
// akari-annotations 側の同名イベントと文字列だけをミラーし、拡張間の import 依存を避ける。
const RAW_PREVIEW_ANNOTATION_STATE_EVENT = 'akari.preview.rawAnnotationState';
// akari-annotations の ATTACH_AKARI_ANNOTATIONS_PASSIVE.id（akari-annotations-commands.ts）とミラー。
// cross-package import を避けるため文字列 ID のみで CommandRegistry.executeCommand に渡す。
const ATTACH_TIMELINE_PASSIVE_COMMAND_ID = 'akari.annotations.attachPassive';

@injectable()
export class AkariAudioOpenHandler implements OpenHandler, FrontendApplicationContribution {
    readonly id = 'akari-audio-open-handler';
    protected readonly lifecycleDisposables = new DisposableCollection();
    protected readonly openAudioPreviews = new Map<string, AudioWidgetMarker>();
    protected activeAudioWidget: AudioWidgetMarker | undefined;
    protected audioPreviewActivation = 0;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(MaterialPreviewSlot)
    protected readonly materialSlot: MaterialPreviewSlot;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(MessageService)
    protected readonly messages: MessageService;

    onStart(): void {
        this.lifecycleDisposables.push(this.shell.onDidChangeCurrentWidget(() => {
            this.syncAudioAnnotationContext();
        }));
    }

    onStop(): void {
        this.lifecycleDisposables.dispose();
    }

    canHandle(uri: URI): number {
        return AUDIO_MIME_TYPES.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, _options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-audio-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        this.configureWidget(widget, uri);
        const marker = widget as AudioWidgetMarker;
        if (!marker.akariAudioRangeHost) {
            try {
                const context = materialPreviewContext(uri, await this.currentWorkspaceRoots());
                if (context && await this.fileService.exists(new URI(context.projectUri).resolve('.akari'))) {
                    marker.akariAudioRangeHost = new MaterialPreviewRangeHost(widget, this.commandRegistry,
                        this.messages, context.projectUri, context.relativePath, 'audio', uri.path.base);
                }
            } catch { /* An unknown root keeps the ordinary audio preview available. */ }
        }
        await this.render(widget, uri);
        this.attachTimelinePassively();
        await this.materialSlot.claim(widget, uri);
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    // 動画がプレビューで開かれるたびにタイムラインの自動アタッチを要求する。重複禁止・
    // セッション内の明示クローズの尊重・フォーカスを奪わない（reveal のみ）判断は
    // 呼び出し先（akari-annotations）に委ねる。取りこぼしてもプレビュー自体は開けるべきなので
    // 結果を待たず、失敗時は握りつぶす。
    protected attachTimelinePassively(): void {
        this.commandRegistry.executeCommand(ATTACH_TIMELINE_PASSIVE_COMMAND_ID)
            .catch(error => console.warn('[akari-preview] failed to auto-attach timeline', error));
    }

    protected configureWidget(widget: WebviewWidget, uri: URI): void {
        const marker = widget as AudioWidgetMarker;
        marker.akariAudioUri = uri.toString();
        marker.akariAudioFallbackAttempted = false;
        if (marker.akariAudioConfigured) {
            return;
        }
        marker.akariAudioConfigured = true;
        const audioKey = uri.normalizePath().toString();
        this.openAudioPreviews.set(audioKey, marker);
        widget.onMessage(message => {
            if (message?.type === 'akari-audio-playback-tick' && Number.isFinite(message.time)) {
                this.forwardAudioPlaybackTick(marker, message.time, !!message.playing);
                return;
            }
            if (!message || message.type !== 'akari-audio-transcode-fallback' || marker.akariAudioFallbackAttempted) {
                return;
            }
            const audioUri = marker.akariAudioUri;
            if (!audioUri) {
                return;
            }
            marker.akariAudioFallbackAttempted = true;
            void this.renderTranscoded(widget, new URI(audioUri), marker.akariAudioFileSize);
        });
        widget.disposed.connect(() => {
            if (this.openAudioPreviews.get(audioKey) === marker) {
                this.openAudioPreviews.delete(audioKey);
            }
            void this.disposeTranscodedAudioStream(marker);
        });
    }

    protected forwardAudioPlaybackTick(widget: AudioWidgetMarker, time: number, _playing: boolean): void {
        widget.akariAudioLastKnownTime = time;
        if (this.activeAudioWidget === widget) {
            this.forwardRawPreviewAnnotationState(widget, 'playback');
        }
    }

    protected forwardRawPreviewAnnotationState(
        widget: AudioWidgetMarker,
        reason: 'focus' | 'playback'
    ): void {
        if (!widget.akariAudioUri) {
            return;
        }
        const mediaUri = new URI(widget.akariAudioUri).normalizePath().toString();
        window.dispatchEvent(new CustomEvent(RAW_PREVIEW_ANNOTATION_STATE_EVENT, {
            detail: {
                active: true,
                activation: this.audioPreviewActivation,
                mediaUri,
                sourceT: Math.max(0, widget.akariAudioLastKnownTime ?? 0),
                reason
            }
        }));
    }

    protected syncAudioAnnotationContext(): void {
        const mainWidget = this.shell.getCurrentWidget('main');
        const audioWidget = [...this.openAudioPreviews.values()].find(widget => widget === mainWidget);
        if (audioWidget === this.activeAudioWidget) {
            return;
        }
        if (audioWidget) {
            this.activeAudioWidget = audioWidget;
            this.audioPreviewActivation += 1;
            this.forwardRawPreviewAnnotationState(audioWidget, 'focus');
            return;
        }
        if (this.activeAudioWidget) {
            this.activeAudioWidget = undefined;
            window.dispatchEvent(new CustomEvent(RAW_PREVIEW_ANNOTATION_STATE_EVENT, {
                detail: { active: false, activation: this.audioPreviewActivation, reason: 'focus' }
            }));
        }
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        widget.viewType = 'akari.audio';
        widget.title.label = '素材プレビュー';
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-unmute';
        widget.setContentOptions({ allowScripts: true, allowForms: false });

        const mimeType = AUDIO_MIME_TYPES.get(uri.path.ext.toLowerCase()) ?? 'application/octet-stream';
        let fileSize: number | undefined;
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            fileSize = typeof stat.size === 'number' ? stat.size : undefined;
            (widget as AudioWidgetMarker).akariAudioFileSize = fileSize;
            if (fileSize !== undefined && fileSize > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(uri, TOO_LARGE_MESSAGE, fileSize));
                return;
            }

            if (TRANSCODE_FIRST_EXTENSIONS.has(uri.path.ext.toLowerCase())) {
                await this.renderTranscoded(widget, uri, fileSize);
                return;
            }

            const content = await this.fileService.readFile(uri);
            const bytes = content.value.buffer;
            fileSize = bytes.length;
            (widget as AudioWidgetMarker).akariAudioFileSize = fileSize;
            if (fileSize > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(uri, TOO_LARGE_MESSAGE, fileSize));
                return;
            }

            const dataUri = `data:${mimeType};base64,${this.toBase64(bytes)}`;
            widget.setHTML(this.audioHtml(uri, dataUri, fileSize, true, false));
        } catch (error) {
            console.warn(`[akari-preview] failed to read audio ${uri.toString()}`, error);
            widget.setHTML(this.messageHtml(uri, PLAYBACK_ERROR_MESSAGE, fileSize));
        }
    }

    protected async renderTranscoded(widget: WebviewWidget, uri: URI, fileSize?: number): Promise<void> {
        const marker = widget as AudioWidgetMarker;
        await this.disposeTranscodedAudioStream(marker);
        if (widget.isDisposed) {
            return;
        }
        let result: TranscodeAudioResult;
        try {
            result = await this.previewService.transcodeAudioToWav({
                audioUri: uri.toString(),
                workspaceRoots: await this.currentWorkspaceRoots()
            });
        } catch (error) {
            console.warn(`[akari-preview] failed to convert audio ${uri.toString()}`, error);
            widget.setHTML(this.messageHtml(uri, PLAYBACK_ERROR_MESSAGE, fileSize));
            return;
        }
        if ('error' in result) {
            widget.setHTML(this.messageHtml(uri, this.transcodeErrorMessage(result.error), fileSize));
            return;
        }
        if (widget.isDisposed) {
            await this.disposeTranscodedAudioStreamId(result.stream.id);
            return;
        }
        marker.akariAudioStreamId = result.stream.id;
        widget.setHTML(this.audioHtml(uri, result.stream.url, fileSize, false, true));
    }

    protected async disposeTranscodedAudioStream(marker: AudioWidgetMarker): Promise<void> {
        const id = marker.akariAudioStreamId;
        marker.akariAudioStreamId = undefined;
        if (id) {
            await this.disposeTranscodedAudioStreamId(id);
        }
    }

    protected async currentWorkspaceRoots(): Promise<string[]> {
        try {
            return (await this.workspaceService.roots).map(root => root.resource.toString());
        } catch {
            return [];
        }
    }

    protected async disposeTranscodedAudioStreamId(id: string): Promise<void> {
        try {
            await this.previewService.disposeTranscodedAudioStream(id);
        } catch (error) {
            console.warn(`[akari-preview] failed to dispose transcoded audio stream ${id}`, error);
        }
    }

    protected transcodeErrorMessage(error: TranscodeAudioErrorKind): string {
        if (error === 'ffmpeg-not-found') {
            return FFMPEG_REQUIRED_MESSAGE;
        }
        if (error === 'input-too-large') {
            return TOO_LARGE_MESSAGE;
        }
        return PLAYBACK_ERROR_MESSAGE;
    }

    protected audioHtml(
        uri: URI,
        sourceUri: string,
        fileSize: number | undefined,
        allowTranscodeFallback: boolean,
        transcoded: boolean
    ): string {
        const mediaSource = transcoded ? new URL(sourceUri).origin : 'data:';
        const materialIdentity = this.openAudioPreviews.get(uri.normalizePath().toString())?.akariAudioRangeHost?.dragIdentity;
        const materialRangeEnabled = !!materialIdentity;
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(mediaSource)}; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
${materialRangeEnabled ? materialRangeWebviewStyle() : ''}
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { position: relative; display: grid; place-items: center; padding: 32px; }
.akari-material-chip { position: absolute; top: 8px; left: 8px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; z-index: 10 }
.card { width: min(560px, 100%); padding: 28px; border: 1px solid #383838; border-radius: 12px; background: #1b1b1b; box-shadow: 0 12px 32px rgb(0 0 0 / 24%); }
.name { margin: 0 0 8px; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; }
.metadata { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 22px; color: #aaa; font-size: 13px; }
.note { margin: -12px 0 18px; color: #888; font-size: 12px; }
audio { display: block; width: 100%; }
${materialRangeEnabled ? `.material-audio-surface { height: 120px; position: relative; margin: 0 0 12px; border-radius: 6px; background: repeating-linear-gradient(90deg, #333 0 3px, #181818 3px 8px); overflow: hidden; cursor: grab; }
.material-audio-surface::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 1px; background: #666; }
.material-audio-surface #material-range-place { bottom: 10px; }
.material-audio-seek { display: flex; align-items: center; margin: 12px 0 8px; }
#material-audio-seek { width: 100%; height: 22px; margin: 0; opacity: 0; cursor: pointer; }` : ''}
.message { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
[hidden] { display: none; }
</style>
</head>
<body>
<div class="akari-material-chip">${this.escapeHtml(uri.path.base)}</div>
<main class="card">
<section id="player-card" data-playback-path="${transcoded ? 'ffmpeg' : 'direct'}">
<p class="name">${this.escapeHtml(uri.path.base)}</p>
<p class="metadata"><span>実尺: <span id="duration">読み込み中</span></span><span>サイズ: ${this.escapeHtml(this.formatBytes(fileSize))}</span></p>
${transcoded ? '<p class="note">ffmpeg 変換で再生中</p>' : ''}
${materialRangeEnabled ? `<div id="material-drag-surface" class="material-audio-surface"><button id="material-range-place" type="button" title="タイムラインに置く" draggable="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/></svg>タイムラインに置く</button></div>` : ''}
<audio id="audio" controls preload="metadata" data-source="${this.escapeHtml(sourceUri)}"></audio>
${materialRangeEnabled ? `<div class="material-audio-seek"><div class="material-seek-wrap"><input id="material-audio-seek" type="range" min="0" max="0" step="0.001" value="0" aria-label="再生位置"><div id="material-range-strip"><div class="bar"></div><div id="material-range-shade-in" class="shade"></div><div id="material-range-shade-out" class="shade"></div><div id="material-range-fill"></div><div id="material-range-in" class="mk" title="in"></div><div id="material-range-out" class="mk" title="out"></div><div id="material-range-cursor"></div></div></div><div class="material-io"><button id="material-range-button-in" title="in をここに（I）">I</button><button id="material-range-button-out" title="out をここに（O）">O</button><button id="material-range-button-clear" title="範囲をなしに">×</button></div></div>` : ''}
</section>
<section id="error-card" hidden>
<p class="message">${this.escapeHtml(PLAYBACK_ERROR_MESSAGE)}</p>
<p class="name">${this.escapeHtml(uri.path.base)}</p>
<p class="metadata"><span>サイズ: ${this.escapeHtml(this.formatBytes(fileSize))}</span></p>
</section>
</main>
<script>
(() => {
    const audio = document.getElementById('audio');
    const duration = document.getElementById('duration');
    const playerCard = document.getElementById('player-card');
    const errorCard = document.getElementById('error-card');
    const vscode = acquireVsCodeApi();
    ${materialRangeEnabled ? 'window.akariAudioPostMessage = message => vscode.postMessage(message);' : ''}
    const canRequestTranscodeFallback = ${allowTranscodeFallback};
    let fallbackRequested = false;

    const showFinalError = () => {
        playerCard.hidden = true;
        errorCard.hidden = false;
    };
    const handleAudioError = () => {
        if (canRequestTranscodeFallback && vscode && !fallbackRequested) {
            fallbackRequested = true;
            vscode.postMessage({ type: 'akari-audio-transcode-fallback' });
            return;
        }
        showFinalError();
    };
    audio.addEventListener('loadedmetadata', () => {
        if (!Number.isFinite(audio.duration)) {
            duration.textContent = '不明';
            return;
        }
        const totalSeconds = Math.max(0, Math.floor(audio.duration));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = String(totalSeconds % 60).padStart(2, '0');
        duration.textContent = minutes + ':' + seconds;
    });
    audio.addEventListener('error', handleAudioError);
    const reportPlaybackTick = () => {
        if (!Number.isFinite(audio.currentTime)) {
            return;
        }
        vscode.postMessage({
            type: 'akari-audio-playback-tick',
            time: audio.currentTime,
            playing: !audio.paused
        });
    };
    for (const eventName of ['timeupdate', 'play', 'pause', 'seeked']) {
        audio.addEventListener(eventName, reportPlaybackTick);
    }

    const source = audio.dataset.source;
    audio.removeAttribute('data-source');
    if (source) {
        audio.src = source;
        audio.load();
    } else {
        showFinalError();
    }
})();
</script>
${materialIdentity ? `<script>${materialRangeWebviewScript('audio', materialIdentity)}</script>` : ''}
</body>
</html>`;
    }

    protected messageHtml(uri: URI, message: string, fileSize?: number): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { position: relative; display: grid; place-items: center; padding: 32px; }
.akari-material-chip { position: absolute; top: 8px; left: 8px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; z-index: 10 }
.card { width: min(560px, 100%); padding: 28px; border: 1px solid #383838; border-radius: 12px; background: #1b1b1b; }
.message { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
.name { margin: 0 0 8px; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; }
.metadata { margin: 0; color: #aaa; font-size: 13px; }
</style>
</head>
<body>
<div class="akari-material-chip">${this.escapeHtml(uri.path.base)}</div>
<main class="card">
<p class="message">${this.escapeHtml(message)}</p>
<p class="name">${this.escapeHtml(uri.path.base)}</p>
<p class="metadata">サイズ: ${this.escapeHtml(this.formatBytes(fileSize))}</p>
</main>
</body>
</html>`;
    }

    protected formatBytes(bytes?: number): string {
        if (bytes === undefined) {
            return '取得できません';
        }
        if (bytes < 1024) {
            return `${bytes} B`;
        }
        const units = ['KB', 'MB', 'GB'];
        let value = bytes / 1024;
        let unitIndex = 0;
        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex++;
        }
        return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
    }

    protected toBase64(bytes: Uint8Array): string {
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    protected hash(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    protected escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
