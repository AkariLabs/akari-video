interface TrackZItem {
    id?: unknown;
    source?: { kind?: unknown };
    children?: readonly TrackZItem[];
    items?: readonly TrackZItem[];
}

interface TrackZTrack {
    items?: readonly TrackZItem[];
    content?: { from?: unknown };
    legacy?: { kind?: unknown };
}

/**
 * 契約 §2-4 の段の z（tracks[] の配列順・0 = 最背面）を、種別を跨ぐ 1 本の軸として配る。
 * legacy の track（種別ごとの連番 ref）とは別軸として扱う。
 */
export function collectTrackZByItemId(tracks: readonly TrackZTrack[]): Map<string, number> {
    const resolved = new Map<string, number>();
    const visit = (item: TrackZItem, z: number): void => {
        if (item?.id !== undefined) {
            const id = String(item.id);
            if (!resolved.has(id)) resolved.set(id, z);
        }
        const children = Array.isArray(item?.children)
            ? item.children
            : Array.isArray(item?.items) ? item.items : [];
        for (const child of children) visit(child, z);
    };
    for (const [z, track] of (Array.isArray(tracks) ? tracks : []).entries()) {
        for (const item of Array.isArray(track?.items) ? track.items : []) visit(item, z);
    }
    return resolved;
}

/**
 * overlay レコードをアイテム id → 段 z の対応表へ引き当てる。
 * 袋の子の合成 id と部品の parentId を解決し、当たらなければ最背面の 0 を返す。
 */
export function resolveRecordTrackZ(
    trackZByItemId: ReadonlyMap<string, number>,
    record: { id?: unknown; parentId?: unknown }
): number {
    const id = String(record?.id ?? '');
    const hashIndex = id.lastIndexOf('#');
    return trackZByItemId.get(id)
        ?? trackZByItemId.get(String(record?.parentId ?? ''))
        ?? (hashIndex > 0 ? trackZByItemId.get(id.slice(0, hashIndex)) : undefined)
        ?? 0;
}

/**
 * 契約 §2-4 に従い、宣言済み字幕トラックの段の z を tracks[] の配列順から解決する。
 * 袋形・旧 content 形・legacy 形のいずれにも同じ軸を使う。
 */
export function resolveDeclaredCaptionTrackZ(tracks: readonly TrackZTrack[]): number | null {
    const declared = Array.isArray(tracks) ? tracks : [];
    for (let z = 0; z < declared.length; z += 1) {
        const track = declared[z];
        const hasCaptionBag = (Array.isArray(track?.items) ? track.items : [])
            .some(item => item?.source?.kind === 'captions');
        if (hasCaptionBag || track?.content?.from === 'captions.json' || track?.legacy?.kind === 'captions') return z;
    }
    return null;
}

/**
 * 契約 §2-5: 字幕に特別な z 規則は置かない。
 * 宣言が無い場合だけ、取り込み既定の置き場として暗黙字幕トラックを最前面へ足す。
 */
export function resolveCaptionTrackZ(tracks: readonly TrackZTrack[]): number {
    const declared = Array.isArray(tracks) ? tracks : [];
    return resolveDeclaredCaptionTrackZ(declared) ?? declared.length;
}
