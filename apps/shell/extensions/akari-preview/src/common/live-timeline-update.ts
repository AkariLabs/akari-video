// Reuse decoded media only when the edit changes placement/trimming, not media or appearance.
export function liveTimelineUpdate(beforeSource: string, afterSource: string, supportsMultipleCuts: boolean): any | undefined {
    try {
        const before = JSON.parse(beforeSource), after = JSON.parse(afterSource);
        const stable = (edit: any): string => {
            const value = JSON.parse(JSON.stringify(edit));
            for (const cut of value.cuts ?? []) for (const key of ['at', 'in', 'out', 'track']) delete cut[key];
            for (const layer of value.layers ?? []) for (const key of ['t', 'duration', 'track']) delete layer[key];
            if (value.timeline) delete value.timeline.tracks;
            return JSON.stringify(value);
        };
        if (stable(before) !== stable(after)) return;
        if ((after.overlays?.length ?? 0) || (after.captions?.length ?? 0)
            || (after.cuts ?? []).some((cut: any) => cut.freeze || cut.framing || cut.transition_out)) return;
        if (!supportsMultipleCuts && new Set((after.cuts ?? []).map((cut: any) => cut.track ?? 0)).size > 1) return;
        return after;
    } catch { return; }
}
