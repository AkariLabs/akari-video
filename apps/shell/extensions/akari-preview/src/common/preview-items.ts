// 内部表現（packages/edit-store の tracks[].items[]）→ プレビュー要約の橋。
//
// loadPreviewModel から切り出した純関数（Theia の DI に依存しない）ので、
// 「どのアイテムが要約のどのバケットへ、どの順で入るか」をそのまま単体テストできる。
// これは edit-summary-fields.ts と同じ狙い（配線そのものを検査可能にする）。

import { AnchorCaption, InternalEdit, InternalItem, collectExcludedCaptionIds, readInternalEdit } from '@akari-video/edit-store';
import { flattenGroupDescendants } from '@akari-video/edit-store/lib/group-flatten';

/**
 * preview 用の正規化読込。timeline.tracks 未宣言時は captions.json と埋め込み字幕の
 * どちらも captions 段の導出条件にする。
 */
export function readPreviewInternalEdit(
    source: string,
    hasExternalCaptions: boolean,
    captions?: AnchorCaption[]
): InternalEdit {
    const raw = JSON.parse(source) as { captions?: unknown };
    const hasInline = Array.isArray(raw?.captions) && raw.captions.length > 0;
    return readInternalEdit(source, { hasCaptions: hasExternalCaptions || hasInline, captions });
}

/** プレビュー要約が持つ 3 つのバケット（旧 edit.json の種別別配列に対応）。 */
export type PreviewItemBucket = 'cuts' | 'overlays' | 'layers';

export interface PreviewItemWarningState {
    warnedKinds: Set<string>;
    warn: (message: string) => void;
}

/**
 * 内部表現のアイテムを要約の 3 バケットへ振り分ける。**種別ごとの分岐はここ 1 箇所
 * （`source.kind` の switch）に集約**し、以降は宣言レコードだけを読む。
 * 並びは宣言順（`legacy.index`）を保つ — 要約の配列順は差分更新の比較対象だから。
 */
export function collectItems(
    internal: InternalEdit,
    bucket: PreviewItemBucket,
    warningState: PreviewItemWarningState = {
        warnedKinds: new Set<string>(),
        warn: message => console.warn(message)
    }
): InternalItem[] {
    const entries = flattenGroupDescendants(internal);
    const hasGroupMedia = entries.some(entry => entry.descendant && entry.item.source.kind === 'media');
    const items: Array<{ item: InternalItem; order: number }> = [];
    for (const { item, descendant, order } of entries) {
        if (descendant && item.source.kind !== 'media') continue;
        let resolved: PreviewItemBucket | undefined;
        const kind = String(item.source.kind);
        switch (kind) {
            case 'media':
                // 「読んで重ねるだけの素材」は内部表現では 1 種別。旧宣言では
                // cuts[] と layers[](kind: video) に分かれていたぶんだけ由来を見る。
                resolved = item.legacy.collection === 'layers' ? 'layers'
                    : item.legacy.collection === 'cuts' ? 'cuts' : undefined;
                break;
            case 'html':
                resolved = 'overlays';
                break;
            case 'telop':
            case 'filter':
                resolved = 'layers';
                break;
            case 'caption':
            case 'captions':
            case 'group':
                // caption / captions は専用描画、group は現行の各 projection が子を扱う。
                resolved = undefined;
                break;
            default:
                resolved = undefined;
                if (!warningState.warnedKinds.has(kind)) {
                    warningState.warnedKinds.add(kind);
                    warningState.warn(`[akari-preview] unknown source.kind "${kind}" skipped`);
                }
                break;
        }
        if (resolved === bucket) items.push({ item, order });
    }
    return items.sort((left, right) => hasGroupMedia && bucket === 'layers'
        ? left.order - right.order : left.item.legacy.index - right.item.legacy.index)
        .map(entry => entry.item);
}

/** edit.json に埋め込まれた字幕（正本は captions.json）。 */
export function hasInlineCaptions(internal: InternalEdit): boolean {
    const captions = internal.declaration.captions;
    return Array.isArray(captions) && captions.length > 0;
}

/** captions 袋から出した行は正本の文字を使い、木の時間・見た目だけを上書きする。 */
export function projectDetachedCaptionItems<T extends { id?: string; start: number; end: number; text: string }>(
    internal: InternalEdit,
    rows: readonly T[]
): Array<T & { sourceCueId: string; clockDomain: 'output'; timeDomain: 'output';
    resolvedTimeline: false; groupTransform?: Record<string, number>; groupOpacity?: number; groupTrackId?: string;
    groupBag?: boolean }> {
    const byId = new Map(rows.filter(row => typeof row.id === 'string').map(row => [row.id as string, row]));
    return flattenGroupDescendants(internal).flatMap(({ item, track, descendant }) => {
        const appearance = {
            clockDomain: 'output' as const, timeDomain: 'output' as const,
            ...(item.declaration.transform ? { groupTransform: item.declaration.transform as Record<string, number> } : {}),
            ...(item.declaration.opacity !== undefined ? { groupOpacity: Number(item.declaration.opacity) } : {}),
            ...(descendant ? { groupTrackId: track.id } : {})
        };
        if (item.source.kind === 'caption') {
            const row = byId.get(item.source.id);
            if (!row) return [];
            return [{ ...row, id: item.id, sourceCueId: row.id as string, resolvedTimeline: false as const,
                start: item.atFrames / internal.output.fps,
                end: (item.atFrames + item.durationFrames) / internal.output.fps, ...appearance }];
        }
        if (item.source.kind !== 'captions' || !descendant) return [];
        const excluded = new Set(item.source.exclude ?? []);
        return rows.flatMap(row => {
            if (!row.id || excluded.has(row.id)) return [];
            const start = Math.max(item.at, item.at + row.start);
            const end = Math.min(item.at + item.duration, item.at + row.end);
            return end > start ? [{ ...row, id: `${item.id}::${row.id}`, sourceCueId: row.id,
                resolvedTimeline: false as const,
                start, end, ...appearance, groupBag: true }] : [];
        });
    });
}

/** 入れ子の字幕袋に属する元行を、通常の字幕面から二重描画しないための id 集合。 */
export function groupedCaptionBagSourceIds(
    internal: InternalEdit,
    rows: readonly { id?: string }[]
): Set<string> {
    const result = new Set<string>();
    const visit = (item: InternalItem, inGroup = false): void => {
        const nested = inGroup || item.source.kind === 'group';
        if (inGroup && item.source.kind === 'captions') {
            for (const row of rows) if (row.id) result.add(row.id);
        }
        for (const child of item.children ?? []) visit(child, nested);
    };
    for (const track of internal.tracks) for (const item of track.items) visit(item);
    return result;
}

/** 袋の除外と分離した行の追加を 1 回の投影で確定する。 */
export function projectPreviewCaptionRows<T extends { id?: string; start: number; end: number; text: string }>(
    internal: InternalEdit,
    rows: readonly T[],
    excluded: ReadonlySet<string> = collectExcludedCaptionIds(internal)
): T[] {
    const groupedBagIds = groupedCaptionBagSourceIds(internal, rows);
    return [
        ...rows.filter(row => !excluded.has(row.id ?? '') && !groupedBagIds.has(row.id ?? '')),
        ...projectDetachedCaptionItems(internal, rows)
    ];
}
