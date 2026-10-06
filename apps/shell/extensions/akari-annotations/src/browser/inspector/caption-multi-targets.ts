import type { InspectorWriteRequest, TimelineCaptionSelection, TimelineItemSelectionSnapshot,
    TimelineSelectionTarget } from '../timeline-selection-model';
import type { CaptionAnimation } from '../../common/caption-store';

const MOTION_SLOTS = ['in', 'loop', 'out'] as const;
type MotionSlot = typeof MOTION_SLOTS[number];
type MotionSeat = Record<string, unknown>;
export interface CaptionMotionDelta {
    set: Partial<Record<MotionSlot, MotionSeat>>;
    remove: MotionSlot[];
}

function seat(value: unknown): MotionSeat | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as MotionSeat;
    if (typeof raw.id !== 'string') return undefined;
    return { id: raw.id,
        ...(raw.duration_sec !== undefined || raw.durationSec !== undefined
            ? { duration_sec: raw.duration_sec ?? raw.durationSec } : {}),
        ...(raw.ease !== undefined ? { ease: raw.ease } : {}),
        ...(raw.amp !== undefined ? { amp: raw.amp } : {}) };
}

function motionSeat(animation: unknown, slot: MotionSlot): MotionSeat | undefined {
    return animation && typeof animation === 'object' && !Array.isArray(animation)
        ? seat((animation as MotionSeat)[slot]) : undefined;
}

function equalSeat(left: MotionSeat | undefined, right: MotionSeat | undefined): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function commonCaptionAnimation(snapshots: readonly TimelineCaptionSelection[]): CaptionAnimation | undefined {
    const common: CaptionAnimation = {};
    for (const slot of MOTION_SLOTS) {
        const first = snapshots[0]?.effectiveTextStyle?.animation?.[slot];
        if (first && snapshots.every(snapshot => equalSeat(seat(first),
            seat(snapshot.effectiveTextStyle?.animation?.[slot])))) common[slot] = { ...first };
    }
    return MOTION_SLOTS.some(slot => common[slot]) ? common : undefined;
}

export function captionMotionDelta(before: unknown, after: unknown): CaptionMotionDelta {
    const delta: CaptionMotionDelta = { set: {}, remove: [] };
    for (const slot of MOTION_SLOTS) {
        const previous = motionSeat(before, slot);
        const next = motionSeat(after, slot);
        if (equalSeat(previous, next)) continue;
        if (next) delta.set[slot] = next;
        else delta.remove.push(slot);
    }
    return delta;
}

export function applyCaptionMotionDelta(current: unknown, delta: CaptionMotionDelta): MotionSeat {
    const result: MotionSeat = current && typeof current === 'object' && !Array.isArray(current)
        ? { ...current as MotionSeat } : {};
    for (const slot of delta.remove) delete result[slot];
    for (const slot of MOTION_SLOTS) if (delta.set[slot]) result[slot] = { ...delta.set[slot] };
    return result;
}

export function withCaptionSelectionDomain<T extends TimelineItemSelectionSnapshot>(snapshot: T,
    domain?: string): T & { timeDomain?: string } {
    return snapshot.kind === 'caption' && domain ? { ...snapshot, timeDomain: domain } : snapshot;
}

export function captionMultiTargets(snapshots: readonly Pick<TimelineCaptionSelection, 'id'>[]): TimelineSelectionTarget[] {
    return [...new Set(snapshots.map(snapshot => snapshot.id))].map(id => ({ kind: 'caption', id }));
}

export function withCaptionMultiTargets(request: InspectorWriteRequest,
    targets: readonly TimelineSelectionTarget[], commonAnimation?: CaptionAnimation): InspectorWriteRequest {
    if (request.kind === 'caption-style-my-style') {
        const parts = Array.isArray(request.value.parts) ? request.value.parts : [];
        const motion = parts.find(part => part && typeof part === 'object' && part.kind === 'motion');
        if (motion && typeof motion === 'object') return { ...request, targets,
            value: { ...request.value,
                multi_motion_delta: captionMotionDelta(commonAnimation, motion.animation) } };
    }
    return request.kind.startsWith('caption-style-') && !request.targets
        ? { ...request, targets } : request;
}
