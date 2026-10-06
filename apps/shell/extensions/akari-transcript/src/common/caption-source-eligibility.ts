export interface CaptionSource {
    id: string;
    path: string;
    kind?: string;
}

export interface CaptionSourceEvidence {
    kind?: string;
    hasAudio?: boolean;
    isBgm?: boolean;
    projectRoot?: string;
}

export interface CaptionSourceEligibility {
    status: 'voice' | 'bgm' | 'excluded';
    reason?: string;
}

export const CAPTION_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'avif']);
export const CAPTION_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts']);
export const CAPTION_AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma']);

export function normalizedCaptionPath(path: string): string {
    let normalized = path.replace(/\\/gu, '/');
    if (/^file:\/\//iu.test(normalized)) {
        try { normalized = decodeURIComponent(new URL(normalized).pathname); } catch { /* Keep the original path. */ }
    }
    normalized = normalized.replace(/^\/([a-z]:\/)/iu, '$1');
    while (normalized.startsWith('./')) normalized = normalized.slice(2);
    return normalized.toLowerCase();
}

function projectRelativePath(path: string, projectRoot?: string): string | undefined {
    const normalized = normalizedCaptionPath(path);
    const absolute = normalized.startsWith('/') || /^[a-z]:\//u.test(normalized);
    if (!absolute) return normalized;
    if (!projectRoot) return undefined;
    const root = normalizedCaptionPath(projectRoot).replace(/\/+$/u, '');
    return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : undefined;
}

export function isCaptionVideo(source: CaptionSource, evidence: CaptionSourceEvidence = {}): boolean {
    const extension = normalizedCaptionPath(source.path).match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
    return CAPTION_VIDEO_EXTENSIONS.has(extension) || evidence.kind === 'video' || source.kind === 'video';
}

export function captionSourceEligibility(source: CaptionSource, evidence: CaptionSourceEvidence = {}): CaptionSourceEligibility {
    const path = normalizedCaptionPath(source.path);
    const extension = path.match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
    if (projectRelativePath(source.path, evidence.projectRoot)?.startsWith('exports/')) {
        return { status: 'excluded', reason: '書き出した完成品です（元の素材から起こします）' };
    }
    if (CAPTION_IMAGE_EXTENSIONS.has(extension) || evidence.kind === 'image' || evidence.kind === 'still') {
        return { status: 'excluded', reason: '画像には音声がありません' };
    }
    const isVideo = isCaptionVideo(source, evidence);
    const isAudio = CAPTION_AUDIO_EXTENSIONS.has(extension) || evidence.kind === 'audio' || source.kind === 'audio';
    if (!isVideo && !isAudio) {
        return { status: 'excluded', reason: '音声・動画のファイルではありません' };
    }
    if (isVideo && evidence.hasAudio === false) {
        return { status: 'excluded', reason: '音声トラックが入っていません' };
    }
    if (evidence.isBgm) return { status: 'bgm', reason: 'BGM として置いた音です' };
    return { status: 'voice' };
}

interface CaptionEdit {
    sources?: CaptionSource[];
    audio?: { bgm?: { path?: string; source?: string; src?: string } };
    tracks?: Array<{ lane?: string; items?: Array<{
        role?: string; path?: string; source?: { src?: string; path?: string };
    }> }>;
}

/** The BGM role belongs to a timeline placement, not to the source filename. */
export function captionBgmSourceIds(edit: CaptionEdit): Set<string> {
    const ids = new Set<string>();
    const sources = Array.isArray(edit.sources) ? edit.sources : [];
    const bgm = edit.audio?.bgm;
    const paths = new Set<string>();
    if (typeof bgm?.path === 'string') paths.add(normalizedCaptionPath(bgm.path));
    if (typeof bgm?.source === 'string') ids.add(bgm.source);
    if (typeof bgm?.src === 'string') ids.add(bgm.src);
    for (const track of edit.tracks ?? []) {
        if (track.lane !== 'audio') continue;
        for (const item of track.items ?? []) {
            if (item.role !== 'bgm') continue;
            if (typeof item.source?.src === 'string') ids.add(item.source.src);
            if (typeof item.source?.path === 'string') paths.add(normalizedCaptionPath(item.source.path));
            if (typeof item.path === 'string') paths.add(normalizedCaptionPath(item.path));
        }
    }
    for (const source of sources) {
        if (typeof source?.id === 'string' && typeof source.path === 'string'
            && paths.has(normalizedCaptionPath(source.path))) ids.add(source.id);
    }
    return ids;
}

export function selectCaptionSources(edit: CaptionEdit, hasAudioByPath: Readonly<Record<string, boolean | undefined>> = {},
    projectRoot?: string): CaptionSource[] {
    const bgmIds = captionBgmSourceIds(edit);
    return (Array.isArray(edit.sources) ? edit.sources : []).filter(source =>
        typeof source?.id === 'string' && typeof source.path === 'string'
        && captionSourceEligibility(source, { kind: source.kind, hasAudio: hasAudioByPath[source.path], projectRoot,
            isBgm: bgmIds.has(source.id) }).status === 'voice');
}
