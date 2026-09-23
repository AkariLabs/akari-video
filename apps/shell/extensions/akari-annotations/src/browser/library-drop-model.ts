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

export interface LibraryTextStyleDragPayload {
    kind: 'textstyle';
    id: string;
}

export interface LibraryTextDragPayload {
    kind: 'text';
}

export type LibraryDragPayload = LibraryTransitionDragPayload | LibraryAssetDragPayload | LibraryTextStyleDragPayload | LibraryTextDragPayload;

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
    if (candidate.kind === 'text') return { kind: 'text' };
    if (candidate.kind === 'textstyle') {
        return typeof candidate.id === 'string' && candidate.id.trim()
            ? { kind: 'textstyle', id: candidate.id } : undefined;
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
    y: number;
}

export interface TransitionDropPoint {
    x: number;
    y: number;
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

/**
 * ドロップ点に最も近い境界を円形の許容距離内で選ぶ。同距離では cut index の小さい方を選び、
 * DOM の列挙順に結果が左右されないようにする。
 */
export function hitTestTransitionBoundary(
    point: TransitionDropPoint,
    candidates: readonly TransitionBoundaryHitCandidate[],
    tolerancePx: number
): TransitionBoundaryHitCandidate | undefined {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
        || !Number.isFinite(tolerancePx) || tolerancePx < 0) {
        return undefined;
    }
    const toleranceSquared = tolerancePx * tolerancePx;
    let best: TransitionBoundaryHitCandidate | undefined;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) continue;
        const xDistance = candidate.x - point.x;
        const yDistance = candidate.y - point.y;
        const distanceSquared = xDistance * xDistance + yDistance * yDistance;
        if (distanceSquared > toleranceSquared) continue;
        const isCloser = distanceSquared < bestDistanceSquared;
        const isDeterministicTie = distanceSquared === bestDistanceSquared
            && (!best || candidate.earlierIndex < best.earlierIndex
                || (candidate.earlierIndex === best.earlierIndex && candidate.laterIndex < best.laterIndex));
        if (isCloser || isDeterministicTie) {
            best = candidate;
            bestDistanceSquared = distanceSquared;
        }
    }
    return best;
}
