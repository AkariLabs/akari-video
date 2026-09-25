/** Keep caption controls in display pixels while their host is scaled with the output stage. */
export function captionControlScale(
    layoutWidth: number, displayWidth: number, layoutHeight: number, displayHeight: number
): Record<string, string> {
    const sx = layoutWidth > 0 && displayWidth > 0 ? displayWidth / layoutWidth : 1;
    const sy = layoutHeight > 0 && displayHeight > 0 ? displayHeight / layoutHeight : 1;
    return {
        '--akari-caption-control-inverse-x': String(1 / sx),
        '--akari-caption-control-inverse-y': String(1 / sy),
        '--akari-caption-control-pair': `${14 / sx}px`,
        '--akari-caption-control-below': `${24 / sy}px`
    };
}
