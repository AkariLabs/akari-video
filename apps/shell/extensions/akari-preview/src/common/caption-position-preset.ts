import type { CaptionCuePosition, CaptionPositionAnchor, PreviewCaptionZone } from './caption-zone-write';

export type CaptionInspectorPositionAction =
    | { captionId: string; kind: 'zone'; zone: PreviewCaptionZone }
    | { captionId: string; kind: 'axis'; axis: 'x' | 'y'; percent: number };

const ZONES: readonly PreviewCaptionZone[] = [
    'top-left', 'top', 'top-right', 'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right'
];

export function parseCaptionInspectorPositionAction(value: string): CaptionInspectorPositionAction | null {
    const match = /^cue:(c-\d{4}|caption-[A-Za-z0-9_-]+):(zone|x|y):(.+)$/u.exec(value);
    if (!match) return null;
    if (match[2] === 'zone') return ZONES.includes(match[3] as PreviewCaptionZone)
        ? { captionId: match[1], kind: 'zone', zone: match[3] as PreviewCaptionZone } : null;
    const percent = Number(match[3]);
    return Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? { captionId: match[1], kind: 'axis', axis: match[2] as 'x' | 'y', percent } : null;
}

/** Place the visible text box at the selected frame zone, keeping the renderer's 7% safe area. */
export function captionZonePlacement(
    zone: PreviewCaptionZone,
    box: { width: number; height: number },
    frame: { width: number; height: number }
): CaptionCuePosition {
    if (![box.width, box.height, frame.width, frame.height].every(Number.isFinite)
        || frame.width <= 0 || frame.height <= 0) throw new Error('字幕位置の寸法が不正です');
    const horizontal = zone.includes('left') ? 'left' : zone.includes('right') ? 'right' : 'center';
    const vertical = zone.startsWith('top') ? 'top' : zone.startsWith('bottom') ? 'bottom' : 'center';
    const x = horizontal === 'left' ? frame.width * .04
        : horizontal === 'right' ? frame.width * .96 - box.width
            : (frame.width - box.width) / 2;
    const y = vertical === 'top' ? frame.height * .07
        : vertical === 'bottom' ? frame.height * .93 - box.height
            : (frame.height - box.height) / 2;
    return { anchor: 'tl', position: {
        x: Math.round(x / frame.width * 10000) / 10000,
        y: Math.round(y / frame.height * 10000) / 10000
    } };
}

/** An inspector number changes one axis while retaining the currently measured other axis. */
export function captionAxisPlacement(
    axis: 'x' | 'y', percent: number,
    current: { x: number; y: number }, anchor: CaptionPositionAnchor = 'tl'
): CaptionCuePosition {
    if (![percent, current.x, current.y].every(Number.isFinite) || percent < 0 || percent > 100) {
        throw new Error('字幕位置は 0〜100% の有限数である必要があります');
    }
    return { anchor, position: {
        x: Math.round((axis === 'x' ? percent / 100 : current.x) * 10000) / 10000,
        y: Math.round((axis === 'y' ? percent / 100 : current.y) * 10000) / 10000
    } };
}
