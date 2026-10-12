import { t } from '@akari-video/i18n';
export type MotionMark = string;

export function itemMotionMarks(input: {
    keyframes?: readonly Record<string, unknown>[];
    motion?: Record<string, unknown>;
    canvasMotion?: boolean;
}, property: string): MotionMark[] {
    const marks: MotionMark[] = [];
    const hasKeyframe = input.keyframes?.some(point => {
        const seat = property.startsWith('transform.') ? point.transform : point[property];
        return property.startsWith('transform.')
            ? !!seat && typeof seat === 'object' && property.slice(10) in seat
            : seat !== undefined;
    });
    if (hasKeyframe) marks.push(t('inspector.motionMarks.label.keyframe'));
    if (input.motion?.in || input.motion?.out || input.motion?.loop) marks.push(t('inspector.motionMarks.label.contactUs'));
    if (input.canvasMotion) marks.push(t('inspector.motionMarks.label.canvas'));
    return marks;
}
