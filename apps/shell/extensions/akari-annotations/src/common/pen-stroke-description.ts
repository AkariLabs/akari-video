import { t } from '@akari-video/i18n';

export interface DescribableStroke {
    tool?: string;
    space?: string;
    points?: readonly (readonly [number, number])[];
}

export function describePenStrokes(strokes: readonly DescribableStroke[] | null | undefined): string | undefined {
    if (!strokes?.length) return undefined;
    const first = strokes[0];
    const points = first.points;
    if (first.tool !== 'pen' || first.space !== 'content-rect' || !points || points.length < 2
        || points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)))) {
        return t('annotationscommon.penStrokes.text.present');
    }
    const [startX, startY] = points[0];
    const [endX, endY] = points[points.length - 1];
    const distance = Math.hypot(endX - startX, endY - startY);
    let length = 0;
    for (let index = 1; index < points.length; index++) {
        length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    }
    let description: string;
    if (length > 0 && distance < length * 0.15) {
        const xs = points.map(point => point[0]);
        const ys = points.map(point => point[1]);
        description = t('annotationscommon.penStrokes.text.enclosure', {
            x: Math.round((Math.min(...xs) + Math.max(...xs)) * 50),
            y: Math.round((Math.min(...ys) + Math.max(...ys)) * 50)
        });
    } else {
        const directions = ['right', 'upRight', 'up', 'upLeft', 'left', 'downLeft', 'down', 'downRight'] as const;
        const octant = ((Math.round(Math.atan2(startY - endY, endX - startX) / (Math.PI / 4)) % 8) + 8) % 8;
        description = t('annotationscommon.penStrokes.text.open', {
            startX: Math.round(startX * 100), startY: Math.round(startY * 100),
            endX: Math.round(endX * 100), endY: Math.round(endY * 100),
            direction: t(`annotationscommon.penStrokes.text.direction.${directions[octant]}`)
        });
    }
    return strokes.length > 1
        ? `${description}${t('annotationscommon.penStrokes.text.more', { count: strokes.length - 1, n: strokes.length - 1 })}`
        : description;
}
