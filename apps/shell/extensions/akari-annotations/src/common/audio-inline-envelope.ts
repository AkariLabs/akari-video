import { audioFadeProgress, easingProgress, readEditV2, type AudioFadeShape } from '@akari-video/edit-store';

export type { AudioFadeShape };
export interface InlineAudioPoint { t: number; gain_db: number; easing?: string }
export type InlineAudioPatch = Partial<{
    fade_in: number; fade_out: number;
    fade_in_shape: AudioFadeShape; fade_out_shape: AudioFadeShape;
    gain_db: number; keyframes: InlineAudioPoint[];
}>;

export const INLINE_AUDIO_SHAPES: readonly { value: AudioFadeShape; label: string }[] = [
    { value: 'linear', label: '直線' },
    { value: 'equal_power', label: '等パワー' },
    { value: 's_curve', label: 'S 字' },
    { value: 'slow', label: 'ゆっくり' }
];

/** Dot centre lies on the clip's top edge, above the kind badge's text. */
export const INLINE_FADE_HANDLE_TOP_PX = -10;

export function inlineAudioExpanded(heightPx: number): boolean { return heightPx >= 64; }
export function inlineFadeSeconds(
    xPx: number, widthPx: number, durationSec: number, edge: 'in' | 'out', fps: number
): number {
    if (!(widthPx > 0) || !(durationSec > 0) || !(fps > 0)) return 0;
    const fromEdge = edge === 'in' ? xPx : widthPx - xPx;
    return Math.round(Math.min(durationSec / 2, Math.max(0, fromEdge / widthPx * durationSec)) * fps) / fps;
}

export function inlineGainY(gainDb: number, heightPx: number): number {
    const top = 4;
    const bottom = Math.max(top + 1, heightPx - 4);
    const zero = top + (bottom - top) * 0.44;
    const minusSix = zero + Math.min(12, (bottom - zero) * 0.45);
    const db = Math.min(12, Math.max(-60, gainDb));
    if (db >= 0) return zero - db / 12 * (zero - top);
    if (db >= -6) return zero + (-db) / 6 * (minusSix - zero);
    return minusSix + (-db - 6) / 54 * (bottom - minusSix);
}

export function inlineGainFromDrag(startDb: number, deltaYPx: number, heightPx: number, fine: boolean): number {
    const top = 4;
    const bottom = Math.max(top + 1, heightPx - 4);
    const zero = top + (bottom - top) * 0.44;
    const minusSix = zero + Math.min(12, (bottom - zero) * 0.45);
    const y = Math.min(bottom, Math.max(top, inlineGainY(startDb, heightPx) + deltaYPx * (fine ? 0.1 : 1)));
    const step = fine ? 0.01 : 0.1;
    const value = y <= zero ? (zero - y) / (zero - top) * 12
        : y <= minusSix ? -(y - zero) / (minusSix - zero) * 6
            : -6 - (y - minusSix) / (bottom - minusSix) * 54;
    return Math.min(12, Math.max(-60, Math.round(value / step) * step));
}

export function inlineTimeFrame(xPx: number, widthPx: number, durationSec: number, fps: number): number {
    if (!(widthPx > 0) || !(fps > 0)) return 0;
    return Math.max(0, Math.min(Math.round(durationSec * fps), Math.round(xPx / widthPx * durationSec * fps)));
}

export function inlinePointGainAt(points: readonly InlineAudioPoint[], frame: number): number {
    if (!points.length) return 0;
    if (frame <= points[0].t) return points[0].gain_db;
    for (let index = 1; index < points.length; index += 1) {
        const end = points[index];
        if (frame > end.t) continue;
        if (frame === end.t) return end.gain_db;
        const start = points[index - 1];
        const progress = (frame - start.t) / Math.max(1, end.t - start.t);
        return start.gain_db + (end.gain_db - start.gain_db)
            * easingProgress(end.easing as Parameters<typeof easingProgress>[0], progress);
    }
    return points[points.length - 1].gain_db;
}

export function inlineAddPoint(
    points: readonly InlineAudioPoint[], frame: number, durationFrames: number, gainDb: number
): InlineAudioPoint[] {
    const at = Math.max(0, Math.min(durationFrames, Math.round(frame)));
    if (points.some(point => point.t === at)) return [...points];
    const added = [...points, { t: at, gain_db: Math.min(12, Math.max(-60, gainDb)), easing: 'linear' }];
    // The existing audio envelope contract requires at least two points.
    if (points.length === 0) added.push({ t: at === 0 ? durationFrames : 0, gain_db: 0, easing: 'linear' });
    return added.sort((a, b) => a.t - b.t);
}

export function inlineMovePoint(
    points: readonly InlineAudioPoint[], index: number, frame: number, gainDb: number, durationFrames: number
): InlineAudioPoint[] {
    if (index < 0 || index >= points.length) return [...points];
    const lower = index > 0 ? points[index - 1].t + 1 : 0;
    const upper = index + 1 < points.length ? points[index + 1].t - 1 : durationFrames;
    if (lower > upper) return [...points];
    return points.map((point, position) => position === index ? {
        ...point,
        t: Math.min(upper, Math.max(lower, Math.round(frame))),
        gain_db: Math.min(12, Math.max(-60, gainDb))
    } : point);
}

export function inlineRemovePoints(points: readonly InlineAudioPoint[], frames: readonly number[]): InlineAudioPoint[] {
    const selected = new Set(frames);
    const remaining = points.filter(point => !selected.has(point.t));
    return remaining.length < 2 ? [] : remaining;
}

export function inlineFadeCurve(shape: AudioFadeShape | undefined, edge: 'in' | 'out'): number[] {
    return Array.from({ length: 17 }, (_, index) => {
        const progress = index / 16;
        return audioFadeProgress(shape, edge === 'in' ? progress : 1 - progress);
    });
}

export function patchInlineAudioItem<T extends { tracks?: Array<{ items?: Array<{ id: string; [key: string]: unknown }> }> }>(
    document: T, itemId: string, patch: InlineAudioPatch
): T {
    const next = structuredClone(document);
    for (const track of next.tracks ?? []) {
        const item = track.items?.find(candidate => candidate.id === itemId);
        if (!item) continue;
        Object.assign(item, patch);
        if (patch.keyframes?.length === 0) delete item.keyframes;
        return next;
    }
    throw new Error('音声クリップが見つかりません。');
}

/** Preflight the entire patched document through the active v2 reader. */
export function canPersistAudioFadeShape(
    document: unknown, read: (document: unknown) => unknown = readEditV2
): boolean {
    try {
        read(document);
        return true;
    } catch {
        return false;
    }
}

export const AUDIO_FADE_SHAPE_UNAVAILABLE = 'この版ではフェードの形をまだ保存できません';

export function patchInlineAudioItemForWrite<
    T extends { tracks?: Array<{ items?: Array<{ id: string; [key: string]: unknown }> }> }
>(document: T, itemId: string, patch: InlineAudioPatch,
    read: (document: unknown) => unknown = readEditV2): T {
    const next = patchInlineAudioItem(document, itemId, patch);
    if ((patch.fade_in_shape !== undefined || patch.fade_out_shape !== undefined)
        && !canPersistAudioFadeShape(next, read)) {
        throw new Error(AUDIO_FADE_SHAPE_UNAVAILABLE);
    }
    return next;
}
