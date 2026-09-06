// docs/contract-2026-08-02-preview-parity.md ㉔/㉖: pure, DI-free "edit.json field -> preview
// summary field" builders for layers[] and cuts[], extracted out of
// akari-preview-open-handler.ts's loadPreviewModel() so the wiring itself is unit-testable
// without mocking Theia's DI container (FileService/WorkspaceService/etc.).
//
// 2026-08-06 field-test bug (shell-summary-field-gap): layers[].crop / layers[].perspective were
// present in edit.json and correctly rendered by the webview (updateStageScale already implements
// crop pivot / clip-path / matrix3d), but loadPreviewModel's per-layer summary object never read
// value.crop / value.perspective at all -- EditSummaryLayer didn't even declare the fields. Every
// HTML rebuild (after save -> file watch -> queueRefresh) silently reset PiP layers to an
// uncropped, unperspective-corrected box. buildLayerSummaryBase() below is the exact function
// loadPreviewModel calls to build that summary object -- a test against it (not against the
// rendering math in layer-crop-anchor.ts / layer-perspective-visual.ts, which was already
// correct) is what would have caught this class of bug: the field silently failing to reach the
// summary in the first place.

import { CutFraming } from './cut-framing-visual';
import { CutFreeze } from './cut-freeze-visual';
import { isTransitionType, type ReadableTransitionType } from '@akari-video/edit-store';

export interface OverlayTransformLike {
    x?: number;
    y?: number;
    scale?: number;
    rotate?: number;
}

export interface LayerCropSummary {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface LayerPerspectiveSummary {
    corners: [number, number][];
}

// contract-2026-08-09-transform-keyframes-v0.md (layers[].keyframes). Deliberately loose here
// (unknown[], not a typed shape) -- same "light gate + pass through" discipline
// buildCutSummaryFields already uses for cuts[].framing/freeze below: deep per-point validation
// (t ascending was already enforced by validate-edit.mjs at write time; partial/malformed points
// at read time) is common/layer-keyframes-visual.ts's computeLayerKeyframesVisual's job, not this
// module's -- it already tolerates missing/invalid sub-fields per point (falls back to defaults
// or "not animated" for that category), so re-deriving the same rules here would just be a second
// place for them to drift out of sync.
export type LayerKeyframesSummary = unknown[];

/** Light object gate only; preset/span validation belongs to the frame engine and edit-lint. */
export type MotionSummary = Record<string, unknown>;

export interface ChromaKeySummary {
    color: string;
    similarity: number;
    blend: number;
    background?: string;
}

export interface LayerSummaryBase {
    id: string;
    t: number;
    duration: number;
    kind: 'baked' | 'video';
    track: number;
    transform: OverlayTransformLike;
    opacity: number;
    blend: string;
    chromaKey?: ChromaKeySummary;
    crop?: LayerCropSummary;
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
    motion?: MotionSummary;
}

export interface LayerSummaryBaseResult {
    ok: boolean;
    base?: LayerSummaryBase;
    unsupportedBlend?: boolean;
}

export interface CutSummaryTransitionOut {
    type: ReadableTransitionType;
    duration: number;
}

export interface CutSummaryFields {
    src: string;
    in: number;
    out: number;
    track: number;
    transform?: OverlayTransformLike;
    opacity?: number;
    /** v2 media item の layer-style visual。layers[] と同じ正規化器を通して preview へ渡す。 */
    crop?: LayerCropSummary;
    perspective?: LayerPerspectiveSummary;
    keyframes?: LayerKeyframesSummary;
    motion?: MotionSummary;
    speed?: number;
    transitionOut?: CutSummaryTransitionOut;
    at?: number;
    // contract-2026-07-22-render-basics.md #6/#7. Deep validation stays with the consumers
    // (common/cut-framing-visual.ts computeCutFramingVisual / common/cut-freeze-visual.ts
    // checkCutFreezeCrossing) -- this module only checks "non-array object" and passes through,
    // matching the shape akari-preview-open-handler.ts's EditSummaryCut has always used.
    framing?: CutFraming;
    freeze?: CutFreeze;
    chromaKey?: ChromaKeySummary;
}

export interface CutSummaryFieldsResult {
    ok: boolean;
    fields?: CutSummaryFields;
    unresolvedSrc?: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finiteNumberOr = (value: unknown, fallback: number): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * edit.schema.json #/$defs/layerCrop: 0..1 normalized, source-frame-relative, static. Drops
 * (returns undefined for) anything outside range, non-finite, or with x+w>1 / y+h>1 -- the same
 * semantic bound edit-lint's validate-edit.mjs enforces on write, re-checked here defensively
 * since this reads whatever is currently on disk (may predate validation, or be hand-edited).
 */
export function normalizeLayerCropForSummary(value: unknown): LayerCropSummary | undefined {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const { x, y, w, h } = value;
    const inUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    const inUnitExclusive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1;
    if (!inUnit(x) || !inUnit(y) || !inUnitExclusive(w) || !inUnitExclusive(h)) {
        return undefined;
    }
    if (x + w > 1 + 1e-9 || y + h > 1 + 1e-9) {
        return undefined;
    }
    return { x, y, w, h };
}

/**
 * edit.schema.json #/$defs/layerPerspective: corners=[TL,TR,BL,BR], each [x,y] 0..1, static.
 * Drops degenerate quads (area ~0) the same way validate-edit.mjs's validateLayerPerspective /
 * this file's sibling validateLayerPerspectivePatch (in akari-preview-open-handler.ts) do --
 * intentional duplication, same rationale as those two (§2.2.1: independently re-derived so a
 * shared bug wouldn't be masked by testing one against the other).
 */
export function normalizeLayerPerspectiveForSummary(value: unknown): LayerPerspectiveSummary | undefined {
    if (!isPlainObject(value)) {
        return undefined;
    }
    const corners = value.corners;
    if (!Array.isArray(corners) || corners.length !== 4) {
        return undefined;
    }
    const parsed: [number, number][] = [];
    for (const corner of corners) {
        if (!Array.isArray(corner) || corner.length !== 2) {
            return undefined;
        }
        const [x, y] = corner;
        if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1
            || typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1) {
            return undefined;
        }
        parsed.push([x, y]);
    }
    const [tl, tr, bl, br] = parsed;
    const ring = [tl, tr, br, bl];
    let area2 = 0;
    for (let i = 0; i < ring.length; i += 1) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[(i + 1) % ring.length];
        area2 += x1 * y2 - x2 * y1;
    }
    if (Math.abs(area2) < 1e-4) {
        return undefined;
    }
    return { corners: parsed };
}

/**
 * edit.schema.json #/$defs/layerItem.keyframes: an array of >=2 {t, ...} points. Only checks the
 * shape validate-edit.mjs can't defer to a deeper consumer (array, length, each entry an object
 * with a finite non-negative t) -- everything else (which categories a point declares, per-leaf
 * defaults, hold/interpolate/ease semantics) is computeLayerKeyframesVisual's job (see the
 * LayerKeyframesSummary type comment above).
 */
export function normalizeLayerKeyframesForSummary(value: unknown): LayerKeyframesSummary | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const usable = value.filter((point) =>
        isPlainObject(point) && typeof point.t === 'number' && Number.isFinite(point.t) && point.t >= 0);
    return usable.length >= 2 ? value : undefined;
}

export function normalizeChromaKeyForSummary(value: unknown): ChromaKeySummary | undefined {
    if (!isPlainObject(value)) return undefined;
    const color = typeof value.color === 'string' && value.color.trim() ? value.color : '0x00FF00';
    const similarity = typeof value.similarity === 'number' && Number.isFinite(value.similarity)
        ? Math.max(0, Math.min(1, value.similarity)) : 0.2;
    const blend = typeof value.blend === 'number' && Number.isFinite(value.blend)
        ? Math.max(0, Math.min(1, value.blend)) : 0.1;
    const background = typeof value.background === 'string' && value.background.trim()
        ? value.background : undefined;
    return { color, similarity, blend, ...(background ? { background } : {}) };
}

/**
 * The exact per-layer summary object loadPreviewModel builds from a raw edit.json layers[]
 * entry (minus the async `src` asset-stream resolution, which stays in the caller). Validity
 * rules mirror layerItem's schema (id/t/duration/kind/src required); crop/perspective/opacity/
 * blend/chromaKey/keyframes are optional and fall back to "absent" / "normal" / false on invalid
 * input.
 */
export function buildLayerSummaryBase(
    value: unknown,
    label: string,
    normalizeTransform: (value: unknown) => OverlayTransformLike,
    blendToCss: ReadonlyMap<string, string>,
    warn: (message: string, detail?: unknown) => void
): LayerSummaryBaseResult {
    const record = isPlainObject(value) ? value : undefined;
    const validId = typeof record?.id === 'string' && Boolean((record.id as string).trim());
    const validT = typeof record?.t === 'number' && Number.isFinite(record.t as number) && (record.t as number) >= 0;
    const validDuration = typeof record?.duration === 'number'
        && Number.isFinite(record.duration as number) && (record.duration as number) > 0;
    const validKind = record?.kind === 'baked' || record?.kind === 'video';
    const validSrc = typeof record?.src === 'string' && Boolean((record.src as string).trim());
    if (!record || !validId || !validT || !validDuration || !validKind || !validSrc) {
        warn(`[akari-preview] ${label} を無視しました（id/t/duration/kind/src 不正）`, value);
        return { ok: false };
    }

    let opacity = 1;
    if (record.opacity !== undefined) {
        if (typeof record.opacity === 'number' && Number.isFinite(record.opacity)
            && record.opacity >= 0 && record.opacity <= 1) {
            opacity = record.opacity;
        } else {
            warn(`[akari-preview] ${label}.opacity は 1 で近似します（0〜1 の有限 number ではありません）`, record.opacity);
        }
    }
    let blend = 'normal';
    let unsupportedBlend = false;
    if (record.blend !== undefined) {
        const mapped = typeof record.blend === 'string' ? blendToCss.get(record.blend) : undefined;
        if (mapped) {
            blend = mapped;
        } else {
            unsupportedBlend = true;
            warn(`[akari-preview] ${label}.blend は normal で近似します（未対応値）`, record.blend);
        }
    }

    const base: LayerSummaryBase = {
        id: record.id as string,
        t: record.t as number,
        duration: record.duration as number,
        kind: record.kind as 'baked' | 'video',
        track: Number.isInteger(record.track) && (record.track as number) >= 0 ? record.track as number : 0,
        transform: normalizeTransform(record.transform),
        opacity,
        blend
    };
    if (record.kind === 'video') {
        const chromaKey = normalizeChromaKeyForSummary(record.chroma_key);
        if (chromaKey) base.chromaKey = chromaKey;
    }
    if (record.crop !== undefined) {
        const crop = normalizeLayerCropForSummary(record.crop);
        if (crop) {
            base.crop = crop;
        } else {
            warn(`[akari-preview] ${label}.crop を無視しました（0..1 範囲外/矩形が不正です）`, record.crop);
        }
    }
    if (record.perspective !== undefined) {
        const perspective = normalizeLayerPerspectiveForSummary(record.perspective);
        if (perspective) {
            base.perspective = perspective;
        } else {
            warn(`[akari-preview] ${label}.perspective を無視しました（corners が不正/退化四角形です）`, record.perspective);
        }
    }
    if (isPlainObject(record.motion)) base.motion = record.motion;
    if (record.keyframes !== undefined) {
        const keyframes = normalizeLayerKeyframesForSummary(record.keyframes);
        if (keyframes) {
            base.keyframes = keyframes;
        } else {
            warn(`[akari-preview] ${label}.keyframes を無視しました（2 点以上の配列ではありません）`, record.keyframes);
        }
    }
    return { ok: true, base, unsupportedBlend };
}

/**
 * The exact per-cut summary fields loadPreviewModel builds from a raw edit.json cuts[] entry
 * (both v0 and v1 shapes -- v1's `src` resolves against `hasSourceId`, v0/unknown ids fall back
 * to `primaryId`). framing/freeze are passed through verbatim (see CutSummaryFields comment).
 */
export function buildCutSummaryFields(
    value: unknown,
    primaryId: string,
    hasSourceId: (id: string) => boolean,
    normalizeTransform: (value: unknown) => OverlayTransformLike,
    warn: (message: string, detail?: unknown) => void
): CutSummaryFieldsResult {
    const record = isPlainObject(value) ? value : undefined;
    const inSeconds = finiteNumberOr(record?.in, NaN);
    const outSeconds = finiteNumberOr(record?.out, NaN);
    if (!Number.isFinite(inSeconds) || !Number.isFinite(outSeconds) || !(outSeconds > inSeconds)) {
        warn('[akari-preview] cuts entry を無視しました（in/out 不正）', value);
        return { ok: false };
    }

    let speed: number | undefined;
    if (record?.speed !== undefined) {
        if (typeof record.speed === 'number' && Number.isFinite(record.speed) && record.speed > 0) {
            speed = record.speed;
        } else {
            warn('[akari-preview] cut.speed を無視しました（正の有限 number ではありません）', record.speed);
        }
    }

    let transitionOut: CutSummaryTransitionOut | undefined;
    if (record?.transition_out !== undefined && record.transition_out !== null) {
        const transition = record.transition_out as { type?: unknown; duration?: unknown };
        // 正準語彙は isTransitionType で受理する。さらに非空文字列も defensive に通し、
        // schema より先に新種別が届いた場合は preview の汎用フォールバックへ渡す。
        const validType = isTransitionType(transition?.type)
            || (typeof transition?.type === 'string' && transition.type.trim().length > 0);
        const validDuration = typeof transition?.duration === 'number'
            && Number.isFinite(transition.duration) && transition.duration > 0;
        if (isPlainObject(transition) && validType && validDuration) {
            transitionOut = { type: transition.type as ReadableTransitionType, duration: transition.duration as number };
        } else {
            warn('[akari-preview] cut.transition_out を無視しました（type/duration 不正）', transition);
        }
    }

    const at = typeof record?.at === 'number' && Number.isFinite(record.at) && record.at >= 0 ? record.at : undefined;
    const track = Number.isInteger(record?.track) && (record.track as number) >= 0 ? record.track as number : 0;

    const rawSrc = record?.src;
    let cutSourceId = primaryId;
    let unresolvedSrc = false;
    if (typeof rawSrc === 'string' && hasSourceId(rawSrc)) {
        cutSourceId = rawSrc;
    } else if (typeof rawSrc === 'string') {
        unresolvedSrc = true;
        warn('[akari-preview] cut.src が sources[] に見つかりません。代表ソースで代用します', rawSrc);
    }

    const fields: CutSummaryFields = {
        src: cutSourceId,
        in: inSeconds,
        out: outSeconds,
        track,
        ...(isPlainObject(record?.transform) ? { transform: normalizeTransform(record?.transform) } : {}),
        ...(typeof record?.opacity === 'number' && Number.isFinite(record.opacity)
            && record.opacity >= 0 && record.opacity <= 1 ? { opacity: record.opacity } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(transitionOut ? { transitionOut } : {}),
        ...(at !== undefined ? { at } : {}),
        ...(isPlainObject(record?.framing) ? { framing: record?.framing as unknown as CutFraming } : {}),
        ...(isPlainObject(record?.freeze) ? { freeze: record?.freeze as unknown as CutFreeze } : {})
    };
    if (record?.crop !== undefined) {
        const crop = normalizeLayerCropForSummary(record.crop);
        if (crop) {
            fields.crop = crop;
        } else {
            warn('[akari-preview] cut.crop を無視しました（0..1 範囲外/矩形が不正です）', record.crop);
        }
    }
    if (record?.perspective !== undefined) {
        const perspective = normalizeLayerPerspectiveForSummary(record.perspective);
        if (perspective) {
            fields.perspective = perspective;
        } else {
            warn('[akari-preview] cut.perspective を無視しました（corners が不正/退化四角形です）', record.perspective);
        }
    }
    if (isPlainObject(record?.motion)) fields.motion = record.motion;
    if (record?.keyframes !== undefined) {
        const keyframes = normalizeLayerKeyframesForSummary(record.keyframes);
        if (keyframes) {
            fields.keyframes = keyframes;
        } else {
            warn('[akari-preview] cut.keyframes を無視しました（2 点以上の配列ではありません）', record.keyframes);
        }
    }
    const chromaKey = normalizeChromaKeyForSummary(record?.chroma_key);
    if (chromaKey) fields.chromaKey = chromaKey;
    return { ok: true, fields, unresolvedSrc };
}
