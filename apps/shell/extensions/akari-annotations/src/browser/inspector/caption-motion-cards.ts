import type { CaptionAnimation, CaptionTextStylePatch } from '../../common/caption-store';
import type { InspectorWriteRequest } from '../timeline-selection-model';
import { CAPTION_TEXT_ANIMATIONS } from './caption-motion-catalog';
import { MOTION_IN_OUT_PRESETS, MOTION_LOOP_PRESETS,
    MOTION_PRESET_LABELS, type InspectorMotionSlot } from './motion-fields';

export const CAPTION_MOTION_COMBOS = [
    { id: 'simple', label: 'シンプル', in: 'fade', out: 'fade' },
    { id: 'smart', label: 'スマート', in: 'slide-up', loop: 'float', out: 'slide-up' },
    { id: 'fun', label: 'ファン', in: 'pop', loop: 'pulse', out: 'pop' },
    { id: 'corp', label: 'コーポレート', in: 'wipe', out: 'wipe' },
    { id: 'relax', label: 'リラックス', in: 'fade', loop: 'float', out: 'fade' },
    { id: 'typewriter', label: 'タイプライター', in: 'typewriter', out: 'fade' }
] as const;

export const presetToAnimation: Record<string, string> = {
    fade: 'fade-in-out', 'slide-up': 'slide-up', 'slide-down': 'slide-down',
    'slide-left': 'slide-left', 'slide-right': 'slide-right', scale: 'zoom-in-out',
    wipe: 'wipe-right', pop: 'pop', zoom: 'zoom-in-out', twirl: 'spin-in',
    pulse: 'heartbeat', float: 'float', spin: 'spin-in', blink: 'flash', jiggle: 'jitter'
};

function captionAnimationRequest(id: string, animation: Record<string, unknown>): InspectorWriteRequest {
    return { kind: 'caption-style-my-style', id,
        value: { parts: [{ kind: 'motion', animation }] } };
}

export function captionTextAnimationWrite(id: string, current: CaptionAnimation | undefined,
    slot: InspectorMotionSlot, animationId: string, durationSec?: number): InspectorWriteRequest {
    const animation = Object.fromEntries(Object.entries(current ?? {}).map(([key, value]) => [key,
        value ? { id: value.id, ...(value.durationSec ? { duration_sec: value.durationSec } : {}),
            ...(value.ease ? { ease: value.ease } : {}), ...(value.amp ? { amp: value.amp } : {}) } : value]));
    animation[slot] = { id: animationId,
        ...(durationSec ? { duration_sec: durationSec } : {}) };
    return captionAnimationRequest(id, animation);
}

export function captionTextAnimationClear(id: string, slot: InspectorMotionSlot | 'all'): InspectorWriteRequest {
    return { kind: 'caption-style-effect', id,
        value: { animation: slot === 'all' ? null : { [slot]: null } } };
}

export function captionMotionOriginalAnimation(source: string, id: string): CaptionTextStylePatch['animation'] {
    const document = JSON.parse(source) as { captions?: Record<string, unknown>[] } | Record<string, unknown>[];
    const rows = Array.isArray(document) ? document : document.captions ?? [];
    const row = rows.find(item => item.id === id);
    const raw = (row?.text_style as { animation?: Record<string, Record<string, unknown>> } | undefined)?.animation;
    if (!raw) return null;
    const animation: NonNullable<CaptionTextStylePatch['animation']> = {};
    for (const slot of ['in', 'loop', 'out'] as const) {
        const value = raw[slot];
        if (value && typeof value.id === 'string') animation[slot] = {
            id: value.id,
            ...(value.duration_sec !== undefined ? { durationSec: Number(value.duration_sec) } : {}),
            ...(typeof value.ease === 'string' || value.ease === null ? { ease: value.ease as string | null } : {}),
            ...(typeof value.amp === 'number' || value.amp === null ? { amp: value.amp as number | null } : {})
        };
    }
    return Object.keys(animation).length ? animation : null;
}

export function captionMotionComboClear(captionId: string): InspectorWriteRequest {
    return captionTextAnimationClear(captionId, 'all');
}

export function captionMotionComboWrites(captionId: string,
    comboId: typeof CAPTION_MOTION_COMBOS[number]['id']): InspectorWriteRequest[] {
    const combo = CAPTION_MOTION_COMBOS.find(item => item.id === comboId)!;
    if (combo.id === 'typewriter') return [captionAnimationRequest(captionId, {
            in: { id: 'typewriter', duration_sec: 1.4 }, out: { id: 'fade-in-out', duration_sec: .27 }
        })];
    const animation: Record<string, { id: string; duration_sec: number }> = {
        in: { id: presetToAnimation[combo.in], duration_sec: .4 },
        out: { id: presetToAnimation[combo.out], duration_sec: .27 }
    };
    if ('loop' in combo && combo.loop) animation.loop = { id: presetToAnimation[combo.loop], duration_sec: 3 };
    return [captionAnimationRequest(captionId, animation)];
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
