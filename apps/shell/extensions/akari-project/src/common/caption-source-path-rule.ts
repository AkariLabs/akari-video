export interface CaptionSourcePathRuleResult {
    status: 'voice' | 'excluded';
    reason?: string;
}

export const CAPTION_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'avif']);
export const CAPTION_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts']);
export const CAPTION_AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma']);

function normalize(path: string): string {
    let normalized = path.replace(/\\/gu, '/');
    if (/^file:\/\//iu.test(normalized)) {
        try { normalized = decodeURIComponent(new URL(normalized).pathname); } catch { /* Keep the original path. */ }
    }
    normalized = normalized.replace(/^\/([a-z]:\/)/iu, '$1');
    while (normalized.startsWith('./')) normalized = normalized.slice(2);
    return normalized.toLowerCase();
}

function relativeToProject(path: string, projectRoot?: string): string | undefined {
    const normalized = normalize(path);
    const absolute = normalized.startsWith('/') || /^[a-z]:\//u.test(normalized);
    if (!absolute) return normalized;
    if (!projectRoot) return undefined;
    const root = normalize(projectRoot).replace(/\/+$/u, '');
    return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : undefined;
}

/** The path-only subset of caption-source eligibility for project and home entry points. */
export function captionSourcePathRule(path: string, projectRoot?: string): CaptionSourcePathRuleResult {
    const extension = normalize(path).match(/\.([a-z0-9]+)$/u)?.[1] ?? '';
    if (relativeToProject(path, projectRoot)?.startsWith('exports/')) {
        return { status: 'excluded', reason: '書き出した完成品です（元の素材から起こします）' };
    }
    if (CAPTION_IMAGE_EXTENSIONS.has(extension)) return { status: 'excluded', reason: '画像には音声がありません' };
    if (!CAPTION_VIDEO_EXTENSIONS.has(extension) && !CAPTION_AUDIO_EXTENSIONS.has(extension)) {
        return { status: 'excluded', reason: '音声・動画のファイルではありません' };
    }
    return { status: 'voice' };
}
