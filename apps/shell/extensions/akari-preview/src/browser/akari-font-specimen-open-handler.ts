import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewService } from '../common/akari-preview-protocol';

@injectable()
export class AkariFontSpecimenOpenHandler implements OpenHandler {
    readonly id = 'akari-font-specimen-open-handler';

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;
    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;
    @inject(AkariPreviewService)
    protected readonly previewService: AkariPreviewService;
    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    // 同じタブへの連続クリックでも初期化とストリーム発行は一度だけ行う。
    protected readonly renders = new WeakMap<WebviewWidget, Promise<void>>();

    canHandle(uri: URI): number {
        return ['.ttf', '.otf', '.woff2'].includes(uri.path.ext.toLowerCase()) ? 1200 : 0;
    }

    async open(uri: URI, options?: any): Promise<WebviewWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, {
            id: `akari-font-specimen-${this.hash(uri.toString())}`, viewId: uri.toString()
        });
        let render = this.renders.get(widget);
        if (!render) {
            render = this.render(widget, uri);
            this.renders.set(widget, render);
        }
        await render;
        if (!widget.isDisposed) {
            if (!widget.isAttached) {
                this.shell.addWidget(widget, options?.widgetOptions ?? { area: 'main' });
            }
            await this.shell.activateWidget(widget.id);
        }
        return widget;
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        widget.viewType = 'akari.fontSpecimen';
        widget.title.label = uri.path.base;
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-text-size';
        widget.setContentOptions({ allowScripts: true, allowForms: false });
        let streamIds: string[] = [];
        const release = async (): Promise<void> => {
            const ids = streamIds;
            streamIds = [];
            await Promise.all(ids.map(async id => {
                try {
                    await this.previewService.disposeAssetStream(id);
                } catch (error) {
                    console.warn(`[akari-preview] failed to dispose asset stream ${id}`, error);
                }
            }));
        };
        widget.disposed.connect(() => { void release(); });
        try {
            const stream = await this.previewService.createAssetStream({
                assetUri: uri.toString(), workspaceRoots: await this.currentWorkspaceRoots()
            });
            streamIds = [stream.id];
            if (widget.isDisposed) {
                await release();
                return;
            }
            widget.setHTML(this.specimenHtml(stream.url));
        } catch (error) {
            await release();
            console.warn(`[akari-preview] failed to open ${uri.toString()}`, error);
            if (!widget.isDisposed) {
                widget.setHTML(this.messageHtml('書体を読み込めませんでした。'));
            }
            this.renders.delete(widget);
        }
    }

    protected async currentWorkspaceRoots(): Promise<string[]> {
        try {
            return (await this.workspaceService.roots).map(root => root.resource.toString());
        } catch {
            return [];
        }
    }

    protected messageHtml(message: string): string {
        return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{color-scheme:dark;font-family:system-ui,sans-serif}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#111;color:#eee}
body{display:grid;place-items:center;padding:32px}p{max-width:480px;text-align:center;line-height:1.7}</style>
</head><body><p>${this.escapeHtml(message)}</p></body></html>`;
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
        return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    protected specimenHtml(sourceUrl: string): string {
        const origin = this.escapeHtml(new URL(sourceUrl).origin);
        const rows = ['あア亜 永久 憂鬱', 'AKARI', '123'];
        return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${origin}; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
@font-face{font-family:AkariSpecimen;src:url("${this.escapeHtml(sourceUrl)}")}
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111;color:#eee}
*{box-sizing:border-box}body{margin:0;padding:24px}label{display:block;margin-bottom:24px}
input{display:block;width:100%;margin-top:8px;padding:8px;font:inherit}
section{border-top:1px solid #444;padding:16px 0}h2{font:14px system-ui,sans-serif;color:#aaa}
p{font-family:AkariSpecimen;margin:12px 0;line-height:1.4;overflow-wrap:anywhere;white-space:pre-wrap}
</style></head><body><label>試し打ち<input id="sample" type="text" placeholder="文字を入力してください"></label>
${[24, 48, 96].map(size => `<section><h2>${size}px</h2>${rows.map(row =>
            `<p style="font-size:${size}px">${row}</p>`).join('')}<p class="custom" style="font-size:${size}px" hidden></p></section>`).join('')}
<p id="error" role="alert" hidden></p>
<script>
document.getElementById('sample').addEventListener('input',event=>{
 for(const row of document.querySelectorAll('.custom')){row.textContent=event.target.value;row.hidden=!event.target.value;}
});
document.fonts.load('24px AkariSpecimen').catch(()=>{
 const error=document.getElementById('error');error.textContent='書体を読み込めませんでした。';error.hidden=false;
});
</script></body></html>`;
    }
}
