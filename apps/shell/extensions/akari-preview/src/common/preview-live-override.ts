export interface PreviewLiveOverride {
    key: string;
    values: Readonly<Record<string, number>>;
}

export function nextPreviewLiveOverride(
    current: PreviewLiveOverride | undefined,
    key: string,
    field: string,
    value: number,
    clear = false
): PreviewLiveOverride | undefined {
    if (clear) return current?.key === key ? undefined : current;
    if (!Number.isFinite(value)) return current;
    return { key, values: { ...(current?.key === key ? current.values : {}), [field]: value } };
}
