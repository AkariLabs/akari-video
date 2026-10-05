import type { TimelineRangeState } from '../../common/timeline-range';

export function renderTimelineRangeOverlay(host: HTMLElement, state: TimelineRangeState, fps: number,
    percent: (seconds: number) => number, format: (seconds: number) => string, showLabels = true): void {
    host.replaceChildren();
    const start = state.inFrame, end = state.outFrame;
    if (start === undefined && end === undefined) return;
    if (start !== undefined && end !== undefined && end > start) {
        const band = document.createElement('div');
        band.dataset.akariTimelineRangeBand = '';
        Object.assign(band.style, { position: 'absolute', top: '0', bottom: '0', left: `${percent(start / fps)}%`,
            width: `${percent(end / fps) - percent(start / fps)}%`,
            background: 'color-mix(in srgb, var(--theia-focusBorder) 15%, transparent)', pointerEvents: 'none' });
        host.appendChild(band);
    }
    for (const [edge, frame] of [['I', start], ['O', end]] as const) {
        if (frame === undefined) continue;
        const line = document.createElement('div');
        line.dataset.akariTimelineRangeLine = edge;
        Object.assign(line.style, { position: 'absolute', top: '0', bottom: '0', left: `${percent(frame / fps)}%`,
            width: '1px', background: 'var(--theia-focusBorder)', pointerEvents: 'none' });
        host.appendChild(line);
        if (!showLabels) continue;
        const marker = document.createElement('div');
        marker.dataset.akariTimelineRangeEdge = edge;
        marker.textContent = `${edge} ${format(frame / fps)}`;
        Object.assign(marker.style, { position: 'absolute', top: '0', left: `${percent(frame / fps)}%`,
            color: 'var(--theia-editor-foreground)', background: 'var(--theia-editor-background)',
            fontSize: '9px', padding: '1px 3px',
            whiteSpace: 'nowrap', transform: edge === 'O' ? 'translateX(-100%)' : 'none', pointerEvents: 'none' });
        host.appendChild(marker);
    }
}
