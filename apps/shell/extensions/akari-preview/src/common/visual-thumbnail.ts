import type { OverlayRuntimeAssetUrls } from './akari-preview-protocol';

export interface VisualThumbnailContentRect { x: number; y: number; width: number; height: number; }

/** Capture result; contentRect uses page.width × page.height coordinates. */
export interface VisualThumbnailCapture {
    image: string;
    contentRect?: VisualThumbnailContentRect;
}

export interface VisualThumbnailRequest {
    editUri: string;
    itemId: string;
    editSnapshot: string;
}

export interface VisualThumbnailPage {
    html: string;
    width: number;
    height: number;
    streamIds: string[];
    dependencyUris: string[];
    /** Exact edit input consumed by the renderer, for the caller's cache identity check. */
    editSnapshot?: string;
}

/** A separate, one-shot host for the same renderer used by the active preview. */
export function visualThumbnailPage(
    overlays: readonly Record<string, unknown>[], output: { width: number; height: number; fps: number },
    time: number, assets: OverlayRuntimeAssetUrls
): Omit<VisualThumbnailPage, 'streamIds' | 'dependencyUris'> {
    const scale = Math.min(480 / output.width, 320 / output.height, 1);
    const width = Math.max(1, Math.round(output.width * scale));
    const height = Math.max(1, Math.round(output.height * scale));
    const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
    const attr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const scripts = [assets.threeJavaScriptUrl, assets.threeTextJavaScriptUrl,
        assets.threeRuntimeJavaScriptUrl, assets.runtimeJavaScriptUrl];
    return { width, height, html: `<!doctype html><html><head><meta charset="utf-8">
<style>@font-face{font-family:AkariCaption;src:url("${attr(assets.captionFontUrl)}")}
html,body{margin:0;overflow:hidden;background:transparent;font-family:AkariCaption,sans-serif}
#overlay-stage{position:absolute;width:${output.width}px;height:${output.height}px;transform-origin:0 0;transform:scale(${scale});overflow:hidden}
</style></head><body><div id="overlay-stage"></div>
${scripts.map(url => `<script src="${attr(url)}"></script>`).join('')}
<script>
window.__akariThumbnailReady=(async()=>{
 const runtime=window.akari.createOverlayRuntime({premount:false,maxRenderSize:480});
 window.akari.threeRuntime?.configure({defaultFontUrl:${json(assets.captionFontUrl)}});
 runtime.configure({premount:false,maxRenderSize:480});
 await runtime.mount(${json({ overlays, output })});
 runtime.tick(${json(time)},false);
 const activeContainers=()=>[...document.querySelectorAll('[data-overlay-id][data-akari-active]')];
 const waitForImages=async()=>{
   const urls=new Set();
   const elements=activeContainers().flatMap(container=>[container,...container.querySelectorAll('*')]);
   for(const element of elements) for(const pseudo of [null,'::before','::after']){
     const style=getComputedStyle(element,pseudo);
     for(const value of [style.backgroundImage,style.maskImage,style.borderImageSource,style.content,style.listStyleImage]){
       for(const match of value.matchAll(/url\\(\\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\\s*\\)/g)) urls.add(match[1]??match[2]??match[3]);
     }
   }
   await Promise.all([...elements.filter(el=>el.tagName==='IMG').map(img=>img.decode()),
     ...[...urls].map(url=>{const img=new Image();img.src=url;return img.decode();})]);
 };
 await waitForImages();
 await document.fonts.ready;
 const deadline=performance.now()+15000;
 while(true){
   const states=activeContainers().flatMap(container=>
     window.akari.runtimes.forContainer(container).map(r=>r.inspect(container)));
   if(states.some(s=>s.status==='error'||s.status==='failed'||s.status==='disposed')) throw Error('Visual renderer failed');
   if(states.every(s=>!s.status||s.status==='ready')) break;
   if(performance.now()>deadline) throw Error('Visual renderer readiness timed out');
   await new Promise(r=>setTimeout(r,30));
 }
 runtime.tick(${json(time)},false);
 await waitForImages();
 await document.fonts.ready;
 await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 return true;
})();
</script></body></html>` };
}
