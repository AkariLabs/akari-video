import { imageQuality } from './browser-pick';
import { detectInjectionSuspect, sanitizeExternalText } from './external-text';

export const SCRATCH_ID = /^\d{8}-\d{6}-[a-f0-9]{6}$/u;
export type ScratchStatus = 'ready' | 'url_only';
export interface ScratchSource {
    schema: 'akari.scratch-intake/v0'; id: string; status: ScratchStatus; captured_at: string;
    via: 'browser:pick' | 'browser:contextmenu';
    app: { page_host: string; image_host: string | null; resolved_from: string; mime: string | null;
        bytes: number | null; width: number | null; height: number | null; sha256: string | null;
        quality: 'thumbnail' | 'full' | 'unknown'; search: { engine: string; query: string } | null };
    external: { page_url: string; image_url: string | null; link_url: string | null; page_title: string; alt: string };
    license: { kind: 'unknown'; hint: string | null; source_license: null;
        attribution: { required: null; creator: null; creator_url: null }; ai_input: 'unknown' };
    user: { note: null; ack: null; pinned: boolean };
    lifecycle: { expires_at: string; promoted_to: null };
    flags: string[];
}

export function hostOf(raw: string | undefined): string {
    try { return raw ? new URL(raw).hostname.toLowerCase() : ''; } catch { return ''; }
}
export function licenseHint(pageHost: string, imageHost: string): string | null {
    const names = ['unsplash.com', 'pexels.com', 'pixabay.com', 'commons.wikimedia.org', 'upload.wikimedia.org'];
    const host = [pageHost, imageHost].find(value => names.some(name => value === name || value.endsWith(`.${name}`)));
    return host ? `domain:${host}` : null;
}
export function scratchLabel(app: ScratchSource['app'], engineName?: string): string {
    if (app.search) return `画像（${engineName ?? app.search.engine}「${app.search.query.slice(0, 30)}」）`;
    return `画像（${app.page_host}）`;
}
export function makeScratchSource(input: {
    id: string; status: ScratchStatus; capturedAt: Date; via: ScratchSource['via']; pageUrl: string;
    imageUrl?: string; linkUrl?: string; pageTitle: string; alt: string; resolvedFrom: string;
    mime?: string; bytes?: number; width?: number; height?: number; sha256?: string;
    search?: { engine: string; query: string } | null; dataBytes?: number;
}): ScratchSource {
    const pageHost = hostOf(input.pageUrl); const imageHost = hostOf(input.imageUrl);
    const suspicious = detectInjectionSuspect(input.pageTitle) || detectInjectionSuspect(input.alt);
    return { schema: 'akari.scratch-intake/v0', id: input.id, status: input.status,
        captured_at: isoLocal(input.capturedAt), via: input.via,
        app: { page_host: pageHost, image_host: imageHost || null, resolved_from: input.resolvedFrom,
            mime: input.mime ?? null, bytes: input.bytes ?? null, width: input.width ?? null, height: input.height ?? null,
            sha256: input.sha256 ?? null, quality: input.status === 'ready'
                ? imageQuality(input.width ?? 0, input.height ?? 0, input.dataBytes) : 'unknown',
            search: input.search ?? null },
        external: { page_url: sanitizeExternalText(input.pageUrl, 2048),
            image_url: input.imageUrl ? sanitizeExternalText(input.imageUrl, 2048) : null,
            link_url: input.linkUrl ? sanitizeExternalText(input.linkUrl, 2048) : null,
            page_title: sanitizeExternalText(input.pageTitle, 300), alt: sanitizeExternalText(input.alt, 300) },
        license: { kind: 'unknown', hint: licenseHint(pageHost, imageHost), source_license: null,
            attribution: { required: null, creator: null, creator_url: null }, ai_input: 'unknown' },
        user: { note: null, ack: null, pinned: false },
        lifecycle: { expires_at: isoLocal(new Date(input.capturedAt.getTime() + 14 * 86400000)), promoted_to: null },
        flags: suspicious ? ['injection-suspect'] : [] };
}
function isoLocal(date: Date): string {
    const offset = -date.getTimezoneOffset();
    const parts = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
    return `${parts}${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
}
export function validateScratchSource(value: unknown): value is ScratchSource {
    if (!value || typeof value !== 'object') return false;
    const s = value as ScratchSource;
    return s.schema === 'akari.scratch-intake/v0' && typeof s.id === 'string' && SCRATCH_ID.test(s.id)
        && (s.status === 'ready' || s.status === 'url_only') && typeof s.captured_at === 'string'
        && !Number.isNaN(Date.parse(s.captured_at)) && ['browser:pick', 'browser:contextmenu'].includes(s.via)
        && !!s.app && typeof s.app.page_host === 'string' && typeof s.app.resolved_from === 'string'
        && (s.app.image_host === null || typeof s.app.image_host === 'string')
        && (s.app.mime === null || typeof s.app.mime === 'string')
        && (s.app.bytes === null || typeof s.app.bytes === 'number' && s.app.bytes >= 0)
        && (s.app.width === null || typeof s.app.width === 'number' && s.app.width >= 0)
        && (s.app.height === null || typeof s.app.height === 'number' && s.app.height >= 0)
        && (s.app.sha256 === null || typeof s.app.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(s.app.sha256))
        && (s.app.search === null || !!s.app.search && /^[a-z0-9-]{1,64}$/u.test(s.app.search.engine)
            && typeof s.app.search.query === 'string' && s.app.search.query.length <= 512)
        && ['thumbnail', 'full', 'unknown'].includes(s.app.quality)
        && !!s.external && typeof s.external.page_url === 'string' && typeof s.external.page_title === 'string'
        && s.external.page_url.length <= 2048 && s.external.page_title.length <= 300
        && typeof s.external.alt === 'string' && s.external.alt.length <= 300
        && (s.external.image_url === null || typeof s.external.image_url === 'string' && s.external.image_url.length <= 2048)
        && (s.external.link_url === null || typeof s.external.link_url === 'string' && s.external.link_url.length <= 2048)
        && !!s.license && s.license.kind === 'unknown' && s.license.ai_input === 'unknown'
        && !!s.user && typeof s.user.pinned === 'boolean' && !!s.lifecycle
        && typeof s.lifecycle.expires_at === 'string' && !Number.isNaN(Date.parse(s.lifecycle.expires_at))
        && Array.isArray(s.flags) && s.flags.every(flag => flag === 'injection-suspect');
}
