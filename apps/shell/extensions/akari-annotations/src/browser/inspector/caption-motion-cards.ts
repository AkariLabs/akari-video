import type { CaptionAnimation } from '../../common/caption-store';
import type { InspectorWriteRequest } from '../timeline-selection-model';
import { CAPTION_TEXT_ANIMATIONS } from './caption-motion-catalog';
import { MOTION_DURATION_DEFAULTS, MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS,
    MOTION_PRESET_LABELS, normalizeInspectorMotion, validateInspectorMotion,
    type InspectorMotion, type InspectorMotionSlot } from './motion-fields';

export const CAPTION_MOTION_COMBOS = [
    { id: 'simple', label: 'シンプル', in: 'fade', out: 'fade' },
    { id: 'smart', label: 'スマート', in: 'slide-up', loop: 'float', out: 'slide-up' },
    { id: 'fun', label: 'ファン', in: 'pop', loop: 'pulse', out: 'pop' },
    { id: 'corp', label: 'コーポレート', in: 'wipe', out: 'wipe' },
    { id: 'relax', label: 'リラックス', in: 'fade', loop: 'float', out: 'fade' },
    { id: 'typewriter', label: 'タイプライター', in: 'typewriter', out: 'fade' }
] as const;

const textAnimationId = (id: string): string => ({
    fade: 'fade-in-out', wipe: 'wipe-right', pulse: 'heartbeat', twirl: 'spin-in', scale: 'zoom-in-out'
} as Record<string, string>)[id] ?? id;

export function captionTextAnimationWrite(id: string, current: CaptionAnimation | undefined,
    slot: InspectorMotionSlot, animationId: string, durationSec?: number): InspectorWriteRequest {
    const animation = Object.fromEntries(Object.entries(current ?? {}).map(([key, value]) => [key,
        value ? { id: value.id, ...(value.durationSec ? { duration_sec: value.durationSec } : {}),
            ...(value.ease ? { ease: value.ease } : {}), ...(value.amp ? { amp: value.amp } : {}) } : value]));
    animation[slot] = { id: animationId,
        ...(durationSec ? { duration_sec: durationSec } : {}) };
    return { kind: 'caption-style-my-style', id,
        value: { parts: [{ kind: 'motion', animation }] } };
}

export function captionMotionComboWrites(captionId: string, owner: { id: string; motion?: Record<string, unknown> } | undefined,
    comboId: typeof CAPTION_MOTION_COMBOS[number]['id'], durationFrames: number): InspectorWriteRequest[] {
    const combo = CAPTION_MOTION_COMBOS.find(item => item.id === comboId)!;
    if (combo.id === 'typewriter') return [{ kind: 'caption-style-my-style', id: captionId,
        value: { parts: [{ kind: 'motion', animation: {
            in: { id: 'typewriter', duration_sec: 1.4 }, out: { id: 'fade-in-out', duration_sec: .27 }
        } }] } }];
    if (!owner) {
        const animation: Record<string, { id: string; duration_sec: number }> = {
            in: { id: textAnimationId(combo.in), duration_sec: .4 },
            out: { id: textAnimationId(combo.out), duration_sec: .27 }
        };
        if ('loop' in combo && combo.loop) animation.loop = { id: textAnimationId(combo.loop), duration_sec: 3 };
        return [{ kind: 'caption-style-my-style', id: captionId, value: { parts: [{ kind: 'motion', animation }] } }];
    }
    const original = normalizeInspectorMotion(owner.motion);
    const next: InspectorMotion = { ...original,
        in: { preset: combo.in as NonNullable<InspectorMotion['in']>['preset'], duration: Math.max(1, Math.min(durationFrames - 1, MOTION_DURATION_DEFAULTS.in)) },
        out: { preset: combo.out as NonNullable<InspectorMotion['out']>['preset'], duration: Math.max(1, Math.min(durationFrames - 1, MOTION_DURATION_DEFAULTS.out)) } };
    if ('loop' in combo && combo.loop) next.loop = { preset: combo.loop as NonNullable<InspectorMotion['loop']>['preset'], period: MOTION_DURATION_DEFAULTS.loop };
    else delete next.loop;
    validateInspectorMotion(next, durationFrames);
    return [{ kind: 'item-field', id: owner.id, path: 'motion', value: next }];
}

export function captionMotionCards(slot: InspectorMotionSlot): readonly { id: string; label: string }[] {
    const list = slot === 'loop' ? MOTION_LOOP_PRESETS : MOTION_IN_OUT_PRESETS;
    return list.map(id => ({ id, label: MOTION_PRESET_LABELS[id] }));
}

export const CAPTION_TEXT_ANIMATION_FEATURED = [
    'fade-in-out', 'soft-fade', 'fade-up', 'slide-left', 'zoom-in-out', 'pop',
    'bounce', 'rotate-in', 'shake', 'typewriter', 'wobble', 'glitch'
] as const;

export function captionTextAnimationCards(all: boolean): readonly typeof CAPTION_TEXT_ANIMATIONS[number][] {
    return all ? CAPTION_TEXT_ANIMATIONS : CAPTION_TEXT_ANIMATION_FEATURED.map(id =>
        CAPTION_TEXT_ANIMATIONS.find(entry => entry.id === id)!);
}
