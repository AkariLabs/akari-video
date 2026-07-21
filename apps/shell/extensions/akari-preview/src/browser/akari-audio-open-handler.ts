import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    AkariPreviewService,
    TranscodeAudioErrorKind,
    TranscodeAudioResult
} from '../common/akari-preview-protocol';

interface AudioWidgetMarker extends WebviewWidget {
    akariAudioConfigured?: boolean;
    akariAudioFallbackAttempted?: boolean;
    akariAudioUri?: string;
    akariAudioFileSize?: number;
    akariAudioStreamId?: string;
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

@injectable()
export class AkariAudioOpenHandler implements OpenHandler {
    readonly id = 'akari-audio-open-handler';

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    canHandle(uri: URI): number {
        return AUDIO_MIME_TYPES.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-audio-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        this.configureWidget(widget, uri);
        await this.render(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected configureWidget(widget: WebviewWidget, uri: URI): void {
        const marker = widget as AudioWidgetMarker;
        marker.akariAudioUri = uri.toString();
        marker.akariAudioFallbackAttempted = false;
        if (marker.akariAudioConfigured) {
            return;
        }
        marker.akariAudioConfigured = true;
        widget.onMessage(message => {
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
            void this.disposeTranscodedAudioStream(marker);
        });
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        widget.viewType = 'akari.audio';
        widget.title.label = uri.path.base;
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-file-media';
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
            result = await this.previewService.transcodeAudioToWav({ audioUri: uri.toString() });
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
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src ${this.escapeHtml(mediaSource)}; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { display: grid; place-items: center; padding: 32px; }
.card { width: min(560px, 100%); padding: 28px; border: 1px solid #383838; border-radius: 12px; background: #1b1b1b; box-shadow: 0 12px 32px rgb(0 0 0 / 24%); }
.name { margin: 0 0 8px; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; }
.metadata { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 22px; color: #aaa; font-size: 13px; }
.note { margin: -12px 0 18px; color: #888; font-size: 12px; }
audio { display: block; width: 100%; }
.message { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
[hidden] { display: none; }
</style>
</head>
<body>
<main class="card">
<section id="player-card" data-playback-path="${transcoded ? 'ffmpeg' : 'direct'}">
<p class="name">${this.escapeHtml(uri.path.base)}</p>
<p class="metadata"><span>実尺: <span id="duration">読み込み中</span></span><span>サイズ: ${this.escapeHtml(this.formatBytes(fileSize))}</span></p>
${transcoded ? '<p class="note">ffmpeg 変換で再生中</p>' : ''}
<audio id="audio" controls preload="metadata" data-source="${this.escapeHtml(sourceUri)}"></audio>
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
    const vscode = ${allowTranscodeFallback ? 'acquireVsCodeApi()' : 'undefined'};
    let fallbackRequested = false;

    const showFinalError = () => {
        playerCard.hidden = true;
        errorCard.hidden = false;
    };
    const handleAudioError = () => {
        if (vscode && !fallbackRequested) {
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
body { display: grid; place-items: center; padding: 32px; }
.card { width: min(560px, 100%); padding: 28px; border: 1px solid #383838; border-radius: 12px; background: #1b1b1b; }
.message { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
.name { margin: 0 0 8px; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; }
.metadata { margin: 0; color: #aaa; font-size: 13px; }
</style>
</head>
<body>
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
