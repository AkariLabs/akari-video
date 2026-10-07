import { basename } from 'node:path';
import type { InkBox } from '../../common/ink-model';

export interface EditContextEntry {
    ref: string; kind: string; label: string; start: number; end: number;
    sourceKind?: string; sourcePath?: string; text?: string; transform?: Record<string, unknown>;
    box?: InkBox;
}
const record = (value: unknown): value is Record<string, any> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const boxOf = (value: unknown): InkBox | undefined => {
    const box = Array.isArray(value) ? { x: value[0], y: value[1], w: value[2], h: value[3] } : value;
    return record(box) && [box.x, box.y, box.w, box.h].every(finite) ? box as InkBox : undefined;
};
const textOf = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (!record(value)) return undefined;
    const parts = ['title', 'subtitle', 'caption', 'text', 'heading', 'label']
        .map(key => value[key]).filter((part): part is string => typeof part === 'string' && !!part.trim());
    return parts.length ? parts.join(' / ') : undefined;
};
export function enumerateEditContext(raw: unknown): EditContextEntry[] {
    if (!record(raw)) return [];
    const entries: EditContextEntry[] = [];
    if (raw.version === 2 && Array.isArray(raw.tracks)) {
        const fps = finite(raw.output?.fps) && raw.output.fps > 0 ? raw.output.fps : 30;
        const sources = new Map<string, string>((Array.isArray(raw.sources) ? raw.sources : [])
            .filter((source: unknown) => record(source) && typeof source.id === 'string' && typeof source.path === 'string')
            .map((source: any) => [source.id, source.path]));
        const items = raw.tracks.flatMap((track: any) => Array.isArray(track?.items)
            ? track.items.map((item: any) => ({ track, item })) : []);
        const media = items.filter(({ item }: any) => item?.source?.kind === 'media'
            && finite(item.at) && finite(item.duration))
            .sort((a: any, b: any) => (a.item.at ?? 0) - (b.item.at ?? 0));
        const cutIndex = new Map<any, number>(media.map((value: any, index: number) => [value.item, index]));
        for (const { track, item } of items) {
            if (!record(item) || !record(item.source) || !finite(item.at) || !finite(item.duration)) continue;
            const source = item.source;
            const isMedia = source.kind === 'media';
            if (!isMedia && typeof item.id !== 'string') continue;
            const sourcePath = isMedia ? sources.get(source.src) ?? source.path ?? source.src : source.path ?? source.src;
            entries.push({
                ref: isMedia ? `cut:${cutIndex.get(item)}` : `overlay:${item.id}`,
                kind: String(source.kind ?? 'item'), label: isMedia ? String(source.src ?? item.id ?? track?.name ?? '') : '',
                start: item.at / fps, end: (item.at + item.duration) / fps,
                sourceKind: String(source.kind ?? 'item'),
                sourcePath: typeof sourcePath === 'string' ? sourcePath : undefined,
                text: textOf(source.params) ?? textOf(source.text) ?? textOf(item.text),
                transform: record(item.transform) ? item.transform : undefined,
                box: boxOf(item.box ?? item.rect ?? source.box)
            });
        }
    } else {
        let cursor = 0;
        for (const [index, cut] of (Array.isArray(raw.cuts) ? raw.cuts : []).entries()) {
            if (!record(cut)) continue;
            const duration = finite(cut.in) && finite(cut.out) ? Math.max(0, cut.out - cut.in) : 0;
            entries.push({ ref: `cut:${index}`, kind: String(cut.kind ?? cut.type ?? 'media'), label: String(cut.id ?? ''),
                start: cursor, end: cursor + duration, sourceKind: 'media', sourcePath: cut.src,
                text: textOf(cut.text ?? cut.caption), box: boxOf(cut.box ?? cut.rect) });
            cursor += duration;
        }
        for (const overlay of Array.isArray(raw.overlays) ? raw.overlays : []) {
            if (!record(overlay) || typeof overlay.id !== 'string') continue;
            const start = finite(overlay.start) ? overlay.start : 0;
            entries.push({ ref: `overlay:${overlay.id}`, kind: String(overlay.kind ?? overlay.type ?? 'overlay'),
                label: '', start, end: start + (finite(overlay.duration) ? overlay.duration : 0),
                sourcePath: overlay.html, text: textOf(overlay.text ?? overlay.params), box: boxOf(overlay.box ?? overlay.rect) });
        }
    }
    return entries.sort((a, b) => a.start - b.start
        || Number(b.ref.startsWith('cut:')) - Number(a.ref.startsWith('cut:'))
        || a.ref.localeCompare(b.ref));
}
export function contextAt(entries: readonly EditContextEntry[], outputT?: number): EditContextEntry[] {
    return finite(outputT) ? entries.filter(entry => entry.end >= outputT - 5 && entry.start <= outputT + 10)
        : entries.slice(0, 30);
}
const second = (value: number): string => String(Math.round(value * 10) / 10);
export function editContextLine(entry: EditContextEntry): string {
    const source = entry.sourcePath ? ` (${entry.sourceKind ?? entry.kind} ${basename(entry.sourcePath)})` : '';
    const transform = entry.transform ? ['x', 'y', 'scale', 'rotate']
        .filter(key => finite(entry.transform?.[key])).map(key => `${key}=${entry.transform?.[key]}`).join(',') : '';
    return `${entry.ref}${entry.label ? ` ${entry.label}` : ` ${entry.kind}`} ${second(entry.start)}–${second(entry.end)}s${source}`
        + (transform ? ` transform(${transform})` : '') + (entry.text ? ` 字幕: ${entry.text}` : '');
}
