import type { InternalEdit } from '@akari-video/edit-store';

interface CaptionClockRow {
    id?: string;
    start: number;
    end: number;
    clockDomain: 'source' | 'output' | 'legacy';
    sourceCueId?: string;
    timeDomain?: 'source' | 'output';
    words?: { start: number; end: number; text: string }[];
    canvasTrackId?: string;
}

/** 字幕の元行を除外した後、明示的な caption item の表示行だけを復元する。 */
export function projectCanvasCaptionRows<T extends CaptionClockRow>(
    internal: InternalEdit, rows: readonly T[]
): T[] {
    const byId = new Map(rows.flatMap(row => row.id ? [[row.id, row] as const] : []));
    const projected: T[] = [];
    const visit = (item: InternalEdit['tracks'][number]['items'][number], trackId: string): void => {
        if (item.source.kind === 'caption' && item.duration > 0 && item.declaration.hidden !== true) {
            const original = byId.get(item.source.id);
            if (original) {
                const offset = item.at - original.start;
                projected.push({ ...original,
                    id: item.id, sourceCueId: item.source.id, canvasTrackId: trackId,
                    start: item.at, end: item.at + item.duration,
                    clockDomain: 'output', timeDomain: 'output',
                    ...(original.words ? { words: original.words.map(word => ({ ...word,
                        start: word.start + offset, end: word.end + offset })) } : {})
                } as T);
            }
        }
        for (const child of item.children ?? []) visit(child, trackId);
    };
    for (const track of internal.tracks) for (const item of track.items) visit(item, track.id);
    return projected;
}
