import type { SelectedCaptionRange } from './caption-word-selection-message';

export function clearSelectedCaptionRanges(
    selections: Map<string, SelectedCaptionRange[]>,
    previews: ReadonlyMap<string, { sendMessage(message: { type: string; ranges: SelectedCaptionRange[] }): unknown }>,
    keep?: string
): void {
    for (const key of selections.keys()) {
        if (key === keep) continue;
        selections.delete(key);
        previews.get(key)?.sendMessage({ type: 'akari-preview-set-selected-caption-ranges', ranges: [] });
    }
}
