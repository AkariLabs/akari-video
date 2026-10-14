import { isTransitionType } from '@akari-video/edit-store';
import type { TransitionType } from '@akari-video/edit-store';

export interface LibraryTransitionDragPayload {
    kind: 'transition';
    id: TransitionType;
    name: string;
}

export interface LibraryAssetDragPayload {
    kind: 'asset';
    key: string;
    id: string;
    category: 'audio' | 'broll' | 'still';
    title: string;
}

export interface LibraryOverlayDragPayload {
    kind: 'overlay';
    key: string;
    id: string;
    category: 'overlay';
    title: string;
}

export interface LibraryScene3dDragPayload {
    kind: 'scene3d';
    key: string;
    id: string;
    category: 'scene3d';
    title: string;
}

export interface LibraryTextStyleDragPayload {
    kind: 'textstyle';
    id: string;
    style?: unknown;
}

export interface LibraryTextDragPayload {
    kind: 'text';
}
export interface LibraryApplyDragPayload {
    kind: 'textanim' | 'font' | 'lut';
    id: string;
    slot?: string;
    fontFamily?: string;
}

export interface LibraryMyStyleDragPayload {
    kind: 'mystyle';
    style: { parts: Array<{ kind: string; text_style?: unknown }> };
}

/** 図形の棚のタイル。形はドロップ後に `akari.library.shapePreset` で引き直すので preset だけを信じる。 */
export interface LibraryShapeDragPayload {
    kind: 'shape';
    preset: string;
}

export type LibraryDragPayload = LibraryTransitionDragPayload | LibraryAssetDragPayload | LibraryOverlayDragPayload | LibraryScene3dDragPayload | LibraryTextStyleDragPayload | LibraryTextDragPayload | LibraryMyStyleDragPayload | LibraryShapeDragPayload | LibraryApplyDragPayload;

export function textPlaceOptions(start: number): { start: number } {
    return { start };
}

export function textStylePlaceOptions(payload: LibraryTextStyleDragPayload, start: number): { start: number; stylePreset: string } {
    return { start, stylePreset: payload.id };
}

/** タイムラインの可視区間を出力時刻へ換算する。 */
export function textStyleDropStart(clientX: number, stripLeft: number, stripWidth: number, viewStart: number, visibleDuration: number): number {
    const ratio = stripWidth > 0 ? Math.min(1, Math.max(0, (clientX - stripLeft) / stripWidth)) : 0;
    return Math.max(0, viewStart + ratio * visibleDuration);
}

/** placeText の既定 3 秒と同じく、出力がある場合だけ終端をその尺で切る。 */
export function textStyleGhostEnd(start: number, outputDuration: number): number {
    return outputDuration > 0 ? Math.min(start + 3, outputDuration) : start + 3;
}

export function textStyleDropBandLayout(
    placedTextRow: { top: number; height: number } | undefined,
    captionRow: { top: number } | undefined,
    fallbackTop: number,
    rowStride: number
): { top: number; height: number } {
    if (placedTextRow) return { top: placedTextRow.top, height: Math.max(rowStride, placedTextRow.height) };
    return { top: captionRow ? captionRow.top - rowStride : fallbackTop, height: rowStride };
}

export function libraryAssetMaterialKind(category: string): 'audio' | 'video' | 'image' | undefined {
    switch (category) {
        case 'audio': return 'audio';
        case 'broll': return 'video';
        case 'still': return 'image';
        default: return undefined;
    }
}

/** MIME 本文と CustomEvent.detail を同じ直和へ絞り込む。 */
export function parseLibraryDragPayload(value: unknown): LibraryDragPayload | undefined {
    let decoded = value;
    if (typeof value === 'string') {
        try { decoded = JSON.parse(value); } catch { return undefined; }
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return undefined;
    const candidate = decoded as Record<string, unknown>;
    if (candidate.kind === 'transition') return parseLibraryTransitionDragPayload(decoded);
    if (candidate.kind === 'overlay' || candidate.kind === 'scene3d') {
        return candidate.category === candidate.kind && candidate.locked !== true && candidate.state !== 'locked'
            && typeof candidate.id === 'string' && candidate.id.trim().length > 0
            && candidate.key === `${candidate.kind}/${candidate.id}`
            && typeof candidate.title === 'string' && candidate.title.trim().length > 0
            ? { kind: candidate.kind, key: candidate.key, id: candidate.id,
                category: candidate.kind, title: candidate.title } as LibraryOverlayDragPayload | LibraryScene3dDragPayload
            : undefined;
    }
    if (candidate.kind === 'text') return { kind: 'text' };
    if (candidate.kind === 'textanim' || candidate.kind === 'font' || candidate.kind === 'lut') {
        return typeof candidate.id === 'string' && candidate.id.trim()
            ? { kind: candidate.kind, id: candidate.id,
                ...(typeof candidate.slot === 'string' ? { slot: candidate.slot } : {}),
                ...(typeof candidate.fontFamily === 'string' ? { fontFamily: candidate.fontFamily } : {}) } : undefined;
    }
    if (candidate.kind === 'shape') {
        return typeof candidate.preset === 'string' && candidate.preset.trim()
            ? { kind: 'shape', preset: candidate.preset } : undefined;
    }
    if (candidate.kind === 'mystyle') {
        const style = candidate.style as LibraryMyStyleDragPayload['style'] | undefined;
        return style && Array.isArray(style.parts) && style.parts.every(part => part && typeof part.kind === 'string')
            ? { kind: 'mystyle', style } : undefined;
    }
    if (candidate.kind === 'textstyle') {
        return typeof candidate.id === 'string' && candidate.id.trim()
            ? { kind: 'textstyle', id: candidate.id,
                ...(candidate.style && typeof candidate.style === 'object' ? { style: candidate.style } : {}) } : undefined;
    }
    if (candidate.kind !== 'asset' || candidate.state === 'locked'
        || typeof candidate.category !== 'string' || !libraryAssetMaterialKind(candidate.category)
        || !['key', 'id', 'title'].every(key => typeof candidate[key] === 'string' && (candidate[key] as string).trim().length > 0)
        || candidate.key !== `${candidate.category}/${candidate.id}`) return undefined;
    return {
        kind: 'asset', key: candidate.key as string, id: candidate.id as string,
        category: candidate.category as LibraryAssetDragPayload['category'], title: candidate.title as string
    };
}

/** 未解決素材のゴーストには尺を付けず、既存の既定尺を使わせる。 */
export function libraryAssetGhostPayload(payload: LibraryAssetDragPayload): {
    relativePath: string; kind: 'audio' | 'video' | 'image'; name: string;
} {
    return { relativePath: `library:${payload.key}`, kind: libraryAssetMaterialKind(payload.category)!, name: payload.title };
}

export interface TransitionBoundaryHitCandidate {
    earlierIndex: number;
    laterIndex: number;
    x: number;
    applicable: boolean;
    windowStartX?: number;
    windowEndX?: number;
}


/** JSON 文字列と CustomEvent.detail の双方を、書き込み可能な transition payload に絞り込む。 */
export function parseLibraryTransitionDragPayload(value: unknown): LibraryTransitionDragPayload | undefined {
    let decoded = value;
    if (typeof value === 'string') {
        try {
            decoded = JSON.parse(value);
        } catch {
            return undefined;
        }
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
        return undefined;
    }
    const candidate = decoded as { kind?: unknown; id?: unknown; name?: unknown };
    if (candidate.kind !== 'transition' || !isTransitionType(candidate.id)
        || typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
        return undefined;
    }
    return { kind: 'transition', id: candidate.id, name: candidate.name };
}

/** 書き出し互換性のない earlierIndex を除き、入力順を保った適用可能境界だけを返す。 */
export function filterSupportedTransitionBoundaries<T extends { earlierIndex: number }>(
    boundaries: readonly T[],
    unsupportedEarlierIndexes: ReadonlySet<number>
): T[] {
    return boundaries.filter(boundary => !unsupportedEarlierIndexes.has(boundary.earlierIndex));
}

/** Visible, applicable boundary nearest to the pointer, with the left side winning ties. */
export function nearestTransitionBoundary(
    pointerX: number,
    candidates: readonly TransitionBoundaryHitCandidate[],
    visibleLeft: number,
    visibleRight: number
): TransitionBoundaryHitCandidate | undefined {
    if (!Number.isFinite(pointerX) || !Number.isFinite(visibleLeft) || !Number.isFinite(visibleRight)) return undefined;
    const inWindow = candidates.find(candidate => candidate.applicable
        && Number.isFinite(candidate.windowStartX) && Number.isFinite(candidate.windowEndX)
        && candidate.windowStartX! <= pointerX && pointerX <= candidate.windowEndX!
        && candidate.windowEndX! >= visibleLeft && candidate.windowStartX! <= visibleRight);
    if (inWindow) return inWindow;
    let best: TransitionBoundaryHitCandidate | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        if (!candidate.applicable || !Number.isFinite(candidate.x)
            || candidate.x < visibleLeft || candidate.x > visibleRight) continue;
        const distance = Math.abs(candidate.x - pointerX);
        if (distance < bestDistance || (distance === bestDistance && (!best || candidate.x < best.x
            || (candidate.x === best.x && candidate.earlierIndex < best.earlierIndex)))) {
            best = candidate;
            bestDistance = distance;
        }
    }
    return best;
}
