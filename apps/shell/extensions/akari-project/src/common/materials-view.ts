import type { MaterialKind } from './asset-group-media';

export type MaterialsSort = 'imported-desc' | 'imported-asc' | 'name' | 'dur' | 'kind' | 'created';
export type MaterialsMode = 'grid' | 'list';
export const DEFAULT_MATERIALS_SORT: MaterialsSort = 'imported-desc';
export const MATERIALS_SORT_OPTIONS: readonly MaterialsSort[] =
    ['imported-desc', 'imported-asc', 'name', 'dur', 'kind', 'created'];
export const MATERIALS_KINDS: readonly MaterialKind[] = ['video', 'audio', 'image', 'other'];

export interface MaterialsViewEntry {
    name: string;
    kind: MaterialKind;
    assetGroup?: { category: string };
    durationSeconds?: number;
    importedAt?: string;
    createdAt?: string;
}

export function materialViewKind(entry: MaterialsViewEntry): MaterialKind {
    return entry.assetGroup ? 'other' : entry.kind;
}

export function isMaterialsList(mode: MaterialsMode): boolean {
    return mode === 'list';
}

export function visibleMaterials<T extends MaterialsViewEntry>(
    entries: readonly T[], filter: readonly string[], query: string, sort: MaterialsSort
): T[] {
    const search = query.trim().toLocaleLowerCase();
    const included = entries.filter(entry =>
        (filter.length === 0 || filter.includes(materialViewKind(entry)))
        && (!search || entry.name.toLocaleLowerCase().includes(search)));
    const present = (value: number | string | undefined): boolean =>
        value !== undefined && value !== '' && (typeof value !== 'number' || Number.isFinite(value));
    return included.map((entry, index) => ({ entry, index })).sort((a, b) => {
        const left = a.entry;
        const right = b.entry;
        const value = (entry: T): number | string | undefined => {
            switch (sort) {
                case 'imported-desc': case 'imported-asc': return entry.importedAt;
                case 'dur': return entry.durationSeconds;
                case 'created': return entry.createdAt;
                case 'kind': return materialViewKind(entry);
                default: return entry.name;
            }
        };
        const x = value(left);
        const y = value(right);
        if (present(x) !== present(y)) return present(x) ? -1 : 1;
        let order = 0;
        if (typeof x === 'number' && typeof y === 'number') order = x - y;
        else if (typeof x === 'string' && typeof y === 'string') order = x.localeCompare(y, 'ja', { numeric: true });
        if (sort === 'imported-desc' || sort === 'dur' || sort === 'created') order = -order;
        return order || left.name.localeCompare(right.name, 'ja', { numeric: true }) || a.index - b.index;
    }).map(({ entry }) => entry);
}
