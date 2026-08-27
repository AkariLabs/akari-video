import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewService } from '../common/akari-preview-protocol';

interface ImageWidgetMarker extends WebviewWidget {
    akariImageConfigured?: boolean;
    akariImageStreamId?: string;
}

const IMAGE_MIME_TYPES = new Map<string, string>([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp']
]);
// task/2026-08-09-image-open-latency: 旧 base64 data URI 方式は「全読み込み → base64 化 →
// 巨大 HTML 文字列を webview へ IPC 転送」というフロントエンドの同期コストが支配的だったため
// 25MB で弾いていた。動画/音声と同じ assetStream（HTTP レンジ配信、127.0.0.1 ローカルのみ）に
// 揃えたことで setHTML に渡す文字列は URL 1 本になり、そのボトルネックが消えたため引き上げる
// （実測は report.md 参照）。上限自体は「壊れたパスへ streaming server を延々張り続けない」
// ための保険として残す。
const MAX_INLINE_BYTES = 200 * 1024 * 1024;
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

    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    canHandle(uri: URI): number {
        return IMAGE_MIME_TYPES.has(uri.path.ext.toLowerCase()) ? 1100 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const identifier = { id: `akari-image-${this.hash(uri.toString())}`, viewId: uri.toString() };
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, identifier);
        this.configureWidget(widget);
        await this.render(widget, uri);
        if (!widget.isAttached) {
            this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }

    protected configureWidget(widget: WebviewWidget): void {
        const marker = widget as ImageWidgetMarker;
        if (marker.akariImageConfigured) {
            return;
        }
        marker.akariImageConfigured = true;
        widget.disposed.connect(() => {
            void this.disposeImageStream(marker);
        });
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        const marker = widget as ImageWidgetMarker;
        widget.viewType = 'akari.image';
        widget.title.label = uri.path.base;
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-file-media';
        widget.setContentOptions({ allowScripts: false, allowForms: false });

        // A widget can be re-rendered for the same URI (re-open of an already open tab); drop
        // any stream left over from the previous render before requesting a new one so the
        // backend never accumulates orphaned asset streams for one widget.
        await this.disposeImageStream(marker);
        if (widget.isDisposed) {
            return;
        }

        try {
            const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
            if (typeof stat.size === 'number' && stat.size > MAX_INLINE_BYTES) {
                widget.setHTML(this.messageHtml(TOO_LARGE_MESSAGE));
                return;
            }
            const stream = await this.previewService.createAssetStream({
                assetUri: uri.toString(),
                workspaceRoots: await this.currentWorkspaceRoots()
            });
            if (widget.isDisposed) {
                await this.disposeImageStreamId(stream.id);
                return;
            }
            marker.akariImageStreamId = stream.id;
            widget.setHTML(this.imageHtml(uri, stream.url));
        } catch (error) {
            console.warn(`[akari-preview] failed to open image ${uri.toString()}`, error);
            widget.setHTML(this.messageHtml(READ_ERROR_MESSAGE));
        }
    }

    protected async disposeImageStream(marker: ImageWidgetMarker): Promise<void> {
        const id = marker.akariImageStreamId;
        marker.akariImageStreamId = undefined;
        if (id) {
            await this.disposeImageStreamId(id);
        }
    }

    protected async currentWorkspaceRoots(): Promise<string[]> {
        try {
            return (await this.workspaceService.roots).map(root => root.resource.toString());
        } catch {
            return [];
        }
    }

    protected async disposeImageStreamId(id: string): Promise<void> {
        try {
            await this.previewService.disposeAssetStream(id);
        } catch (error) {
            console.warn(`[akari-preview] failed to dispose image stream ${id}`, error);
        }
    }

    protected imageHtml(uri: URI, sourceUrl: string): string {
        const origin = new URL(sourceUrl).origin;
        return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.escapeHtml(origin)}; style-src 'unsafe-inline'">
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html, body { width: 100%; height: 100%; margin: 0; background: #111; overflow: auto; }
body { display: grid; place-items: center; padding: 16px; }
img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
</head>
<body>
<img src="${this.escapeHtml(sourceUrl)}" alt="${this.escapeHtml(uri.path.base)}">
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
