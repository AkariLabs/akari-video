/** Only generated mp4 candidates belonging to this item may enter the output preview. */
export function isProjectVideoCandidatePath(itemId: string, relativePath: string): boolean {
    if (!itemId || !/^[A-Za-z0-9_-]+$/u.test(itemId) || !relativePath || relativePath.includes('\\')) return false;
    const parts = relativePath.split('/');
    return parts.length === 5 && parts[0] === 'assets' && parts[1] === 'generated'
        && parts[2] === 'candidates' && parts[3] === itemId
        && /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.mp4$/iu.test(parts[4])
        && !parts[4].includes('..');
}

export function videoCandidatePreviewTime(localTime: number, durationSeconds: number, frameSeconds: number, fps = 30): number {
    if (!Number.isFinite(localTime) || !Number.isFinite(durationSeconds) || durationSeconds <= 0
        || !Number.isFinite(frameSeconds) || frameSeconds <= 0) return 0;
    return Math.min(Math.max(0, localTime), Math.max(0, Math.min(durationSeconds, frameSeconds) - 1 / fps));
}
