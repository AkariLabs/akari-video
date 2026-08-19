export type VisualTrackKind = 'cuts' | 'layers' | 'overlays' | 'captions' | 'audio';

export interface VisualTrackOrderEntry {
    kind: VisualTrackKind;
    ref?: number;
}

export interface VisualTrackOrderSource {
    cuts?: unknown[];
    layers?: unknown[];
    overlays?: unknown[];
    captions?: unknown[];
    hasCaptions?: boolean;
    hasInlineCaptions?: boolean;
    audio?: { sfx?: unknown[] };
}

export interface InternalTrackOrderEntry {
    id: string;
    z: number;
}

/**
 * timeline.tracks が省略されたときの下→上の既定順を、実データだけから決定的に導出する。
 * webview へ Function#toString() で注入できるよう、外部ヘルパに依存しない純関数に保つ。
 */
export function deriveVisualTrackOrder(source: VisualTrackOrderSource): VisualTrackOrderEntry[] {
    const resolved: VisualTrackOrderEntry[] = [];
    const collectTrackNumbers = (items: unknown): number[] => {
        const refs = new Set<number>();
        for (const item of Array.isArray(items) ? items : []) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
            const record = item as { track?: unknown };
            if (!Object.prototype.hasOwnProperty.call(record, 'track')) refs.add(0);
            else if (Number.isInteger(record.track) && Number(record.track) >= 0) refs.add(Number(record.track));
        }
        return Array.from(refs).sort((left, right) => left - right);
    };
    const append = (kind: VisualTrackKind, ref?: number): void => {
        resolved.push({ kind, ...(ref === undefined ? {} : { ref }) });
    };

    for (const kind of ['cuts', 'layers', 'overlays'] as const) {
        for (const ref of collectTrackNumbers(source?.[kind])) append(kind, ref);
    }
    if (source?.hasCaptions === true || source?.hasInlineCaptions === true
        || (Array.isArray(source?.captions) && source.captions.length > 0)) {
        append('captions');
    }
    if (Array.isArray(source?.audio?.sfx) && source.audio.sfx.length > 0) append('audio', 0);
    return resolved;
}

/**
 * timeline.tracks（先頭 = 最下段）における visual track の z-index を返す。
 * captions は singleton なので ref を比較せず、それ以外は kind + ref の完全一致で解決する。
 */
export function resolveVisualTrackZ(
    tracks: readonly VisualTrackOrderEntry[],
    kind: VisualTrackKind,
    ref?: number
): number {
    const index = (Array.isArray(tracks) ? tracks : []).findIndex(track => {
        if (!track || track.kind !== kind) return false;
        if (kind === 'captions') return true;
        return Number.isInteger(track.ref) && Number(track.ref) === ref;
    });
    return index;
}

/**
 * 正規化後の tracks（先頭 = 最下段）における z-index を返す。
 *
 * `InternalTrack.z` は読み込み層が配列添字へ正規化しているが、消費側がその値を別の
 * 並びへ持ち越さないよう、ここでも配列順を唯一の権威として解決する。preview と
 * render-cut はこの関数を共有する。
 */
export function resolveInternalTrackZ(
    tracks: readonly InternalTrackOrderEntry[],
    trackId: string
): number {
    return (Array.isArray(tracks) ? tracks : []).findIndex(track => track?.id === trackId);
}
