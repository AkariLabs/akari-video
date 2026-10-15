interface StrokeCandidate {
    space?: unknown;
    frame?: unknown;
    points?: unknown;
    sessionRef?: unknown;
}

export interface ReplayableAnnotationStroke extends StrokeCandidate {
    frame: Record<string, unknown>;
    points: Array<[number, number]>;
    sessionRef?: string;
}

/** Content-rect strokes drawn directly in the preview have no sessionRef. */
export function replayableAnnotationStrokes(value: unknown): ReplayableAnnotationStroke[] {
    if (!Array.isArray(value)) return [];
    return value.filter((stroke: StrokeCandidate): stroke is ReplayableAnnotationStroke => Boolean(
        stroke
        && typeof stroke === 'object'
        && !Array.isArray(stroke)
        && stroke.frame
        && typeof stroke.frame === 'object'
        && Array.isArray(stroke.points)
        && stroke.points.length >= 2
        && (typeof stroke.sessionRef === 'string'
            || (stroke.space === 'content-rect' && stroke.sessionRef === undefined))
    ));
}
