export interface CaptionSourcePathRuleResult {
    status: 'voice' | 'excluded';
    reason?: string;
}

const images = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'svg', 'avif']);
const videos = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts']);
const audio = new Set(['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma']);

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
    if (images.has(extension)) return { status: 'excluded', reason: '画像には音声がありません' };
    if (!videos.has(extension) && !audio.has(extension)) {
        return { status: 'excluded', reason: '音声・動画のファイルではありません' };
    }
    return { status: 'voice' };
}
