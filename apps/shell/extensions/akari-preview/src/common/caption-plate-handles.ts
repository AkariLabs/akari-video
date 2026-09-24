import type { CaptionCuePosition } from './caption-zone-write';

export const CAPTION_SCALE_MIN = 0.4;
export const CAPTION_SCALE_MAX = 3;
export const CAPTION_ROTATE_MIN = -180;
export const CAPTION_ROTATE_MAX = 180;

export const CAPTION_HANDLE_KINDS = ['nw', 'ne', 'sw', 'se', 'rot'] as const;
export type CaptionHandleKind = typeof CAPTION_HANDLE_KINDS[number];

export interface CaptionHandlePoint {
    x: number;
    y: number;
}

export function captionWrapWidthDrag(
    side: 'e' | 'w', start: { left: number; right: number }, deltaX: number,
    outputWidth: number
): { widthPct: number; centerX: number } {
    const width = Math.min(outputWidth, Math.max(8,
        start.right - start.left + (side === 'e' ? deltaX : -deltaX)));
    const centerX = side === 'e' ? start.left + width / 2 : start.right - width / 2;
    return { widthPct: Math.round(width / outputWidth * 10000) / 100,
        centerX };
}

export function captionCornerTransform(
    kind: 'nw' | 'ne' | 'sw' | 'se', layout: { left: number; right: number; top: number; bottom: number },
    baseScale: number, rotation: number, pointer: CaptionHandlePoint, startPointer?: CaptionHandlePoint
): { scale: number; left: number; top: number; anchor: CaptionHandlePoint } {
    const cx = (layout.left + layout.right) / 2;
    const cy = (layout.top + layout.bottom) / 2;
    const hx = (layout.right - layout.left) / 2;
    const hy = (layout.bottom - layout.top) / 2;
    const sx = kind.endsWith('w') ? -1 : 1;
    const sy = kind.startsWith('n') ? -1 : 1;
    const rad = rotation * Math.PI / 180;
    const c = Math.cos(rad), s = Math.sin(rad);
    const ax = -sx * hx, ay = -sy * hy;
    const anchor = { x: cx + baseScale * (c * ax - s * ay),
        y: cy + baseScale * (s * ax + c * ay) };
    const vx = 2 * baseScale * (c * sx * hx - s * sy * hy);
    const vy = 2 * baseScale * (s * sx * hx + c * sy * hy);
    const px = pointer.x + (startPointer ? anchor.x + vx - startPointer.x : 0);
    const py = pointer.y + (startPointer ? anchor.y + vy - startPointer.y : 0);
    const factor = ((px - anchor.x) * vx + (py - anchor.y) * vy) / (vx * vx + vy * vy);
    const scale = Math.round(Math.min(3, Math.max(0.4,
        baseScale * (Number.isFinite(factor) ? factor : 1))) * 1000) / 1000;
    const nextCx = anchor.x - scale * (c * ax - s * ay);
    const nextCy = anchor.y - scale * (s * ax + c * ay);
    return { scale, left: nextCx - hx, top: nextCy - hy, anchor };
}

export interface CaptionPlateTransformPatch {
    scale?: number;
    rotate?: number;
    wrapWidthPct?: number;
}

export interface CaptionPlateCuePosition {
    captionId: string;
    value: CaptionCuePosition;
}

export interface CaptionPlateLintResult {
    pass: boolean;
    errors: readonly string[];
}

export interface PersistCaptionPlateTransformOptions {
    source: string;
    captionIds: readonly string[];
    patch: CaptionPlateTransformPatch;
    cuePosition?: CaptionPlateCuePosition;
    lint: (candidate: string) => Promise<CaptionPlateLintResult>;
    write: (candidate: string) => Promise<void>;
}

export function captionHandleScaleFactor(
    center: CaptionHandlePoint,
    start: CaptionHandlePoint,
    now: CaptionHandlePoint
): number {
    const startDistance = Math.hypot(start.x - center.x, start.y - center.y);
    if (startDistance === 0 || !Number.isFinite(startDistance)) return 1;
    return Math.hypot(now.x - center.x, now.y - center.y) / startDistance;
}

export function captionHandleScaleValue(
    baseScale: number,
    center: CaptionHandlePoint,
    start: CaptionHandlePoint,
    now: CaptionHandlePoint
): number {
    const base = Number.isFinite(baseScale) ? baseScale : 1;
    const value = Math.min(CAPTION_SCALE_MAX, Math.max(
        CAPTION_SCALE_MIN,
        base * captionHandleScaleFactor(center, start, now)
    ));
    return Math.round(value * 1000) / 1000;
}

export function captionHandleRotateDelta(
    center: CaptionHandlePoint,
    start: CaptionHandlePoint,
    now: CaptionHandlePoint
): number {
    return (Math.atan2(now.y - center.y, now.x - center.x)
        - Math.atan2(start.y - center.y, start.x - center.x)) * 180 / Math.PI;
}

export function captionHandleRotateValue(
    baseRotate: number,
    center: CaptionHandlePoint,
    start: CaptionHandlePoint,
    now: CaptionHandlePoint
): number {
    const base = Number.isFinite(baseRotate) ? baseRotate : 0;
    const value = base + captionHandleRotateDelta(center, start, now);
    const normalized = ((value + 180) % 360 + 360) % 360 - 180;
    return Math.round(normalized * 100) / 100;
}

export function captionHandleTargets(
    selectedIds: readonly string[],
    activeId: string,
    allIds: readonly string[],
    altAll: boolean
): string[] {
    const orderedIds = [...new Set(allIds.filter(Boolean))];
    if (altAll) return orderedIds;
    const selected = new Set(selectedIds.filter(Boolean));
    if (activeId && selected.has(activeId)) {
        return orderedIds.filter(id => selected.has(id));
    }
    return activeId ? [activeId] : [];
}

// Private copies of caption-zone-write.ts helpers. Importing them would expose implementation
// details from that module; this transform writer must retain both supported captions.json roots.
function captionList(root: unknown): unknown[] {
    const list = Array.isArray(root)
        ? root
        : root && typeof root === 'object' && Array.isArray((root as { captions?: unknown }).captions)
            ? (root as { captions: unknown[] }).captions
            : undefined;
    if (!list) {
        throw new Error('captions.json の形式が不正です（配列、または captions[] を持つオブジェクトである必要があります）');
    }
    return list;
}

function captionIndex(list: readonly unknown[], captionId: string): number {
    const index = list.findIndex(value =>
        !!value && typeof value === 'object' && !Array.isArray(value)
        && (value as { id?: unknown }).id === captionId
    );
    if (index < 0) throw new Error(`字幕が見つかりません: ${captionId}`);
    return index;
}

function captionStyle(caption: Record<string, unknown>): Record<string, unknown> {
    const current = caption.text_style;
    return current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown> : {};
}

function applyTransform(
    root: unknown,
    captionIds: readonly string[],
    patch: CaptionPlateTransformPatch
): void {
    const list = captionList(root);
    for (const captionId of new Set(captionIds)) {
        const caption = list[captionIndex(list, captionId)] as Record<string, unknown>;
        const style = captionStyle(caption);
        if (patch.scale !== undefined) {
            if (patch.scale === 1) delete style.scale;
            else style.scale = patch.scale;
        }
        if (patch.rotate !== undefined) {
            if (patch.rotate === 0) delete style.rotate;
            else style.rotate = patch.rotate;
        }
        if (patch.wrapWidthPct !== undefined) style.wrap_width_pct = patch.wrapWidthPct;
        if (Object.keys(style).length === 0) delete caption.text_style;
        else caption.text_style = style;
    }
}

function applyCuePosition(root: unknown, cuePosition: CaptionPlateCuePosition): void {
    const list = captionList(root);
    const caption = list[captionIndex(list, cuePosition.captionId)] as Record<string, unknown>;
    const style = captionStyle(caption);
    style.text_anchor = cuePosition.value.anchor;
    style.position = cuePosition.value.position.x === undefined
        ? { y: cuePosition.value.position.y }
        : { x: cuePosition.value.position.x, y: cuePosition.value.position.y };
    delete style.zone;
    caption.text_style = style;
}

export function updateCaptionTransformSource(
    source: string,
    captionIds: readonly string[],
    patch: CaptionPlateTransformPatch
): string {
    const root: unknown = JSON.parse(source);
    applyTransform(root, captionIds, patch);
    return `${JSON.stringify(root, undefined, 2)}\n`;
}

export async function persistCaptionPlateTransform(
    options: PersistCaptionPlateTransformOptions
): Promise<CaptionPlateLintResult> {
    const root: unknown = JSON.parse(options.source);
    applyTransform(root, options.captionIds, options.patch);
    if (options.cuePosition) applyCuePosition(root, options.cuePosition);
    const candidate = `${JSON.stringify(root, undefined, 2)}\n`;
    const lintResult = await options.lint(candidate);
    if (lintResult.pass) await options.write(candidate);
    return lintResult;
}
