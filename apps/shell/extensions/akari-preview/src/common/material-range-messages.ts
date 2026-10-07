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
        return { type: value.type, durationSeconds: value.durationSeconds, stripWidthPx: value.stripWidthPx };
    }
    if (value.type === 'akari-material-range-change' && finite(value.durationSeconds) && value.durationSeconds > 0
        && finite(value.stripWidthPx) && value.stripWidthPx > 0
        && (value.moving === 'in' || value.moving === 'out') && typeof value.final === 'boolean'
        && (value.range === null || isMaterialRange(value.range))) {
        return { type: value.type, durationSeconds: value.durationSeconds, stripWidthPx: value.stripWidthPx,
            moving: value.moving, final: value.final, range: value.range as MaterialRange | null };
    }
    return undefined;
}

export function parseMaterialRangeUpdate(value: unknown): MaterialRangeUpdate | undefined {
    if (!record(value) || value.type !== 'akari-material-range-update'
        || (value.range !== null && !isMaterialRange(value.range))) return undefined;
    return { type: value.type, range: value.range as MaterialRange | null };
}

/** The moving handle alone stops at the same one-second / 24px boundary as the materials pane. */
export function clampPreviewMaterialRange(
    range: MaterialRange, durationSeconds: number, stripWidthPx: number, moving: 'in' | 'out'
): MaterialRange {
    const duration = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
    const minimum = Math.min(duration, Math.max(1, stripWidthPx > 0 ? duration * 24 / stripWidthPx : 1));
    const bound = (value: number): number => Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
    if (moving === 'in') {
        const out = bound(range.out);
        return { in: Math.min(bound(range.in), Math.max(0, out - minimum)), out };
    }
    const inside = bound(range.in);
    return { in: inside, out: Math.max(bound(range.out), Math.min(duration, inside + minimum)) };
}

export function normalizeMaterialRange(
    range: MaterialRange | null, durationSeconds: number, stripWidthPx: number, moving: 'in' | 'out'
): MaterialRange | null {
    if (!range || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
    const duration = durationSeconds;
    const minimum = Math.min(duration, Math.max(1, stripWidthPx > 0 ? duration * 24 / stripWidthPx : 1));
    // Keep this function self-contained: its toString() is embedded in a minified webview bundle.
    const bound = (value: number): number => Math.max(0, Math.min(duration, Number.isFinite(value) ? value : 0));
    const clamped = moving === 'in'
        ? { in: Math.min(bound(range.in), Math.max(0, bound(range.out) - minimum)), out: bound(range.out) }
        : { in: bound(range.in), out: Math.max(bound(range.out), Math.min(duration, bound(range.in) + minimum)) };
    const round = (value: number): number => Math.round(value * 100) / 100;
    let inside: number;
    let outside: number;
    if (moving === 'in') {
        outside = Math.min(duration, round(clamped.out));
        inside = Math.min(round(clamped.in), Math.floor((outside - minimum + 1e-9) * 100) / 100);
        inside = Math.max(0, inside);
        if (outside - inside + 1e-9 < minimum) outside = duration;
    } else {
        inside = Math.max(0, round(clamped.in));
        outside = Math.max(round(clamped.out), Math.ceil((inside + minimum - 1e-9) * 100) / 100);
        outside = Math.min(duration, outside);
        if (outside - inside + 1e-9 < minimum) inside = 0;
    }
    if (inside <= 0 && outside >= duration) return null;
    return { in: inside, out: outside };
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
