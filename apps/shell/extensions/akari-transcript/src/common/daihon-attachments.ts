import type { DaihonRow } from './daihon-row-model';

type OutputRow = Pick<DaihonRow, 'outStart' | 'outEnd'>;
export type AttachmentMode = 'all' | 'text' | 'none';

interface VisualItem {
    id: string;
    name?: string;
    at: number;
    duration: number;
    source: { kind: string; path?: string; src?: string };
}

interface VisualEdit {
    version: number;
    output?: { fps?: number };
    sources?: Array<{ id: string; path: string }>;
    tracks?: Array<{ lane: string; items?: VisualItem[] }>;
}

export interface AttachmentRange {
    id: string;
    kind: 'html' | 'image';
    name: string;
    path: string;
    atFrames: number;
    durationFrames: number;
    start: number;
    end: number;
    first: number;
    last: number;
    colorIndex: number;
}

const IMAGE_EXT = /\.(?:png|jpe?g|webp|bmp|gif)$/i;
const basename = (path: string): string => path.split(/[\\/]/).pop() || path;

/** Read only top-level visual items. Base footage, audio and generated item kinds stay out. */
export function attachmentRanges(edit: VisualEdit, rows: readonly OutputRow[], colorOffset = 0): AttachmentRange[] {
    const fps = edit.output?.fps;
    if (edit.version !== 2 || !fps || !Number.isFinite(fps) || fps <= 0) return [];
    const paths = new Map((edit.sources ?? []).map(source => [source.id, source.path]));
    const items = (edit.tracks ?? []).filter(track => track.lane === 'visual')
        .flatMap(track => track.items ?? []).flatMap(item => {
            const path = item.source.kind === 'html' ? item.source.path
                : item.source.kind === 'media' ? paths.get(item.source.src ?? '') : undefined;
            const kind: 'html' | 'image' | undefined = item.source.kind === 'html' ? 'html'
                : item.source.kind === 'media' && path && IMAGE_EXT.test(path) ? 'image' : undefined;
            return kind && path && Number.isInteger(item.at) && item.at >= 0
                && Number.isInteger(item.duration) && item.duration > 0
                ? [{ item, kind, path }] : [];
        }).sort((a, b) => a.item.id.localeCompare(b.item.id));
    return items.flatMap(({ item, kind, path }, colorIndex) => {
        const start = item.at / fps, end = (item.at + item.duration) / fps;
        const overlapping = rows.flatMap((row, index) => row.outStart !== null && row.outEnd !== null
            && row.outEnd > row.outStart && row.outStart < end && start < row.outEnd ? [index] : []);
        const first = overlapping[0] ?? rows.findIndex(row => row.outStart !== null && row.outEnd !== null
            && row.outEnd > row.outStart && row.outStart >= start);
        return first < 0 ? [] : [{ id: item.id, kind, name: item.name || basename(path), path,
            atFrames: item.at, durationFrames: item.duration, start, end, first,
            last: overlapping[overlapping.length - 1] ?? first, colorIndex: colorOffset + colorIndex }];
    });
}

export function visibleAttachmentRanges<T>(mode: AttachmentMode, text: readonly T[], attachments: readonly T[]): T[] {
    return mode === 'none' ? [] : mode === 'text' ? [...text] : [...text, ...attachments];
}

export function visibleLaneCount(count: number): number { return Math.min(count, 4); }

/** Restrict the shared v2 item writer to HTML and still-image visual items. */
export function isAttachmentItem(edit: VisualEdit, id: string): boolean {
    if (edit.version !== 2) return false;
    const item = edit.tracks?.filter(track => track.lane === 'visual').flatMap(track => track.items ?? [])
        .find(candidate => candidate.id === id);
    const sourcePath = edit.sources?.find(source => source.id === item?.source.src)?.path;
    return !!item && (item.source.kind === 'html'
        || item.source.kind === 'media' && !!sourcePath && IMAGE_EXT.test(sourcePath));
}
