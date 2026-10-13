import {
    TRANSITION_FAMILIES, TRANSITION_UNKNOWN_LABEL_KEY, transitionDirectionLabelKey,
    transitionFamilyLabelKey, transitionFamilyOf, transitionTypeOf, isTransitionType,
    isTransitionAlign, readTransitionAlign,
    type TransitionAlign, type TransitionDirection, type TransitionFamily, type TransitionType
} from '@akari-video/edit-store';
import type { BoundaryBlock, BoundaryPlacement, BoundaryRef } from './transition-boundary-model';

export interface TimelineTransitionSelection {
    kind: 'transition';
    /** selection-header.ts and ai-transcribe-panel.ts need these absent fields for shared union reads. */
    id?: never;
    src?: never;
    duration?: never;
    outputStart?: never;
    clipName?: never;
    ref: BoundaryRef;
    earlier: { index: number; name: string };
    later: { index: number; name: string };
    declaration?: { type: string; duration: number; align?: unknown };
    recommendedAlign?: TransitionAlign;
    placement?: Pick<BoundaryPlacement, 'state' | 'effectiveSeconds' | 'reasons' | 'legacyOverlap'>;
    outgoingTailRoomSeconds?: number;
    incomingHeadRoomSeconds?: number;
    block?: BoundaryBlock;
    locked: boolean;
    stripUrl?: string;
}

export type TransitionSelectionInput = Omit<TimelineTransitionSelection,
    'kind' | 'placement' | 'outgoingTailRoomSeconds' | 'incomingHeadRoomSeconds'> & {
    placement?: BoundaryPlacement;
    outgoingTailRoomSeconds?: number;
    incomingHeadRoomSeconds?: number;
};

export function createTransitionSelection(input: TransitionSelectionInput): TimelineTransitionSelection {
    return {
        kind: 'transition', ref: input.ref, earlier: input.earlier, later: input.later,
        declaration: input.declaration,
        recommendedAlign: input.recommendedAlign,
        ...(input.placement ? { placement: {
            state: input.placement.state, effectiveSeconds: input.placement.effectiveSeconds,
            reasons: input.placement.reasons, legacyOverlap: input.placement.legacyOverlap
        } } : {}),
        ...(Number.isFinite(input.outgoingTailRoomSeconds)
            ? { outgoingTailRoomSeconds: input.outgoingTailRoomSeconds } : {}),
        ...(Number.isFinite(input.incomingHeadRoomSeconds)
            ? { incomingHeadRoomSeconds: input.incomingHeadRoomSeconds } : {}),
        block: input.block, locked: input.locked, stripUrl: input.stripUrl
    };
}

export interface TransitionInspectorFields {
    headingKey: string;
    pair: { from: number; to: number };
    stripUrl?: string;
    type: { labelKey: string; disabled: boolean; reasonKey?: string };
    directions: Array<{ direction: TransitionDirection; labelKey: string; symbol?: string; pressed: boolean; type: TransitionType }>;
    duration: { value: number; disabled: boolean; reasonKey?: string };
    align?: { buttons: Array<{ align: TransitionAlign; labelKey: string; pressed: boolean }>;
        disabled: boolean; reasonKey?: string; recommendDisabled: boolean };
    handles: Array<{ labelKey: string; index: number; seconds: number }>;
    status?: { key: string; args?: Record<string, string | number> };
    remove?: { disabled: boolean; reasonKey?: string };
}

const DIRECTION_SYMBOLS: Partial<Record<TransitionDirection, string>> = {
    left: '←', right: '→', up: '↑', down: '↓'
};

export function transitionInspectorFields(snapshot: TimelineTransitionSelection): TransitionInspectorFields {
    const declaration = snapshot.declaration;
    const family = declaration ? transitionFamilyOf(declaration.type) : undefined;
    const definition = family && TRANSITION_FAMILIES.find(entry => entry.family === family.family);
    const blocked = !!snapshot.block;
    const reasonKey = snapshot.locked ? 'transition.inspector.reason.locked'
        : blocked ? `transition.boundary.block.${snapshot.block === 'multi-track' ? 'multiTrack'
            : snapshot.block === 'track-order' ? 'trackOrder' : snapshot.block}` : undefined;
    const unknown = !!declaration && !family;
    const directions = definition?.directions.flatMap(direction => {
        const type = transitionDirectionType(definition.family, direction);
        return type ? [{ direction, labelKey: transitionDirectionLabelKey(direction),
            symbol: DIRECTION_SYMBOLS[direction], pressed: family?.direction === direction, type }] : [];
    }) ?? [];
    const handles: TransitionInspectorFields['handles'] = [];
    if ((!blocked || snapshot.block === 'locked') && snapshot.outgoingTailRoomSeconds !== undefined) handles.push({
        labelKey: 'transition.inspector.handle.outgoing', index: snapshot.earlier.index,
        seconds: snapshot.outgoingTailRoomSeconds
    });
    if ((!blocked || snapshot.block === 'locked') && snapshot.incomingHeadRoomSeconds !== undefined) handles.push({
        labelKey: 'transition.inspector.handle.incoming', index: snapshot.later.index,
        seconds: snapshot.incomingHeadRoomSeconds
    });
    const blockName = snapshot.block === 'multi-track' ? 'multiTrack'
        : snapshot.block === 'track-order' ? 'trackOrder' : snapshot.block;
    const unknownAlign = typeof declaration?.align === 'string' && !isTransitionAlign(declaration.align);
    const shortenedReason = snapshot.placement?.reasons?.includes('neighbor') ? 'neighbor'
        : snapshot.placement?.reasons?.some(reason => reason === 'outgoing-length' || reason === 'incoming-length')
            ? 'clipLength' : 'material';
    const status = snapshot.locked ? { key: 'transition.inspector.status.locked' }
        : blockName ? { key: `transition.boundary.${declaration ? 'dead' : 'block'}.${blockName}` }
            : snapshot.placement?.state === 'dead' ? { key: 'transition.boundary.dead.noHandle' }
                : unknownAlign ? { key: 'transition.inspector.status.unknownAlign' }
                : snapshot.placement?.state === 'shortened' ? { key: `transition.inspector.status.shortened.${shortenedReason}` }
                    : unknown ? { key: 'transition.inspector.status.unknown' } : undefined;
    return {
        headingKey: 'transition.inspector.heading.title',
        pair: { from: snapshot.earlier.index, to: snapshot.later.index },
        stripUrl: snapshot.stripUrl,
        type: { labelKey: family ? transitionFamilyLabelKey(family.family)
            : unknown ? TRANSITION_UNKNOWN_LABEL_KEY : 'transition.inspector.type.none',
        disabled: snapshot.locked || blocked, reasonKey },
        directions,
        duration: { value: declaration?.duration ?? 0.5,
            disabled: !declaration || unknown || snapshot.locked || blocked,
            reasonKey: reasonKey ?? (unknown ? 'transition.inspector.reason.unknown'
                : !declaration ? 'transition.inspector.reason.empty' : undefined) },
        align: declaration && family && !snapshot.placement?.legacyOverlap
            ? { buttons: (['before-cut', 'center', 'after-cut'] as const).map(align => ({ align,
                labelKey: `transition.align.label.${align === 'before-cut' ? 'beforeCut'
                    : align === 'after-cut' ? 'afterCut' : 'center'}`,
                pressed: !unknownAlign && readTransitionAlign(declaration.align) === align })),
                disabled: snapshot.locked || blocked, reasonKey,
                recommendDisabled: !unknownAlign && snapshot.recommendedAlign !== undefined
                    && snapshot.recommendedAlign === readTransitionAlign(declaration.align) }
            : undefined,
        handles,
        status,
        remove: declaration ? { disabled: snapshot.locked, reasonKey: snapshot.locked ? reasonKey : undefined } : undefined
    };
}

export function transitionDurationValue(input: string | number | null): number {
    if (input === null) return 0.5;
    const parsed = typeof input === 'number' ? input : input.trim() ? Number(input.trim()) : NaN;
    if (!Number.isFinite(parsed)) throw new Error('transition.inspector.error.invalidDuration');
    return Math.min(3, Math.max(0.1, Math.round(parsed * 20) / 20));
}

export function transitionDurationTextIsValid(input: string): boolean {
    return input.trim().length > 0 && Number.isFinite(Number(input));
}

export function transitionDirectionType(family: TransitionFamily, direction: TransitionDirection): TransitionType | undefined {
    return transitionTypeOf(family, direction);
}

export interface TransitionBoundaryWriteRequest {
    kind: 'transition-boundary';
    ref: BoundaryRef;
    value: { type: TransitionType; duration: number; align?: TransitionAlign | null;
        recommendAlign?: true; alignOnly?: true } | null;
}

export function transitionDurationRequest(snapshot: TimelineTransitionSelection,
    input: string | number | null): TransitionBoundaryWriteRequest {
    if (!isTransitionType(snapshot.declaration?.type) || transitionInspectorFields(snapshot).duration.disabled)
        throw new Error('transition.inspector.error.unavailable');
    return { kind: 'transition-boundary', ref: snapshot.ref,
        value: { type: snapshot.declaration.type, duration: transitionDurationValue(input) } };
}

export function transitionDirectionRequest(snapshot: TimelineTransitionSelection,
    direction: TransitionDirection): TransitionBoundaryWriteRequest | undefined {
    const family = transitionFamilyOf(snapshot.declaration?.type);
    if (!family || transitionInspectorFields(snapshot).type.disabled) return undefined;
    const type = transitionDirectionType(family.family, direction);
    return type ? { kind: 'transition-boundary', ref: snapshot.ref,
        value: { type, duration: snapshot.declaration!.duration } } : undefined;
}
