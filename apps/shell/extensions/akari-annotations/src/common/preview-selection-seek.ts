export interface PreviewSelectionSeekInput {
    range?: readonly [number, number];
    playhead: number;
    playing: boolean;
    multiple: boolean;
    origin: 'single' | 'marquee' | 'all' | 'history';
}

/** A direct single selection only moves the paused playhead when its item is absent. */
export function previewSelectionSeekTime(input: PreviewSelectionSeekInput): number | undefined {
    if (input.playing || input.multiple || input.origin !== 'single' || !input.range) return undefined;
    const [start, end] = input.range;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
    return input.playhead < start || input.playhead >= end ? start : undefined;
}
