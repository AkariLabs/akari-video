import { ipcRenderer } from 'electron';
import type { PickPayload, ResolvedFrom, viewModeMessage } from '../common/browser-pick';

// Sandboxed preloads cannot require local modules. Keep the runtime entry self-contained.
const CHANNEL_VIEW_MODE = 'AkariBrowserViewMode';
const CHANNEL_VIEW_PICK = 'AkariBrowserViewPick';
const CHANNEL_VIEW_RESOLVE_AT = 'AkariBrowserViewResolveAt';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
function backgroundUrl(value: string): string | undefined {
    if (/image-set\(/iu.test(value)) return undefined;
    const match = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/iu.exec(value);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

let on = false;
let outlineColor: ReturnType<typeof viewModeMessage>['color'] | undefined;
let lastPick = 0;
let outline: HTMLElement | undefined;
let outlineBox: HTMLElement | undefined;

function removeOutline(): void { outline?.remove(); outline = undefined; outlineBox = undefined; }
function showOutline(element: Element): void {
    if (!outline || !outline.isConnected) {
        outline = document.createElement('div');
        outline.style.cssText = 'pointer-events:none;position:absolute;width:100vw;height:100vh;';
        const shadow = outline.attachShadow({ mode: 'closed' });
        outlineBox = document.createElement('div');
        outlineBox.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box;border:3px solid;border-radius:8px;';
        shadow.append(outlineBox); document.documentElement.append(outline);
    }
    const rect = element.getBoundingClientRect();
    Object.assign(outline!.style, { left: `${scrollX}px`, top: `${scrollY}px` });
    if (outlineBox) Object.assign(outlineBox.style, { left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`, borderColor: outlineColor?.accent ?? '',
        boxShadow: outlineColor ? `0 0 0 1px ${outlineColor.edge}` : '' });
}

function candidateAt(x: number, y: number): { element: Element; url: string; resolvedFrom: PickPayload['resolvedFrom'];
    width: number; height: number; alt: string; linkUrl?: string } | undefined {
    for (const element of document.elementsFromPoint(x, y)) {
        if (element === outline) continue;
        const tag = element.tagName.toLowerCase();
        const img = tag === 'picture' ? element.querySelector('img') : element;
        const picture = tag === 'picture' || tag === 'img' && element.parentElement?.tagName.toLowerCase() === 'picture';
        let raw: string | undefined; let resolvedFrom: ResolvedFrom; let width = 0; let height = 0;
        if (img instanceof HTMLImageElement) {
            if (!img.complete || !img.naturalWidth || !img.naturalHeight
                || img.currentSrc.startsWith('data:') && Math.max(img.naturalWidth, img.naturalHeight) <= 1) return undefined;
            raw = img.currentSrc; resolvedFrom = picture ? 'picture' : 'img.currentSrc';
            width = img.naturalWidth; height = img.naturalHeight;
        } else if (['canvas', 'video', 'svg'].includes(tag)) return undefined;
        else {
            const background = getComputedStyle(element).backgroundImage;
            raw = backgroundUrl(background); resolvedFrom = 'background-image';
            if (!raw && background !== 'none') return undefined;
        }
        if (!raw) continue;
        let url: string;
        try { url = new URL(raw, document.baseURI).href; } catch { continue; }
        if (!['http:', 'https:', 'data:', 'blob:'].includes(new URL(url).protocol)) continue;
        const linkUrl = element.closest('a')?.href;
        return { element, url, resolvedFrom: url.startsWith('blob:') ? 'blob' : url.startsWith('data:') ? 'data-uri' : resolvedFrom,
            width, height, alt: img instanceof HTMLImageElement ? img.alt : '', linkUrl };
    }
    return undefined;
}

function unresolvedAt(x: number, y: number): 'not-loaded' | 'unsupported' | undefined {
    for (const element of document.elementsFromPoint(x, y)) {
        const tag = element.tagName.toLowerCase();
        if (['canvas', 'video', 'svg'].includes(tag)) return 'unsupported';
        if (tag === 'img') {
            const img = element as HTMLImageElement;
            if (!img.complete || !img.naturalWidth || !img.naturalHeight
                || img.currentSrc.startsWith('data:') && Math.max(img.naturalWidth, img.naturalHeight) <= 1) return 'not-loaded';
        }
        const background = getComputedStyle(element).backgroundImage;
        if (background !== 'none' && !backgroundUrl(background)) return 'unsupported';
    }
    return undefined;
}

async function payloadAt(x: number, y: number): Promise<PickPayload | 'too-large' | 'network' | undefined> {
    const candidate = candidateAt(x, y);
    if (!candidate) return undefined;
    const base: PickPayload = { kind: 'url', imageUrl: candidate.url, pageUrl: location.href,
        pageTitle: document.title.slice(0, 300), alt: candidate.alt.slice(0, 300), linkUrl: candidate.linkUrl,
        naturalWidth: candidate.width, naturalHeight: candidate.height, resolvedFrom: candidate.resolvedFrom };
    if (candidate.url.startsWith('data:')) return candidate.url.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 200
        ? 'too-large' : { ...base, kind: 'data' };
    if (candidate.url.startsWith('blob:')) {
        try {
            const response = await fetch(candidate.url);
            if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) return 'too-large';
            if (!response.body) return 'network';
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = []; let total = 0;
            for (;;) {
                const part = await reader.read(); if (part.done) break;
                total += part.value.byteLength;
                if (total > MAX_IMAGE_BYTES) { await reader.cancel(); return 'too-large'; }
                chunks.push(part.value);
            }
            const merged = new Uint8Array(total); let offset = 0;
            for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
            const bytes = merged.buffer;
            return { ...base, kind: 'blob', bytes };
        } catch { return 'network'; }
    }
    return base;
}

document.addEventListener('pointermove', event => {
    if (!on || !event.isTrusted) return;
    const candidate = candidateAt(event.clientX, event.clientY);
    if (candidate) showOutline(candidate.element); else removeOutline();
}, true);
document.addEventListener('click', event => {
    if (!on || !event.isTrusted) return;
    const candidate = candidateAt(event.clientX, event.clientY);
    if (!candidate) {
        const unresolved = unresolvedAt(event.clientX, event.clientY);
        if (unresolved) ipcRenderer.send(CHANNEL_VIEW_PICK, { unresolved });
        return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (Date.now() - lastPick < 500) return;
    lastPick = Date.now();
    void payloadAt(event.clientX, event.clientY).then(payload => {
        if (typeof payload === 'string') ipcRenderer.send(CHANNEL_VIEW_PICK, { preloadFailure: payload });
        else if (payload) ipcRenderer.send(CHANNEL_VIEW_PICK, { payload });
        else ipcRenderer.send(CHANNEL_VIEW_PICK, { unresolved: 'not-loaded' });
    });
}, true);
ipcRenderer.on(CHANNEL_VIEW_MODE, (_event, value: { on?: boolean; color?: { accent?: string; edge?: string } }) => {
    const color = value?.color;
    const valid = typeof color?.accent === 'string' && /^#[0-9a-f]{6}$/iu.test(color.accent)
        && typeof color?.edge === 'string' && /^#[0-9a-f]{6}$/iu.test(color.edge);
    outlineColor = valid ? color as ReturnType<typeof viewModeMessage>['color'] : undefined;
    on = value?.on === true && valid;
    if (!on) removeOutline();
});
ipcRenderer.on(CHANNEL_VIEW_RESOLVE_AT, (_event, request: { x: number; y: number; token: string }) => {
    if (!request || !Number.isFinite(request.x) || !Number.isFinite(request.y) || typeof request.token !== 'string') return;
    void payloadAt(request.x, request.y).then(payload => {
        ipcRenderer.send(CHANNEL_VIEW_PICK, { token: request.token, payload: typeof payload === 'string' ? undefined : payload });
    });
});
