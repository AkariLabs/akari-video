import { SCRATCH_ID } from './scratch-source';

export interface CleanupEntry { name: string; capturedAt: number; bytes: number; pinned: boolean; symlink?: boolean; inUse?: boolean }
export function planScratchCleanup(entries: readonly CleanupEntry[], now: number, maxBytes = 500 * 1024 * 1024,
    maxCount = 200): string[] {
    const deleted: string[] = [];
    const valid = entries.filter(entry => !entry.symlink && !entry.inUse && SCRATCH_ID.test(entry.name));
    const temporary = entries.filter(entry => !entry.symlink && !entry.inUse
        && /^\d{8}-\d{6}-[a-f0-9]{6}\.tmp-[a-f0-9]+$/u.test(entry.name) && now - entry.capturedAt > 3600000);
    deleted.push(...temporary.map(entry => entry.name));
    const live = valid.filter(entry => {
        if (!entry.pinned && now - entry.capturedAt >= 14 * 86400000) { deleted.push(entry.name); return false; }
        return true;
    }).sort((a, b) => a.capturedAt - b.capturedAt);
    let totalBytes = live.reduce((sum, entry) => sum + entry.bytes, 0);
    let count = live.length;
    for (const entry of live) {
        if (totalBytes <= maxBytes && count <= maxCount) break;
        if (entry.pinned) continue;
        deleted.push(entry.name); totalBytes -= entry.bytes; count--;
    }
    return deleted;
}
