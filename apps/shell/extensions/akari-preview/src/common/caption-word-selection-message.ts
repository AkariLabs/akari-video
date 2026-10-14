export interface SelectedCaptionRange { captionId: string; from: number; to: number }

export function selectedCaptionRangesMessage(detail: { editUri?: unknown; ranges?: unknown },
    previewEditUri: string): { type: 'akari-preview-set-selected-caption-ranges'; ranges: SelectedCaptionRange[] } | undefined {
    if (detail.editUri !== previewEditUri || !Array.isArray(detail.ranges)) return undefined;
    const ranges = detail.ranges.filter((range): range is SelectedCaptionRange => range !== null
        && typeof range === 'object' && typeof range.captionId === 'string'
        && Number.isInteger(range.from) && Number.isInteger(range.to)
        && range.from >= 0 && range.from < range.to);
    return { type: 'akari-preview-set-selected-caption-ranges', ranges };
}
