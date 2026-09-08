import type { TranscribeCuts } from 'akari-project/lib/common/akari-project-protocol';

export const CUT_KIND_LABELS = { filler: 'フィラー', redo: '言い直し', silence: '無音', unrecognized: '未認識' };
export function cutsViewNotice(hasRoot: boolean, error?: unknown): string {
    if (error !== undefined) return String(error);
    return hasRoot ? '' : 'edit.json のあるプロジェクトを開いてください';
}
export function cutsSummary(cuts: TranscribeCuts | null): { count: number; seconds: number; kinds: Record<string, number> } {
    const candidates = cuts?.candidates ?? [];
    const selected = candidates.filter(candidate => candidate.on);
    // Count overlapping candidates individually, but count removed audio only once.
    const intervals = selected.filter(candidate => Number.isFinite(candidate.start) && Number.isFinite(candidate.end) && candidate.end > candidate.start)
        .map(candidate => [candidate.start, candidate.end]).sort((a, b) => a[0] - b[0]);
    let seconds = 0, end = -Infinity;
    for (const [start, out] of intervals) { seconds += Math.max(0, out - Math.max(start, end)); end = Math.max(end, out); }
    return { count: selected.length, seconds, kinds: Object.fromEntries(Object.keys(CUT_KIND_LABELS)
        .map(kind => [kind, candidates.filter(candidate => candidate.kind === kind).length])) };
}
export function handEditedLines(cuts: TranscribeCuts | null): number[] {
    return [...new Set((cuts?.hand_edited ?? []).map(item => item.line).filter(line => Number.isInteger(line) && line > 0))];
}
export function isHandEditedCandidate(cuts: TranscribeCuts | null, id: string): boolean {
    return !!cuts?.hand_edited?.some(item => item.candidate === id);
}
