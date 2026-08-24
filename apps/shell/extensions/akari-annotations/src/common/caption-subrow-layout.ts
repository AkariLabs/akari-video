import { assignSubRows } from './lane-layout';

export type CaptionOutputRange = readonly [number, number];

export interface CaptionSubrowItem {
    id: string;
    start: number;
    end: number;
    src?: string | null;
    timeDomain?: 'source' | 'output';
}

export interface CaptionSubrowLayout {
    start: number;
    end: number;
    row: number;
}

/**
 * 字幕の描画区間とサブ段を同じ output 時間から導出する。
 *
 * 削除区間を跨いで複数の output 区間へ分かれる字幕は、現行の描画契約どおり最初の開始から
 * 最後の終了までを 1 本の帯として扱う。分割すると 1 字幕に複数のドラッグ対象ができ、選択・
 * 移動・トリムの意味論も決め直す必要があるため、本修正では単一の操作対象を維持する。段割り
 * にも同じ連続帯をそのまま渡し、描画と段割りの区間が再び乖離しないようにする。
 *
 * output 区間を持たない（削除区間へ完全に落ちた）字幕は結果に含めない。呼び出し側は字幕 ID
 * で結果を参照することで、非表示字幕の有無による配列 index のずれを避けられる。
 */
export function computeCaptionSubrowLayout(
    captions: readonly CaptionSubrowItem[],
    minimumItemDuration: number,
    sourceRangeToOutputRanges: (
        start: number, end: number, src: string | null | undefined
    ) => readonly CaptionOutputRange[]
): Map<string, CaptionSubrowLayout> {
    const visibleCaptions = captions.flatMap(caption => {
        const sourceEnd = Math.max(caption.end, caption.start + minimumItemDuration);
        const outputRanges = caption.timeDomain === 'output'
            ? [[caption.start, sourceEnd] as const]
            : sourceRangeToOutputRanges(caption.start, sourceEnd, caption.src);
        if (outputRanges.length === 0) {
            return [];
        }
        return [{
            id: caption.id,
            start: outputRanges[0][0],
            end: outputRanges[outputRanges.length - 1][1]
        }];
    });
    const rows = assignSubRows(visibleCaptions);
    return new Map(visibleCaptions.map((caption, index) => [caption.id, {
        start: caption.start,
        end: caption.end,
        row: rows[index]
    }]));
}
