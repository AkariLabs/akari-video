import { MaterialPreviewSlot } from './material-preview-slot';
import URI from '@theia/core/lib/common/uri';
import { ApplicationShell, OpenHandler, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WebviewWidget } from '@theia/plugin-ext/lib/main/browser/webview/webview';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { AkariPreviewService, OverlayRuntimeAssetUrls } from '../common/akari-preview-protocol';

@injectable()
export class AkariFragmentPreviewOpenHandler implements OpenHandler {
    readonly id = 'akari-fragment-preview-open-handler';

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

    // 同じタブへの連続クリックでも初期化とストリーム発行は一度だけ行う。
    protected readonly renders = new WeakMap<WebviewWidget, Promise<void>>();

    async canHandle(uri: URI): Promise<number> {
        if (uri.path.base !== 'fragment.html') {
            return 0;
        }
        try {
            return await this.fileService.exists(uri.parent.resolve('meta.json')) ? 1500 : 0;
        } catch {
            return 0;
        }
    }

    async open(uri: URI, _options?: any): Promise<WebviewWidget> {
        const widget = await this.widgetManager.getOrCreateWidget<WebviewWidget>(WebviewWidget.FACTORY_ID, {
            id: `akari-fragment-preview-${this.hash(uri.toString())}`, viewId: uri.toString()
        });
        let render = this.renders.get(widget);
        if (!render) {
            render = this.render(widget, uri);
            this.renders.set(widget, render);
        }
        await render;
        if (!widget.isDisposed) {
            await this.materialSlot.claim(widget, uri);
            await this.shell.activateWidget(widget.id);
        }
        return widget;
    }

    protected async render(widget: WebviewWidget, uri: URI): Promise<void> {
        widget.viewType = 'akari.fragmentPreview';
        widget.title.label = '素材プレビュー';
        widget.title.caption = uri.toString();
        widget.title.iconClass = 'codicon codicon-symbol-misc';
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
            const html = (await this.fileService.readFile(uri)).value.toString();
            const assets = await this.previewService.getOverlayRuntimeAssetUrls();
            const result = await this.previewService.rewriteFragmentAssets({
                projectRootUri: uri.parent.toString(), html, htmlPath: 'fragment.html', overlayId: 'asset',
                workspaceRoots: await this.currentWorkspaceRoots()
            });
            streamIds = result.streams.map(stream => stream.id);
            if (widget.isDisposed) {
                await release();
                return;
            }
            widget.setHTML(this.previewHtml(result.html, assets, `${uri.parent.path.base}/fragment.html`));
        } catch (error) {
            await release();
            console.warn(`[akari-preview] failed to open ${uri.toString()}`, error);
            if (!widget.isDisposed) {
                widget.setHTML(this.messageHtml('断片プレビューを読み込めませんでした。'));
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

    protected previewHtml(html: string, assets: OverlayRuntimeAssetUrls, filename = 'fragment.html'): string {
        const output = { width: 1920, height: 1080, fps: 30 };
        const duration = 5;
        const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
        const scripts = [assets.threeJavaScriptUrl, assets.threeTextJavaScriptUrl,
            assets.threeRuntimeJavaScriptUrl, assets.runtimeJavaScriptUrl];
        return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@font-face{font-family:AkariCaption;src:url("${this.escapeHtml(assets.captionFontUrl)}")}
:root{color-scheme:dark;font-family:system-ui,sans-serif;color:#eee;background:#111}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{display:flex;flex-direction:column}[hidden]{display:none!important}
.akari-material-chip { position: absolute; top: 8px; left: 8px; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: rgba(0,0,0,.55); color: #fff; pointer-events: none; z-index: 10 }
#viewport{flex:1;min-height:0;position:relative;overflow:hidden}
#canvas{position:absolute;overflow:hidden;background-color:#fff;
background-image:conic-gradient(#ccc 25%,transparent 0 50%,#ccc 0 75%,transparent 0);background-size:24px 24px}
#canvas[data-background=white]{background:#fff}#canvas[data-background=black]{background:#000}
#overlay-stage{position:absolute;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;font-family:AkariCaption,sans-serif}
#controls{display:flex;gap:12px;align-items:center;padding:12px;flex-wrap:wrap}
#seek{flex:1;min-width:80px}button,select{font:inherit}#time{font-variant-numeric:tabular-nums}
#error{margin:auto;padding:32px;text-align:center;line-height:1.7}
</style></head><body>
<div id="viewport"><div class="akari-material-chip">${this.escapeHtml(filename)}</div><div id="canvas" data-background="checker"><div id="overlay-stage"></div></div></div>
<div id="controls"><button id="play" type="button" disabled>再生</button>
<input id="seek" aria-label="再生位置" type="range" min="0" max="${duration}" step="0.01" value="0" disabled>
<output id="time">0.00 / 5.00 s</output><label>背景 <select id="background">
<option value="checker">市松</option><option value="white">白</option><option value="black">黒</option>
</select></label></div><p id="error" role="alert" hidden></p>
${scripts.map(url => `<script src="${this.escapeHtml(url)}"></script>`).join('')}
<script>
(async()=>{
 const viewport=document.getElementById('viewport'),canvas=document.getElementById('canvas');
 const stage=document.getElementById('overlay-stage'),play=document.getElementById('play');
 const seek=document.getElementById('seek'),time=document.getElementById('time');
 const fit=()=>{
   const scale=Math.min(viewport.clientWidth/${output.width},viewport.clientHeight/${output.height},1);
   const width=${output.width}*scale,height=${output.height}*scale;
   Object.assign(canvas.style,{width:width+'px',height:height+'px',left:(viewport.clientWidth-width)/2+'px',top:(viewport.clientHeight-height)/2+'px'});
   stage.style.transform='scale('+scale+')';
 };
 const observer=new ResizeObserver(fit);observer.observe(viewport);fit();
 document.getElementById('background').addEventListener('change',event=>{canvas.dataset.background=event.target.value;});
 let runtime,playing=false,t=0,last=0,raf=0;
 const stop=()=>{playing=false;cancelAnimationFrame(raf);play.textContent='再生';};
 const fail=error=>{
   stop();play.disabled=true;seek.disabled=true;viewport.hidden=true;document.getElementById('controls').hidden=true;
   const message=document.getElementById('error');message.hidden=false;message.textContent='断片プレビューを読み込めませんでした。';
   console.error(error);
 };
 window.addEventListener('pagehide',()=>{stop();observer.disconnect();runtime?.unmount();});
 try{
   runtime=window.akari.createOverlayRuntime({premount:true});
   window.akari.threeRuntime?.configure({defaultFontUrl:${json(assets.captionFontUrl)}});
   runtime.configure({premount:true});
   await runtime.mount(${json({ overlays: [{ id: 'asset', html, start: 0, duration }], output })});
   const draw=()=>{runtime.tick(t,false);seek.value=String(t);time.textContent=t.toFixed(2)+' / 5.00 s';};
   const step=now=>{
     if(!playing)return;
     t=(t+(now-last)/1000)%${duration};last=now;
     try{draw();raf=requestAnimationFrame(step);}catch(error){fail(error);}
   };
   play.addEventListener('click',()=>{
     if(playing){stop();return;}
     playing=true;play.textContent='一時停止';last=performance.now();raf=requestAnimationFrame(step);
   });
   seek.addEventListener('input',()=>{t=Number(seek.value);last=performance.now();try{draw();}catch(error){fail(error);}});
   draw();play.disabled=false;seek.disabled=false;
 }catch(error){fail(error);}
})();
</script></body></html>`;
    }
}
