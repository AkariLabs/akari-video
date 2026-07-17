import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { inject, injectable } from '@theia/core/shared/inversify';

const IMAGE_MIME_TYPES = new Map<string, string>([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp']
]);
const MAX_INLINE_BYTES = 25 * 1024 * 1024;
const TOO_LARGE_MESSAGE = 'この画像はサイズが大きすぎるためプレビューできません。';
const READ_ERROR_MESSAGE = '画像を読み込めませんでした。';

@injectable()
export class AkariImageOpenHandler implements OpenHandler {
    readonly id = 'akari-image-open-handler';

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(FileService)
    protected readonly fileService: FileService;

    canHandle(uri: URI): number {
        return IMAGE_MIME_TYPES.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-image-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        await this.render(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        widget.viewType = 'akari.image';
        widget.title.label = uri.path.base;
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-file-media';
        widget.setContentOptions({ allowScripts: false, allowForms: false });

        const mimeType = IMAGE_MIME_TYPES.get(uri.path.ext.toLowerCase()) ?? 'application/octet-stream';
        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            if (typeof stat.size === 'number' && stat.size > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(TOO_LARGE_MESSAGE));
                return;
            }
            const content = await this.fileService.readFile(uri);
            const dataUri = `data:${mimeType};base64,${this.toBase64(content.value.buffer)}`;
            widget.setHTML(this.imageHtml(uri, dataUri));
        } catch (error) {
            console.warn(`[akari-preview] failed to read image ${uri.toString()}`, error);
            widget.setHTML(this.messageHtml(READ_ERROR_MESSAGE));
        }
    }

    protected imageHtml(uri: URI, dataUri: string): string {
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; overflow: auto; }
body { display: grid; place-items: center; padding: 16px; }
img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>
<img src="${this.escapeHtml(dataUri)}" alt="${this.escapeHtml(uri.path.base)}">
</body>
</html>`;
    }

    protected messageHtml(message: string): string {
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
p { max-width: 480px; margin: 0; text-align: center; line-height: 1.7; font-size: 15px; }
</style>
</head>
<body><p>${this.escapeHtml(message)}</p></body>
</html>`;
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
