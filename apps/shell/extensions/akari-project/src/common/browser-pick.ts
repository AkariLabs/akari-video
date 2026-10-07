import { safeImageUrl } from './ssrf-guard';

export const ORIGINAL_URL_PARAMS = ['imgurl', 'mediaurl'] as const;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const PICK_OUTLINE_COLOR = { accent: '#f97316', edge: '#261b16' } as const;
export function viewModeMessage(on: boolean): { on: boolean; color: typeof PICK_OUTLINE_COLOR } {
    return { on, color: PICK_OUTLINE_COLOR };
}

export function isReplacedBrowserNavigation(error: unknown,
    state: { windowAlive: boolean; viewAlive: boolean; blocked: boolean }): boolean {
    if (!state.windowAlive || !state.viewAlive || state.blocked || !error || typeof error !== 'object') return false;
    const value = error as { code?: unknown; errno?: unknown; message?: unknown };
    if (value.code !== undefined && value.code !== 'ERR_ABORTED' && value.code !== -3
        || value.errno !== undefined && value.errno !== -3) return false;
    return value.code === 'ERR_ABORTED' || value.code === -3 || value.errno === -3
        || typeof value.message === 'string' && /^(?:Error:\s*)?ERR_ABORTED \(-3\) loading(?:\s|$)/u.test(value.message);
}
export type ContextMenuAction = 'pick' | 'separator' | 'copy-image' | 'copy-image-address' | 'copy-link-address'
    | 'back' | 'forward' | 'reload' | 'copy' | 'selectAll';
export function contextMenuActions(hasPick: boolean, hasImage: boolean, hasLink: boolean): ContextMenuAction[] {
    return [...(hasPick ? ['pick', 'separator'] as ContextMenuAction[] : []),
        ...(hasImage ? ['copy-image', 'copy-image-address'] as ContextMenuAction[] : []),
        ...(hasLink ? ['copy-link-address'] as ContextMenuAction[] : []),
        'back', 'forward', 'reload', 'separator', 'copy', 'selectAll'];
}

export type PickKind = 'url' | 'data' | 'blob';
export type ResolvedFrom = 'img.currentSrc' | 'picture' | 'background-image' | 'data-uri' | 'blob' | 'context-menu';
export interface PickPayload {
    kind: PickKind; imageUrl?: string; bytes?: ArrayBuffer; pageUrl: string; pageTitle: string; alt: string;
    linkUrl?: string; naturalWidth: number; naturalHeight: number; resolvedFrom: ResolvedFrom;
}

export function validatePickPayload(input: unknown): PickPayload | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const p = input as Record<string, unknown>;
    if (!['url', 'data', 'blob'].includes(String(p.kind)) || typeof p.pageUrl !== 'string' || p.pageUrl.length > 2048
        || typeof p.pageTitle !== 'string' || p.pageTitle.length > 300 || typeof p.alt !== 'string' || p.alt.length > 300
        || p.linkUrl !== undefined && (typeof p.linkUrl !== 'string' || p.linkUrl.length > 2048)
        || !Number.isFinite(p.naturalWidth) || !Number.isFinite(p.naturalHeight)
        || Number(p.naturalWidth) < 0 || Number(p.naturalHeight) < 0
        || !['img.currentSrc', 'picture', 'background-image', 'data-uri', 'blob', 'context-menu'].includes(String(p.resolvedFrom))) return undefined;
    try { const page = new URL(p.pageUrl); if (!['http:', 'https:'].includes(page.protocol)) return undefined; }
    catch { return undefined; }
    if (p.linkUrl !== undefined) {
        try { if (!['http:', 'https:'].includes(new URL(p.linkUrl as string).protocol)) return undefined; }
        catch { return undefined; }
    }
    if (p.imageUrl !== undefined) {
        if (typeof p.imageUrl !== 'string' || p.imageUrl.length > (p.kind === 'data' ? MAX_IMAGE_BYTES * 1.4 : 2048)) return undefined;
        try { if (!['http:', 'https:', 'data:', 'blob:'].includes(new URL(p.imageUrl).protocol)) return undefined; }
        catch { return undefined; }
        const protocol = new URL(p.imageUrl).protocol;
        if (p.kind === 'url' && !['http:', 'https:'].includes(protocol)
            || p.kind === 'data' && protocol !== 'data:' || p.kind === 'blob' && protocol !== 'blob:') return undefined;
    }
    if (p.bytes !== undefined && (!(p.bytes instanceof ArrayBuffer) || p.bytes.byteLength > MAX_IMAGE_BYTES)) return undefined;
    if (p.kind === 'blob' && !(p.bytes instanceof ArrayBuffer) || p.kind !== 'blob' && p.bytes !== undefined
        || p.kind !== 'blob' && typeof p.imageUrl !== 'string') return undefined;
    return { kind: p.kind as PickKind, imageUrl: p.imageUrl as string | undefined, bytes: p.bytes as ArrayBuffer | undefined,
        pageUrl: p.pageUrl, pageTitle: p.pageTitle, alt: p.alt, linkUrl: p.linkUrl as string | undefined,
        naturalWidth: Number(p.naturalWidth), naturalHeight: Number(p.naturalHeight), resolvedFrom: p.resolvedFrom as ResolvedFrom };
}

export function validatedViewPick(event: { sender: unknown; senderFrame: unknown },
    state: { webContents: { mainFrame: unknown }; pickMode: boolean } | undefined,
    input: { token?: unknown; payload?: unknown } | undefined, rightClickToken?: string): PickPayload | undefined {
    if (!state || event.sender !== state.webContents || event.senderFrame !== state.webContents.mainFrame
        || !(state.pickMode && !input?.token || rightClickToken && input?.token === rightClickToken)) return undefined;
    return validatePickPayload(input?.payload);
}

export function originalUrlHint(linkUrl: string | undefined, allowLoopbackForTest = false):
    { url: string; param: typeof ORIGINAL_URL_PARAMS[number] } | undefined {
    if (!linkUrl || linkUrl.length > 2048) return undefined;
    try {
        const link = new URL(linkUrl);
        if (!['http:', 'https:'].includes(link.protocol)) return undefined;
        for (const param of ORIGINAL_URL_PARAMS) {
            const raw = link.searchParams.get(param);
            if (!raw || raw.length > 2048 || /%[0-9a-f]{2}/iu.test(raw)) continue;
            const candidate = new URL(raw);
            if (safeImageUrl(raw, allowLoopbackForTest) && candidate.href === raw) return { url: raw, param };
        }
    } catch { /* malformed hint */ }
    return undefined;
}

export function imageQuality(width: number, height: number, dataBytes?: number): 'thumbnail' | 'full' | 'unknown' {
    if (dataBytes !== undefined && dataBytes < 30 * 1024) return 'thumbnail';
    if (!width || !height) return 'unknown';
    return Math.max(width, height) < 480 ? 'thumbnail' : 'full';
}

export type ImageElementModel = { tag: string; currentSrc?: string; complete?: boolean; naturalWidth?: number;
    naturalHeight?: number; backgroundImage?: string; picture?: boolean };
export type ImageResolution = { status: 'found'; url: string; resolvedFrom: ResolvedFrom; width: number; height: number }
    | { status: 'not-loaded' | 'unsupported' | 'none' };

export function firstBackgroundUrl(value: string): string | undefined {
    if (/image-set\(/iu.test(value)) return undefined;
    const match = /url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/iu.exec(value);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function resolveImageModel(model: ImageElementModel): ImageResolution {
    const tag = model.tag.toLowerCase();
    if (['canvas', 'video', 'svg'].includes(tag)) return { status: 'unsupported' };
    if (tag === 'img' || tag === 'picture') {
        const url = model.currentSrc;
        if (!url || !model.complete || !model.naturalWidth || !model.naturalHeight
            || url.startsWith('data:') && Math.max(model.naturalWidth, model.naturalHeight) <= 1) return { status: 'not-loaded' };
        return { status: 'found', url, resolvedFrom: tag === 'picture' || model.picture ? 'picture' : 'img.currentSrc',
            width: model.naturalWidth, height: model.naturalHeight };
    }
    const url = model.backgroundImage && firstBackgroundUrl(model.backgroundImage);
    return url ? { status: 'found', url, resolvedFrom: 'background-image', width: 0, height: 0 }
        : model.backgroundImage && model.backgroundImage !== 'none' ? { status: 'unsupported' } : { status: 'none' };
}
