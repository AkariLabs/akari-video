import { assignSubRows } from '../../common/lane-layout';
import type { TimelineTreeRow } from './timeline-tree-model';

export interface TimelineItemSpan {
    id: string;
    start: number;
    end: number;
}

export interface DetachedCaptionChipSubrowLayout {
    rowById: ReadonlyMap<string, number>;
    subrowCount: number;
    height: number;
}

export interface DetachedCaptionChipSubrowOptions {
    placement?: 'mix' | 'append';
    baseHeight?: number;
    subrowStride?: number;
}

/** ヘッダ行を増やさず、帯だけに描くトップレベル caption 葉を取り出す。 */
export function detachedCaptionChipRows(
    rows: readonly TimelineTreeRow[],
    headerRows: readonly TimelineTreeRow[]
): TimelineTreeRow[] {
    const headerIds = new Set(headerRows.map(row => row.id));
    return rows.filter(row => row.sourceKind === 'caption'
        && row.parentId === undefined
        && !headerIds.has(row.id));
}

/**
 * 分離 caption を同じトラックの通常 item と一緒に interval partitioning し、
 * 重なりのない表示段へ割り当てる。
 */
export function assignDetachedCaptionChipSubRows(
    ordinaryItems: readonly TimelineItemSpan[],
    captionRows: readonly Pick<TimelineTreeRow, 'id' | 'at' | 'duration'>[],
    options: DetachedCaptionChipSubrowOptions = {}
): DetachedCaptionChipSubrowLayout {
    const placement = options.placement ?? 'mix';
    const baseHeight = Math.max(0, options.baseHeight ?? 0);
    const subrowStride = options.subrowStride && options.subrowStride > 0 ? options.subrowStride : 1;
    const captionItems = captionRows.map(row => ({
        id: row.id, start: row.at, end: row.at + row.duration
    }));
    const items = placement === 'mix' ? [...ordinaryItems, ...captionItems] : captionItems;
    const assignedRows = assignSubRows(items);
    if (placement === 'append') {
        const baseSubrowCount = Math.ceil(baseHeight / subrowStride);
        const captionSubrowCount = assignedRows.length ? Math.max(...assignedRows) + 1 : 0;
        return {
            rowById: new Map(items.map((item, index) => [
                item.id, baseSubrowCount + (assignedRows[index] ?? 0)
            ])),
            subrowCount: baseSubrowCount + captionSubrowCount,
            height: captionSubrowCount > 0
                ? Math.max(baseHeight, (baseSubrowCount + captionSubrowCount) * subrowStride)
                : baseHeight
        };
    }
    const subrowCount = Math.max(1, assignedRows.length ? Math.max(...assignedRows) + 1 : 0);
    return {
        rowById: new Map(items.map((item, index) => [item.id, assignedRows[index] ?? 0])),
        subrowCount,
        height: Math.max(baseHeight, subrowCount * subrowStride)
    };
}
