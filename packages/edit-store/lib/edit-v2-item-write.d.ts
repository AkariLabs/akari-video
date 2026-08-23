type UnknownRecord = Record<string, unknown>;
export interface PreviewItemTransformPatch {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}
export interface PreviewItemCropPatch {
    x: number;
    y: number;
    w: number;
    h: number;
}
export interface PreviewItemPerspectivePatch {
    corners: [number, number][];
}
export type PreviewItemWriteCommand = {
    kind: 'overlay';
    itemId: string;
    patch: {
        vars?: UnknownRecord;
        transform?: PreviewItemTransformPatch;
        html?: string;
        params?: Record<string, string>;
    };
} | {
    kind: 'layer';
    itemId: string;
    patch: {
        transform?: PreviewItemTransformPatch;
        crop?: PreviewItemCropPatch;
        perspective?: PreviewItemPerspectivePatch | null;
    };
} | {
    kind: 'cut';
    /** v2 の安定 identity。legacy では legacyIndex だけを使う。 */
    itemId?: string;
    legacyIndex: number;
    patch: {
        transform?: PreviewItemTransformPatch;
    };
};
export interface PreviewItemWriteResolution {
    /** edit.json を更新する patch があるときだけ返す。 */
    candidateText?: string;
    /** html patch の書き込み先。本文自体は edit.json へ入れない。 */
    htmlPath?: string;
}
/**
 * 出力プレビューの item 書き戻しを、版判定を含む読み込み層 1 箇所へ閉じ込める。
 * 呼び出し側は v2 / legacy を知らず、返された edit.json 候補と HTML 参照先だけを扱う。
 */
export declare function resolvePreviewItemWrite(editText: string, command: PreviewItemWriteCommand): PreviewItemWriteResolution;
export {};
