export interface PreviewLiveValues {
    id: string;
    values: Record<string, number>;
    clear: boolean;
}

const fields = new Set(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate']);

export function previewLiveValues(message: unknown): PreviewLiveValues | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const input = message as { id?: unknown; values?: unknown; clear?: unknown };
    if (typeof input.id !== 'string' || !input.id
        || input.clear !== true && (!input.values || typeof input.values !== 'object')) return undefined;
    const values: Record<string, number> = {};
    for (const [field, value] of Object.entries(input.values ?? {})) {
        if (fields.has(field) && typeof value === 'number' && Number.isFinite(value)) values[field] = value;
    }
    if (input.clear !== true && Object.keys(values).length === 0) return undefined;
    return { id: input.id, values, clear: input.clear === true };
}
