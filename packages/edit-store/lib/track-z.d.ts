interface TrackZItem {
    id?: unknown;
    source?: {
        kind?: unknown;
    };
    children?: readonly TrackZItem[];
    items?: readonly TrackZItem[];
}
interface TrackZTrack {
    items?: readonly TrackZItem[];
    content?: {
        from?: unknown;
    };
    legacy?: {
        kind?: unknown;
    };
}
/**
 * 契約 §2-4 の段の z（tracks[] の配列順・0 = 最背面）を、種別を跨ぐ 1 本の軸として配る。
 * legacy の track（種別ごとの連番 ref）とは別軸として扱う。
 */
export declare function collectTrackZByItemId(tracks: readonly TrackZTrack[]): Map<string, number>;
/**
 * overlay レコードをアイテム id → 段 z の対応表へ引き当てる。
 * 袋の子の合成 id と部品の parentId を解決し、当たらなければ最背面の 0 を返す。
 */
export declare function resolveRecordTrackZ(trackZByItemId: ReadonlyMap<string, number>, record: {
    id?: unknown;
    parentId?: unknown;
}): number;
/**
 * 契約 §2-4 に従い、宣言済み字幕トラックの段の z を tracks[] の配列順から解決する。
 * 袋形・旧 content 形・legacy 形のいずれにも同じ軸を使う。
 */
export declare function resolveDeclaredCaptionTrackZ(tracks: readonly TrackZTrack[]): number | null;
/**
 * 契約 §2-5: 字幕に特別な z 規則は置かない。
 * 宣言が無い場合だけ、取り込み既定の置き場として暗黙字幕トラックを最前面へ足す。
 */
export declare function resolveCaptionTrackZ(tracks: readonly TrackZTrack[]): number;
export {};
