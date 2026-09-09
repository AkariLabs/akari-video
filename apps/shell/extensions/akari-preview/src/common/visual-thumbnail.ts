import type { OverlayRuntimeAssetUrls } from './akari-preview-protocol';

export interface VisualThumbnailContentRect { x: number; y: number; width: number; height: number; }

/** Capture result; contentRect uses page.width × page.height coordinates. */
export interface VisualThumbnailCapture {
    image: string;
    contentRect?: VisualThumbnailContentRect;
    /** Content-cropped copy of the same capture. The band paints this; hover never does. */
    croppedImage?: string;
}

export interface VisualThumbnailRequest {
    editUri: string;
    itemId: string;
    editSnapshot: string;
}

export interface VisualThumbnailPage {
    html: string;
    sampleTimes: number[];
    width: number;
    height: number;
    streamIds: string[];
    dependencyUris: string[];
    /** Exact edit input consumed by the renderer, for the caller's cache identity check. */
    editSnapshot?: string;
}

/** Midpoint first preserves static thumbnails; earlier samples catch exit animations. Times are seconds. */
export function visualThumbnailSampleTimes(start: number, duration: number): number[] {
    if (!Number.isFinite(start)) return [];
    const end = start + duration;
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(end) || end <= start) return [start];
    // Leave the exclusive end representably, including very short clips.
    const last = Math.max(start, end - Math.max(Number.MIN_VALUE, Math.abs(end) * Number.EPSILON));
    return [...new Set([start + duration / 2, start + duration / 4, start + 0.8, start + 0.2]
        .map(time => Math.max(start, Math.min(last, time))))];
}

/** A separate host for the same renderer used by the active preview, with reusable seeks. */
export function visualThumbnailPage(
    overlays: readonly Record<string, unknown>[], output: { width: number; height: number; fps: number },
    times: number | readonly number[], assets: OverlayRuntimeAssetUrls
): Omit<VisualThumbnailPage, 'streamIds' | 'dependencyUris'> {
    const sampleTimes = typeof times === 'number' ? [times] : [...times];
    const time = sampleTimes[0];
    const scale = Math.min(480 / output.width, 320 / output.height, 1);
    const width = Math.max(1, Math.round(output.width * scale));
    const height = Math.max(1, Math.round(output.height * scale));
    const json = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
    const attr = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const scripts = [assets.threeJavaScriptUrl, assets.threeTextJavaScriptUrl,
        assets.threeRuntimeJavaScriptUrl, assets.runtimeJavaScriptUrl];
    return { width, height, sampleTimes, html: `<!doctype html><html><head><meta charset="utf-8">
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
 window.__akariThumbnailSeek=async(t)=>{
   runtime.tick(t,false);
   await waitForImages();
   await document.fonts.ready;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return true;
 };
 return window.__akariThumbnailSeek(${json(time)});
})();
</script></body></html>` };
}
