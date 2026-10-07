export interface MaterialRange { in: number; out: number }
export type MaterialKind = 'video' | 'audio';
export interface MaterialDragIdentity { relativePath: string; kind: MaterialKind; name: string }
export interface MaterialDragPayload extends MaterialDragIdentity { durationSeconds?: number; in?: number; out?: number }
export type MaterialRangeMessage =
    | { type: 'akari-material-range-ready'; durationSeconds: number; stripWidthPx: number }
    | { type: 'akari-material-range-change'; range: MaterialRange | null;
        durationSeconds: number; stripWidthPx: number; moving: 'in' | 'out'; final: boolean }
    | { type: 'akari-material-place' }
    | { type: 'akari-material-drag-start' }
    | { type: 'akari-material-drag-end' };

export interface MaterialRangeUpdate {
    type: 'akari-material-range-update';
    range: MaterialRange | null;
}

const record = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const MAX_REPORTED_DURATION_SECONDS = 86400;

export function isMaterialRange(value: unknown): value is MaterialRange {
    return record(value) && finite(value.in) && finite(value.out) && value.in >= 0 && value.out > value.in;
}

export function parseMaterialRangeMessage(value: unknown): MaterialRangeMessage | undefined {
    if (!record(value)) return undefined;
    if (value.type === 'akari-material-place' || value.type === 'akari-material-drag-start'
        || value.type === 'akari-material-drag-end') {
        return { type: value.type };
    }
    if (value.type === 'akari-material-range-ready' && finite(value.durationSeconds) && value.durationSeconds > 0
        && finite(value.stripWidthPx) && value.stripWidthPx > 0) {
        return { type: value.type, durationSeconds: Math.min(value.durationSeconds, MAX_REPORTED_DURATION_SECONDS),
            stripWidthPx: Math.max(1, Math.min(10000, value.stripWidthPx)) };
    }
    if (value.type === 'akari-material-range-change' && finite(value.durationSeconds) && value.durationSeconds > 0
        && finite(value.stripWidthPx) && value.stripWidthPx > 0
        && (value.moving === 'in' || value.moving === 'out') && typeof value.final === 'boolean'
        && (value.range === null || isMaterialRange(value.range))) {
        return { type: value.type, durationSeconds: Math.min(value.durationSeconds, MAX_REPORTED_DURATION_SECONDS),
            stripWidthPx: Math.max(1, Math.min(10000, value.stripWidthPx)),
            moving: value.moving, final: value.final, range: value.range as MaterialRange | null };
    }
    return undefined;
}

/** Accept saved and pane ranges without applying the preview strip's minimum width. Self-contained for webviews. */
export function normalizeMaterialRange(range: MaterialRange | null, durationSeconds: number): MaterialRange | null {
    if (!range || !Number.isFinite(durationSeconds) || durationSeconds <= 0
        || !Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out <= range.in) return null;
    const bound = (value: number): number => Math.max(0, Math.min(durationSeconds, value));
    const round = (value: number): number => Math.min(durationSeconds, Math.round(bound(value) * 100) / 100);
    const inside = round(range.in);
    const outside = round(range.out);
    return outside > inside ? { in: inside, out: outside } : null;
}

/** Apply the materials pane's moving-side clamp, then round without moving the stationary side. */
export function clampPreviewMaterialRange(
    range: MaterialRange | null, durationSeconds: number, stripWidthPx: number, moving: 'in' | 'out'
): MaterialRange | null {
    if (!range || !Number.isFinite(durationSeconds) || durationSeconds <= 0
        || !Number.isFinite(range.in) || !Number.isFinite(range.out)) return null;
    const duration = durationSeconds;
    const minimum = Math.min(duration, Math.max(1, stripWidthPx > 0 ? duration * 24 / stripWidthPx : 1));
    const bound = (value: number): number => Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
    const round = (value: number): number => Math.min(duration, Math.round(bound(value) * 100) / 100);
    if (moving === 'in') {
        const out = round(range.out);
        const clamped = Math.min(bound(range.in), Math.max(0, out - minimum));
        let inside = round(clamped);
        if (out >= minimum && out - inside + 1e-9 < minimum) {
            inside = Math.max(0, Math.floor((out - minimum + 1e-9) * 100) / 100);
        }
        return out > inside ? { in: inside, out } : null;
    }
    const inside = round(range.in);
    const clamped = Math.max(bound(range.out), Math.min(duration, inside + minimum));
    let outside = round(clamped);
    if (duration - inside >= minimum && outside - inside + 1e-9 < minimum) {
        outside = Math.min(duration, Math.ceil((inside + minimum - 1e-9) * 100) / 100);
    }
    return outside > inside ? { in: inside, out: outside } : null;
}

/** A ready message establishes the host duration; later edits cannot replace it. */
export function materialRangeHostTransition(
    durationSeconds: number | undefined,
    message: Extract<MaterialRangeMessage, { type: 'akari-material-range-ready' | 'akari-material-range-change' }>
): { type: 'ready'; durationSeconds: number } | {
    type: 'change'; durationSeconds: number; range: MaterialRange | null
} | undefined {
    if (message.type === 'akari-material-range-ready') {
        return { type: 'ready', durationSeconds: Math.min(MAX_REPORTED_DURATION_SECONDS, message.durationSeconds) };
    }
    if (durationSeconds === undefined) return undefined;
    return { type: 'change', durationSeconds,
        range: clampPreviewMaterialRange(message.range, durationSeconds, message.stripWidthPx, message.moving) };
}

/** Place a centered button inside the visible intersection, or clamp it to the viewport if empty. */
export function positionMaterialPlace(
    stage: { left: number; top: number; right: number; bottom: number },
    viewport: { left: number; top: number; right: number; bottom: number },
    buttonWidth: number, buttonHeight: number
): { left: number; top: number } {
    const visibleLeft = Math.max(stage.left, viewport.left);
    const visibleRight = Math.min(stage.right, viewport.right);
    const visibleTop = Math.max(stage.top, viewport.top);
    const visibleBottom = Math.min(stage.bottom, viewport.bottom);
    const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
    const center = visibleRight > visibleLeft ? (visibleLeft + visibleRight) / 2 : (stage.left + stage.right) / 2;
    const bottom = visibleBottom > visibleTop ? visibleBottom : stage.bottom;
    const halfWidth = buttonWidth / 2;
    const x = clamp(center, viewport.left + halfWidth, viewport.right - halfWidth);
    const y = clamp(bottom - buttonHeight - 10, viewport.top, viewport.bottom - buttonHeight);
    return { left: x - viewport.left, top: y - viewport.top };
}

/** Serialize writes and consume each failure once so later actions can continue. */
export function appendMaterialRangeSave(
    previous: Promise<void>, save: () => Promise<unknown>, onFailure: () => void
): Promise<void> {
    return previous.catch(() => undefined).then(save).then(() => undefined, () => {
        try { onFailure(); } catch { /* Reporting must not poison the next write. */ }
    });
}

export function shouldApplyMaterialRangeEvent(
    detail: unknown, relativePath: string, source = 'material-preview'
): detail is { relativePath: string; range: MaterialRange | null; source?: string } {
    return record(detail) && detail.relativePath === relativePath && detail.source !== source
        && (detail.range === null || isMaterialRange(detail.range));
}

export function materialRangeSetArgs(projectUri: string, relativePath: string, range: MaterialRange | null): {
    projectUri: string; relativePath: string; range: MaterialRange | null; source: 'material-preview'
} {
    return { projectUri, relativePath, range, source: 'material-preview' };
}

export function materialRangeEventUpdate(detail: unknown, relativePath: string): MaterialRangeUpdate | undefined {
    return shouldApplyMaterialRangeEvent(detail, relativePath)
        ? { type: 'akari-material-range-update', range: detail.range } : undefined;
}

export function materialPlacementArgs(relativePath: string, kind: MaterialKind,
    durationSeconds: number | undefined, range: MaterialRange | null): {
        relativePath: string; kind: MaterialKind; durationSeconds?: number; in?: number; out?: number
    } {
    return { relativePath, kind,
        ...(durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0
            ? { durationSeconds } : {}),
        ...(range ? { in: range.in, out: range.out } : {}) };
}

/** Self-contained because the exact function body is also embedded in both webviews. */
export function materialDragPayload(identity: MaterialDragIdentity,
    durationSeconds: number | undefined, range: MaterialRange | null): MaterialDragPayload {
    return {
        relativePath: identity.relativePath, kind: identity.kind, name: identity.name,
        ...(typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
            ? { durationSeconds } : {}),
        ...(range ? { in: range.in, out: range.out } : {})
    };
}

export interface MaterialDragSessionState { active: boolean; pointerArmed: boolean }
export type MaterialDragSessionSignal = 'start' | 'arm-pointer' | 'pointer' | 'webview-end'
    | 'drop' | 'host-dragend' | 'escape' | 'blur' | 'dispose';

/** DOM-independent drag lifecycle. The host handles listeners and defers drop completion. */
export function transitionMaterialDragSession(state: MaterialDragSessionState, signal: MaterialDragSessionSignal): {
    state: MaterialDragSessionState; ended: boolean
} {
    if (signal === 'start') return { state: { active: true, pointerArmed: false }, ended: state.active };
    if (!state.active) return { state, ended: false };
    if (signal === 'arm-pointer') return { state: { active: true, pointerArmed: true }, ended: false };
    if (signal === 'pointer' && !state.pointerArmed) return { state, ended: false };
    return { state: { active: false, pointerArmed: false }, ended: true };
}
