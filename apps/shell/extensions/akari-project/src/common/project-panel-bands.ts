/** The left project panel's three bands. These selectors have no browser or file-system dependencies. */
export type MaterialChip = 'all' | 'video' | 'image' | 'audio' | 'recipe' | 'baked' | 'placeholder';
export const MATERIAL_CHIPS: readonly MaterialChip[] = ['all', 'video', 'image', 'audio', 'recipe', 'baked', 'placeholder'];

export interface PanelMaterial {
    readonly relativePath: string;
    readonly kind: string;
    readonly recipe?: boolean;
    readonly baked?: boolean;
}

export interface PlanPlaceholder {
    readonly id: string;
    readonly intent: string;
}

export interface PanelMaterialRow<T extends PanelMaterial> {
    readonly chip: Exclude<MaterialChip, 'all'> | 'other';
    readonly material?: T;
    readonly placeholder?: PlanPlaceholder;
}

/** A plan canvas belongs to the timeline, never to the file list. */
export function planPlaceholders(edit: unknown): PlanPlaceholder[] {
    if (!edit || typeof edit !== 'object') return [];
    const tracks = (edit as { tracks?: unknown }).tracks;
    if (!Array.isArray(tracks)) return [];
    const result: PlanPlaceholder[] = [];
    const visit = (items: unknown): void => {
        if (!Array.isArray(items)) return;
        for (const value of items) {
            if (!value || typeof value !== 'object') continue;
            const item = value as { id?: unknown; source?: { canvas?: { origin?: unknown; intent?: unknown } }; items?: unknown };
            if (item.source?.canvas?.origin === 'plan' && typeof item.id === 'string') {
                result.push({ id: item.id, intent: typeof item.source.canvas.intent === 'string' ? item.source.canvas.intent : '' });
            }
            visit(item.items);
        }
    };
    for (const track of tracks) visit((track as { items?: unknown })?.items);
    return result;
}

export function materialRows<T extends PanelMaterial>(files: readonly T[], edit: unknown): PanelMaterialRow<T>[] {
    const rows: PanelMaterialRow<T>[] = files.map(material => ({
        chip: material.recipe ? 'recipe' : material.baked ? 'baked'
            : material.kind === 'video' || material.kind === 'image' || material.kind === 'audio'
                ? material.kind : 'other',
        material
    }));
    for (const placeholder of planPlaceholders(edit)) rows.push({ chip: 'placeholder', placeholder });
    return rows;
}

export function materialChipCounts(rows: readonly PanelMaterialRow<PanelMaterial>[]): Record<MaterialChip, number> {
    const counts = { all: rows.length, video: 0, image: 0, audio: 0, recipe: 0, baked: 0, placeholder: 0 };
    for (const row of rows) if (row.chip !== 'other') counts[row.chip]++;
    return counts;
}

export function visibleMaterialRows<T extends PanelMaterial>(rows: readonly PanelMaterialRow<T>[], chip: MaterialChip): PanelMaterialRow<T>[] {
    return chip === 'all' ? [...rows] : rows.filter(row => row.chip === chip);
}

export interface PanelOutput { readonly kind: 'data' | 'plan' | 'report' | 'export'; readonly mtime: number }
export type RecordKind = 'plan' | 'data' | 'report';

export const EXPORT_BAND_HEIGHT_KEY = 'akari.exportBand.height';
export const EXPORT_BAND_ROW_HEIGHT = 22;
export const EXPORT_BAND_MIN_HEIGHT = 49;
export const EXPORT_BAND_DEFAULT_HEIGHT = EXPORT_BAND_MIN_HEIGHT + EXPORT_BAND_ROW_HEIGHT;

export function parseExportBandHeight(value: string | null): number | undefined {
    if (value === null || !/^\d+$/.test(value)) return undefined;
    const height = Number(value);
    return Number.isSafeInteger(height) ? height : undefined;
}

export function serializeExportBandHeight(height: number): string {
    return String(Math.round(height));
}

export function clampExportBandHeight(height: number, panelHeight: number): number {
    const maximum = Number.isFinite(panelHeight)
        ? Math.max(EXPORT_BAND_MIN_HEIGHT, Math.floor(panelHeight * 0.7))
        : Number.POSITIVE_INFINITY;
    return Math.min(maximum, Math.max(EXPORT_BAND_MIN_HEIGHT, Math.round(height)));
}

export function dragExportBandHeight(startHeight: number, startY: number, currentY: number, panelHeight: number): number {
    return clampExportBandHeight(startHeight + startY - currentY, panelHeight);
}

export function formatExportTimestamp(mtime: number, now = Date.now()): string {
    const date = new Date(mtime);
    const today = new Date(now);
    const pad = (value: number): string => value.toString().padStart(2, '0');
    return date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate()
        ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
        : `${date.getMonth() + 1}/${date.getDate()}`;
}

export function recordGroupWindow<T>(entries: readonly T[], expanded = false): { rows: T[]; remaining: number } {
    return { rows: expanded ? [...entries] : entries.slice(0, 5), remaining: expanded ? 0 : Math.max(0, entries.length - 5) };
}

export function projectPanelBands<T extends PanelOutput>(entries: readonly T[]): {
    records: Record<RecordKind, T[]>;
    exportAll: T[];
} {
    const newest = (a: T, b: T): number => b.mtime - a.mtime;
    const records = {
        plan: entries.filter(entry => entry.kind === 'plan').sort(newest),
        data: entries.filter(entry => entry.kind === 'data').sort(newest),
        report: entries.filter(entry => entry.kind === 'report').sort(newest)
    };
    const exportAll = entries.filter(entry => entry.kind === 'export').sort(newest);
    return { records, exportAll };
}
