import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';

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
const TOO_LARGE_MESSAGE = '大きすぎるためアプリ内で再生できません。';
const PLAYBACK_ERROR_MESSAGE = 'このファイルはアプリ内で再生できません。';

@injectable()
export class AkariAudioOpenHandler implements OpenHandler {
    readonly id = 'akari-audio-open-handler';

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    canHandle(uri: URI): number {
        return AUDIO_MIME_TYPES.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-audio-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        await this.render(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
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
            if (fileSize !== undefined && fileSize > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(uri, TOO_LARGE_MESSAGE, fileSize));
                return;
            }

            const content = await this.fileService.readFile(uri);
            const bytes = content.value.buffer;
            fileSize = bytes.length;
            if (fileSize > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(uri, TOO_LARGE_MESSAGE, fileSize));
                return;
            }

            const dataUri = `data:${mimeType};base64,${this.toBase64(bytes)}`;
            widget.setHTML(this.audioHtml(uri, dataUri, fileSize));
        } catch (error) {
            console.warn(`[akari-preview] failed to read audio ${uri.toString()}`, error);
            widget.setHTML(this.messageHtml(uri, PLAYBACK_ERROR_MESSAGE, fileSize));
        }
    }

    protected audioHtml(uri: URI, dataUri: string, fileSize: number): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
:root { color-scheme: dark; font-family: system-ui, sans-serif; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; color: #eee; }
body { display: grid; place-items: center; padding: 32px; }
.card { width: min(560px, 100%); padding: 28px; border: 1px solid #383838; border-radius: 12px; background: #1b1b1b; box-shadow: 0 12px 32px rgb(0 0 0 / 24%); }
.name { margin: 0 0 8px; overflow-wrap: anywhere; font-size: 16px; font-weight: 600; }
.metadata { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 22px; color: #aaa; font-size: 13px; }
audio { display: block; width: 100%; }
.message { margin: 0 0 16px; line-height: 1.7; font-size: 15px; }
[hidden] { display: none; }
</style>
</head>
<body>
<main class="card">
<section id="player-card">
<p class="name">${this.escapeHtml(uri.path.base)}</p>
<p class="metadata"><span>実尺: <span id="duration">読み込み中</span></span><span>サイズ: ${this.escapeHtml(this.formatBytes(fileSize))}</span></p>
<audio id="audio" controls preload="metadata" data-source="${this.escapeHtml(dataUri)}"></audio>
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

    const showError = () => {
        playerCard.hidden = true;
        errorCard.hidden = false;
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
    audio.addEventListener('error', showError);

    const source = audio.dataset.source;
    audio.removeAttribute('data-source');
    if (source) {
        audio.src = source;
        audio.load();
    } else {
        showError();
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
