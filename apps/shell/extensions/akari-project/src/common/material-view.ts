export type MaterialViewKind = 'video' | 'audio' | 'image' | 'other' | '3d';

export interface MaterialViewState {
    /** 空ならすべての種類を表示する。 */
    kinds: readonly MaterialViewKind[];
    sort: { by: 'name' | 'duration' | 'created'; order: 'asc' | 'desc' };
}

export type MaterialViewPatch = Partial<MaterialViewState> & { legacySort?: string; mode?: 'grid' | 'list' };

export const DEFAULT_MATERIAL_VIEW: MaterialViewState = {
    kinds: [],
    sort: { by: 'name', order: 'asc' }
};

const KIND_ORDER: readonly MaterialViewKind[] = ['video', 'audio', 'image', 'other', '3d'];
const KIND_LABELS: Record<MaterialViewKind, string> = {
    video: '動画', audio: '音', image: '画像', other: 'その他', '3d': '3D'
};

function copyState(state: MaterialViewState): MaterialViewState {
    return { kinds: [...state.kinds], sort: { ...state.sort } };
}

/** UI と外部コマンドが共有する、素材面の状態更新規則。 */
export function applyMaterialViewPatch(state: MaterialViewState, patch: MaterialViewPatch):
    { applied: MaterialViewState; previous: MaterialViewState } {
    const previous = copyState(state);
    let kinds = previous.kinds;
    if (Array.isArray(patch.kinds)) {
        const valid = KIND_ORDER.filter(kind => patch.kinds!.includes(kind));
        // 未知の値だけを渡された場合は「すべて」に戻さず、変更を無視する。
        if (patch.kinds.length === 0 || valid.length > 0) kinds = valid;
    }
    const candidate = patch.sort;
    const sort = { ...previous.sort };
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        if (candidate.by === 'name' || candidate.by === 'duration' || candidate.by === 'created') sort.by = candidate.by;
        if (candidate.order === 'asc' || candidate.order === 'desc') sort.order = candidate.order;
    }
    return { applied: { kinds, sort }, previous };
}

/** 名前の検索は既存の素材面と同じ、小文字化した部分一致。 */
export function filterMaterials<T extends { kind: MaterialViewKind; name: string; assetGroup?: { category: string } }>(
    entries: readonly T[], state: MaterialViewState, query: string
): T[] {
    const normalizedQuery = query.trim().toLowerCase();
    return entries.filter(entry =>
        (state.kinds.length === 0 || state.kinds.includes(entry.assetGroup?.category === 'scene3d' ? '3d' : entry.kind))
        && (!normalizedQuery || entry.name.toLowerCase().includes(normalizedQuery)));
}

/** 元の配列を変えず、同名・同じ長さなら入力順を保つ。 */
export function sortMaterials<T extends { name: string; durationSeconds?: number; createdAt?: string; importedAt?: string }>(
    entries: readonly T[], sort: MaterialViewState['sort']
): T[] {
    return entries.map((entry, index) => ({ entry, index })).sort((left, right) => {
        const nameOrder = left.entry.name.localeCompare(right.entry.name, 'ja', { numeric: true });
        if (sort.by === 'created') {
            const a = Date.parse(left.entry.createdAt ?? left.entry.importedAt ?? '');
            const b = Date.parse(right.entry.createdAt ?? right.entry.importedAt ?? '');
            if (Number.isNaN(a) !== Number.isNaN(b)) return Number.isNaN(a) ? 1 : -1;
            if (!Number.isNaN(a) && a !== b) return (a - b) * (sort.order === 'asc' ? 1 : -1);
            return left.index - right.index;
        }
        if (sort.by === 'duration') {
            const a = left.entry.durationSeconds;
            const b = right.entry.durationSeconds;
            if (a === undefined || b === undefined) {
                if (a === undefined && b !== undefined) return 1;
                if (b === undefined && a !== undefined) return -1;
            } else if (a !== b) {
                return (a - b) * (sort.order === 'asc' ? 1 : -1);
            }
            return nameOrder || left.index - right.index;
        }
        return nameOrder * (sort.order === 'asc' ? 1 : -1) || left.index - right.index;
    }).map(item => item.entry);
}

export function describeMaterialView(state: MaterialViewState): string {
    const parts: string[] = [];
    if (state.kinds.length) parts.push(state.kinds.map(kind => KIND_LABELS[kind]).join('・'));
    if (state.sort.by === 'duration') {
        parts.push(state.sort.order === 'asc' ? '長さの短い順' : '長さの長い順');
    } else if (state.sort.by === 'created') {
        parts.push(state.sort.order === 'asc' ? '古い順' : '新しい順');
    } else if (state.sort.order === 'desc') {
        parts.push('名前の降順');
    }
    return parts.join(' · ');
}
